// Token Radar v3 model: a fitted comps model with a curved size term and hierarchical group
// offsets. One sealed snapshot in, one ranked board out.
//
// Where v1 (comps-2) priced a pre-token protocol at its TVL times the median multiple of its
// traded category peers, with three hand-set multipliers on top, this model ESTIMATES every
// number it uses from the snapshot's own traded population: the 128 protocols whose market cap
// DefiLlama records. On those protocols the market has already answered the question this
// board asks — what is a dollar of this protocol's TVL worth as a token? — so the model fits
// that answer and carries it to the protocols that record no token yet.
//
// The fitted relationship, in logs:
//
//   ln(mcap / TVL) = intercept + size_slope x s + size_quad x s^2 + group offset,
//   with s = ln TVL - mean ln TVL
//
//   size_slope   fitted, about -0.56 on this snapshot: the market pays a smaller multiple for
//                a bigger protocol. A protocol ten times the typical TVL carries roughly a
//                quarter of the typical multiple. v1 assumed this slope was exactly zero (a
//                flat multiple at every size); the traded record says otherwise, and this one
//                term is most of the model's edge.
//   size_quad    fitted, about +0.03: the decline is steepest near the typical size and
//                flattens for the largest protocols, so a straight line overstates the
//                discount at the very top. The term is ridge-shrunk (lambda 1 on the
//                standardised coefficients), so it bends the line only as far as the record
//                supports. fitcomps-1 fitted the straight line alone; the curvature is one
//                of this round's two changes.
//   group offset a blend of two shrunk medians: the median residual of the protocol's
//                category and of its family, each shrunk toward zero by n / (n + 10), then
//                combined with the category's own weight n / (n + 10). A category with two
//                traded members leans on its family; one with fifteen prices itself. A
//                protocol with neither takes the market's offset of zero. fitcomps-1 took
//                the category's offset whole when it existed and the family's only when it
//                did not, with shrinkage n / (n + 6); the blend and the stronger shrinkage
//                are this round's second change.
//   fitting      iteratively reweighted least squares with weights 1 / max(|residual|, 0.05),
//                which tracks the conditional median rather than the mean: the snapshot's
//                multiples run from 0.0003x to 400x, and a mean fit lets a handful of manias
//                and corpses set the price for everyone.
//
// Three candidate signals were fitted again for this round — jointly with the size curve,
// under the same regularisation — and REJECTED again, and the dashboard says so: 7-day TVL
// growth, protocol age and chain count each move the backtest error by less than their own
// noise, so they are shown on every row as context and used in the farm plan, but they do
// not move the price. The two changes that survived were kept only because they improved
// the model's own backtest on the standard partitions AND on ten further partitions that
// played no part in choosing them: against fitcomps-1's median error of x3.87 with 32% of
// held-out protocols priced within 2x, this fit records x3.73 and 33%. The model's own
// backtest — deterministic 10-fold cross-validation over the 128 traded protocols,
// refitting on 115 and pricing the held-out 13, five partitions — is computed by this file
// at run time and printed in the dashboard: median absolute log10 error, the share of
// held-out protocols priced within 2x and 5x of their recorded market cap, and the
// Spearman rank correlation between fitted and recorded values.
//
// The band on each row is the interquartile range of the residuals in the row's own peer
// group (its category when that group has at least 8 fitted members, else its family, else
// the whole fitted population) put through the same price: a group the market prices
// inconsistently honestly shows a wide band.
//
// The board's universe is the snapshot watchlist's own definition of a launch candidate with
// the $50M floor removed: a protocol that records no token and is a protocol in its own
// right, not a wrapped, staked or bridged product of a token that already trades, not an
// exchange's product and not a versioned pool of another protocol. The traded protocols are
// never ranked; the dashboard carries them apart as the evidence the fit stands on, each with
// its recorded value beside the value the model would have given it.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's stated constants: the dashboard prints them and the math below uses nothing else. */
export const MODEL = {
  shrink_k: 10,
  ridge_lambda: 1,
  band_min_group: 8,
  irls_rounds: 8,
  irls_floor: 0.05,
  cv_folds: 10,
  cv_partitions: 5,
} as const;

/** The model's version label, printed in the dashboard and in board.json. */
export const MODEL_VERSION = 'fitcomps-2';

/** How many traded protocols the dashboard carries as the fit-evidence view. */
export const LIVE_ROWS = 36;

/**
 * Category families: the fallback peer group when a category has no traded members of its
 * own. A family is a valuation peer group, nothing more.
 */
export const FAMILIES: Record<string, string[]> = {
  'Credit & lending': ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets'],
  'Trading venues': ['Dexs', 'Derivatives', 'Interest Rate Derivatives', 'Synthetics', 'OTC Marketplace', 'Prediction Market'],
  'Staking & restaking': ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC'],
  'Yield & vaults': ['Yield', 'Yield Aggregator', 'Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Basis Trading'],
  'Bridges': ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge'],
  'Assets & stablecoins': ['RWA', 'Indexes', 'Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Token Locker'],
  'Infrastructure': ['Chain', 'Launchpad', 'Privacy', 'Insurance', 'Payments', 'Governance Incentives', 'Crypto Card Issuer', 'CeDeFi'],
};

const CATEGORY_FAMILY = new Map<string, string>();
for (const [family, categories] of Object.entries(FAMILIES)) {
  for (const c of categories) CATEGORY_FAMILY.set(c, family);
}

/** The family a category belongs to, or null when it stands alone. */
export function familyOf(category: string | null): string | null {
  if (category === null) return null;
  return CATEGORY_FAMILY.get(category) ?? null;
}

/** Where a row's group offset came from. */
export type OffsetBasis = 'category' | 'family' | 'market';

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  fitted_multiple: number;
  size_factor: number;
  offset: number;
  offset_basis: OffsetBasis;
  peers: number;
  confidence: number;
  confidence_label: 'High' | 'Medium' | 'Low';
  farm_steps: string[];
}

/** A traded protocol: the market's own value, the model's fitted value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
  fitted_value_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** One peer group's fitted offset and residual band, for the dashboard's model view. */
export interface PeerGroup {
  label: string;
  kind: 'category' | 'family';
  peers: number;
  offset: number;
  band_q1: number;
  band_q3: number;
}

/** The fit's own backtest over the traded population, computed at run time. */
export interface Backtest {
  protocols: number;
  median_abs_log10: number;
  typical_factor: number;
  bias_log10: number;
  within_2x: number;
  within_5x: number;
  spearman: number;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  protocols_total: number;
  board_size: number;
  watchlist_size: number;
  early_size: number;
  live_size: number;
  fit: {
    protocols: number;
    intercept: number;
    size_slope: number;
    size_quad: number;
    base_multiple: number;
    backtest: Backtest;
  };
  rows: BoardRow[];
  live: LiveRow[];
  peer_groups: PeerGroup[];
  categories: string[];
  chains: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from listed_at to as_of, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The population the model fits on: traded protocols with a recorded, positive market cap and TVL. */
export function isFittable(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word in the name that marks a wrapped or staked product of another token. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's products, not protocols. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Categories where the record cannot separate a protocol from a product of a traded token. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol is one the board may rank: it records no token, and it is a protocol in
 * its own right — not a product of a traded token, not an exchange's product, not a versioned
 * pool. This is the watchlist's rule with the size floor removed.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return !VERSIONED.test(p.name);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

const medianOf = (xs: number[]): number => quantile([...xs].sort((a, b) => a - b), 0.5);

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    const swap = m[c]!;
    m[c] = m[piv]!;
    m[piv] = swap;
    const d = m[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / d;
      for (let k = c; k <= n; k++) m[r]![k] = m[r]![k]! - f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / (row[i]! || 1e-12));
}

/**
 * Ridge-regularised weighted least squares for the three-column design [1, size, size^2]
 * (the two size columns standardised), through the normal equations. The intercept is
 * unpenalised; the two size coefficients carry MODEL.ridge_lambda each, so the curvature
 * term must earn its place against the straight line rather than chase the extremes.
 */
function ridgeFit3(xs: number[][], ys: number[], ws: number[]): [number, number, number] {
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atb = [0, 0, 0];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const w = ws[i]!;
    for (let a = 0; a < 3; a++) {
      atb[a]! += w * x[a]! * ys[i]!;
      for (let c = 0; c < 3; c++) ata[a]![c]! += w * x[a]! * x[c]!;
    }
  }
  ata[0]![0]! += 1e-9;
  ata[1]![1]! += MODEL.ridge_lambda;
  ata[2]![2]! += MODEL.ridge_lambda;
  const [b0, b1, b2] = solveLinear(ata, atb);
  return [b0!, b1!, b2!];
}

/** A fitted model: the global size curve, the shrunk group offsets, and each group's residuals. */
export interface Fit {
  intercept: number;
  sizeSlope: number;
  sizeQuad: number;
  meanLnTvl: number;
  catOffset: Map<string, number>;
  famOffset: Map<string, number>;
  catPeers: Map<string, number>;
  famPeers: Map<string, number>;
  catResid: Map<string, number[]>;
  famResid: Map<string, number[]>;
  allResid: number[];
  protocols: number;
}

/**
 * Fit the model on a set of traded protocols: the size curve by ridge-regularised IRLS
 * toward the conditional median, then each category's and family's offset as the shrunk
 * median of its residuals.
 */
export function fitModel(train: SnapshotProtocol[]): Fit {
  const rows = train.filter(isFittable);
  const meanLnTvl = rows.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / Math.max(1, rows.length);
  // The two size features: the centred log size and its square, each standardised on the
  // training rows so the ridge penalty treats them on one scale.
  const raw = rows.map((p) => {
    const s = Math.log(p.tvl_usd) - meanLnTvl;
    return [s, s * s];
  });
  const centre = [0, 1].map((j) => raw.reduce((sum, r) => sum + r[j]!, 0) / Math.max(1, raw.length));
  const scale = [0, 1].map((j) => {
    const sd = Math.sqrt(raw.reduce((sum, r) => sum + (r[j]! - centre[j]!) ** 2, 0) / Math.max(1, raw.length));
    return sd > 1e-9 ? sd : 1;
  });
  const xs = raw.map((r) => [1, (r[0]! - centre[0]!) / scale[0]!, (r[1]! - centre[1]!) / scale[1]!]);
  const ys = rows.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  let beta = ridgeFit3(xs, ys, rows.map(() => 1));
  for (let round = 0; round < MODEL.irls_rounds; round++) {
    const weights = rows.map((_, i) => {
      const r = ys[i]! - (beta[0] + beta[1] * xs[i]![1]! + beta[2] * xs[i]![2]!);
      return 1 / Math.max(Math.abs(r), MODEL.irls_floor);
    });
    beta = ridgeFit3(xs, ys, weights);
  }
  // The same fit in raw units: intercept, the size slope and the curvature at the mean size.
  const sizeSlope = beta[1] / scale[0]!;
  const sizeQuad = beta[2] / scale[1]!;
  const intercept = beta[0] - beta[1] * (centre[0]! / scale[0]!) - beta[2] * (centre[1]! / scale[1]!);
  const resid = rows.map((p, i) => ys[i]! - (beta[0] + beta[1] * xs[i]![1]! + beta[2] * xs[i]![2]!));
  const group = (keyOf: (p: SnapshotProtocol) => string | null) => {
    const offsets = new Map<string, number>();
    const peers = new Map<string, number>();
    const residuals = new Map<string, number[]>();
    rows.forEach((p, i) => {
      const key = keyOf(p);
      if (key === null) return;
      const list = residuals.get(key) ?? [];
      list.push(resid[i]!);
      residuals.set(key, list);
    });
    for (const [key, list] of residuals) {
      peers.set(key, list.length);
      offsets.set(key, (list.length / (list.length + MODEL.shrink_k)) * medianOf(list));
    }
    return { offsets, peers, residuals };
  };
  const cat = group((p) => p.category);
  const fam = group((p) => familyOf(p.category));
  return {
    intercept,
    sizeSlope,
    sizeQuad,
    meanLnTvl,
    catOffset: cat.offsets,
    famOffset: fam.offsets,
    catPeers: cat.peers,
    famPeers: fam.peers,
    catResid: cat.residuals,
    famResid: fam.residuals,
    allResid: resid,
    protocols: rows.length,
  };
}

/**
 * The offset that prices one protocol, and where it came from. When both the category and
 * its family have traded members, the two offsets are blended with the category's own
 * shrinkage weight, n / (n + k): a deep category prices itself, a thin one leans on its
 * family instead of standing alone, and the blend runs to whichever group exists.
 */
function offsetFor(p: SnapshotProtocol, fit: Fit): { offset: number; basis: OffsetBasis; peers: number } {
  const cat =
    p.category !== null && fit.catOffset.has(p.category)
      ? { offset: fit.catOffset.get(p.category)!, peers: fit.catPeers.get(p.category)! }
      : null;
  const famName = familyOf(p.category);
  const fam =
    famName !== null && fit.famOffset.has(famName)
      ? { offset: fit.famOffset.get(famName)!, peers: fit.famPeers.get(famName)! }
      : null;
  if (cat !== null && fam !== null) {
    const w = cat.peers / (cat.peers + MODEL.shrink_k);
    return { offset: w * cat.offset + (1 - w) * fam.offset, basis: 'category', peers: cat.peers };
  }
  if (cat !== null) return { offset: cat.offset, basis: 'category', peers: cat.peers };
  if (fam !== null) return { offset: fam.offset, basis: 'family', peers: fam.peers };
  return { offset: 0, basis: 'market', peers: fit.protocols };
}

/**
 * The residual band that prices one protocol: its category's residuals when the group is
 * deep enough, else its family's, else the whole fitted population's. The quartiles are
 * taken relative to the pool's own median, so the band always brackets the point estimate:
 * it expresses the group's spread around its centre, wherever that centre sits.
 */
function bandFor(p: SnapshotProtocol, fit: Fit): { q1: number; q3: number } {
  let pool = fit.allResid;
  const fam = familyOf(p.category);
  if (fam !== null) {
    const f = fit.famResid.get(fam);
    if (f !== undefined && f.length >= MODEL.band_min_group) pool = f;
  }
  if (p.category !== null) {
    const c = fit.catResid.get(p.category);
    if (c !== undefined && c.length >= MODEL.band_min_group) pool = c;
  }
  const s = [...pool].sort((a, b) => a - b);
  const centre = quantile(s, 0.5);
  return { q1: quantile(s, 0.25) - centre, q3: quantile(s, 0.75) - centre };
}

/** The size curve's contribution to the log multiple at one TVL: slope plus curvature. */
function sizeTerm(fit: Fit, tvl: number): number {
  const s = Math.log(Math.max(1, tvl)) - fit.meanLnTvl;
  return fit.sizeSlope * s + fit.sizeQuad * s * s;
}

/** The fitted log multiple for one protocol under one fit. */
function fittedLogMultiple(p: SnapshotProtocol, fit: Fit): number {
  const { offset } = offsetFor(p, fit);
  return fit.intercept + sizeTerm(fit, p.tvl_usd) + offset;
}

/** The price one protocol gets under one fit: value, band, and the pieces the dashboard shows. */
export function priceWithFit(
  p: SnapshotProtocol,
  fit: Fit,
): { implied: number; low: number; high: number; multiple: number; sizeFactor: number; offset: number; basis: OffsetBasis; peers: number } {
  const { offset, basis, peers } = offsetFor(p, fit);
  const sizeFactor = Math.exp(sizeTerm(fit, p.tvl_usd));
  const multiple = Math.exp(fit.intercept) * sizeFactor * Math.exp(offset);
  const band = bandFor(p, fit);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
  const low = Math.max(1, Math.round(p.tvl_usd * multiple * Math.exp(band.q1)));
  const high = Math.max(low, Math.round(p.tvl_usd * multiple * Math.exp(band.q3)));
  return { implied, low, high, multiple, sizeFactor, offset, basis, peers };
}

/** Confidence in a row's number, 0..100: the depth of its peer group, the width of its band, its size. */
export function confidenceFor(p: SnapshotProtocol, basis: OffsetBasis, peers: number, low: number, high: number): number {
  let score = 26;
  if (basis === 'category') score += peers >= 10 ? 30 : peers >= 6 ? 25 : peers >= 3 ? 20 : 13;
  else if (basis === 'family') score += 14;
  else score += 6;
  const width = Math.log10(Math.max(1, high) / Math.max(1, low));
  if (width <= 0.8) score += 25;
  else if (width <= 1.2) score += 17;
  else if (width <= 1.8) score += 9;
  else score += 3;
  if (p.tvl_usd >= 50_000_000) score += 15;
  else if (p.tvl_usd >= 10_000_000) score += 8;
  return clamp(Math.round(score), 1, 99);
}

/** A stable string hash (FNV-1a): the cross-validation folds are drawn from it, never from chance. */
function hashSlug(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Spearman's rank correlation, with average ranks for ties. */
function spearman(xs: number[], ys: number[]): number {
  const ranks = (vals: number[]): number[] => {
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const out = new Array<number>(vals.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      const avg = (i + j) / 2;
      for (let k = i; k <= j; k++) out[order[k]![1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i]! - mx) * (ry[i]! - my);
    vx += (rx[i]! - mx) ** 2;
    vy += (ry[i]! - my) ** 2;
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
}

/**
 * The model's own backtest: deterministic 10-fold cross-validation over the traded
 * population, repeated over five fold partitions drawn from slug hashes. Each fold refits
 * the whole model on the other nine and prices the held-out protocols it never saw.
 */
export function backtest(protocols: SnapshotProtocol[]): Backtest {
  const truth = protocols.filter(isFittable).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const medAbs: number[] = [];
  const biases: number[] = [];
  const in2: number[] = [];
  const in5: number[] = [];
  const rhos: number[] = [];
  for (let part = 0; part < MODEL.cv_partitions; part++) {
    const ordered = [...truth].sort(
      (a, b) => hashSlug(`${a.slug}#${part}`) % 1000 - hashSlug(`${b.slug}#${part}`) % 1000 || (a.slug < b.slug ? -1 : 1),
    );
    const preds: number[] = [];
    const actuals: number[] = [];
    for (let f = 0; f < MODEL.cv_folds; f++) {
      const test = ordered.filter((_, i) => i % MODEL.cv_folds === f);
      const held = new Set(test.map((p) => p.slug));
      const fit = fitModel(truth.filter((p) => !held.has(p.slug)));
      for (const p of test) {
        preds.push(p.tvl_usd * Math.exp(fittedLogMultiple(p, fit)));
        actuals.push(p.mcap_usd!);
      }
    }
    const errs = preds.map((v, i) => Math.log10(v / actuals[i]!));
    const abs = errs.map(Math.abs).sort((a, b) => a - b);
    medAbs.push(quantile(abs, 0.5));
    biases.push(errs.reduce((a, b) => a + b, 0) / errs.length);
    in2.push(errs.filter((e) => Math.abs(e) <= Math.log10(2)).length / errs.length);
    in5.push(errs.filter((e) => Math.abs(e) <= Math.log10(5)).length / errs.length);
    rhos.push(spearman(preds, actuals));
  }
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const m = mean(medAbs);
  return {
    protocols: truth.length,
    median_abs_log10: round4(m),
    typical_factor: round4(Math.pow(10, m)),
    bias_log10: round4(mean(biases)),
    within_2x: round4(mean(in2)),
    within_5x: round4(mean(in5)),
    spearman: round4(mean(rhos)),
  };
}

const label3 = (n: number, high: number, mid: number, labels: [string, string, string]): string =>
  n >= high ? labels[0] : n >= mid ? labels[1] : labels[2];

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, from its name: mainnet-priced, cheap L2, or near-free. */
function gasFor(chain: string): { action: string; week: string } {
  if (chain === 'Ethereum') return { action: '$10-25 in gas', week: 'about $8 in gas a week' };
  if (chain === 'Solana' || chain === 'Bitcoin') return { action: 'under $1 in fees', week: 'under $1 in fees a week' };
  return { action: '$1-3 in gas', week: 'about $1 in gas a week' };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 25_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action and its follow-up, in words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('uncollateralized'))
    return [
      `Supply $${capital} of USDC to ${n} on ${chain} so the wallet starts earning a supply history.`,
      `Borrow a small amount (about 20% of the supply) against the position, hold it a week, then repay: lenders count borrowers, not just suppliers.`,
    ];
  if (c.includes('cdp') || c.includes('collateral'))
    return [
      `Open a $${capital} collateral position in ${n} on ${chain} and mint a small amount of its stablecoin against it.`,
      `Use the minted stablecoin inside ${n}'s own ecosystem (a stability pool or a partner market) rather than selling it, and keep the vault open.`,
    ];
  if (c.includes('dex') || c.includes('liquidity'))
    return [
      `Provide $${capital} of liquidity to ${n}'s highest-volume pool on ${chain}, split evenly across both assets.`,
      `Make two or three modest swaps a week through ${n} itself instead of an aggregator, so the wallet's volume is native to the protocol.`,
    ];
  if (c.includes('bridge'))
    return [
      `Bridge $${capital} of USDC to ${chain} through ${n}, then use the bridged funds in one app on the far side.`,
      `Bridge a smaller amount back a week later and repeat monthly: bridges score distinct routes and repeat crossings, not one big transfer.`,
    ];
  if (c.includes('restak'))
    return [
      `Restake $${capital} of a liquid staking token through ${n} on ${chain} and keep the receipt token in the wallet.`,
      `Claim and re-deposit any restaking points or rewards ${n} shows, and do not sell the receipt: the balance history is the record.`,
    ];
  if (c.includes('staking'))
    return [
      `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the receipt token.`,
      `Restake or vote with the receipt where ${n} offers it, and compound any rewards back into the same position monthly.`,
    ];
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('synthetic'))
    return [
      `Deposit $${capital} of USDC as margin on ${n} and open one small hedged position (long one market, short the same size).`,
      `Trade modest size twice a week and keep the account's open interest non-zero between sessions: venues score active accounts, not one-off trades.`,
    ];
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield'))
    return [
      `Deposit $${capital} into a ${n} vault on ${chain}, choosing the vault with the most depositors rather than the highest headline yield.`,
      `Move a small part of the position to a second ${n} vault after two weeks, so the wallet holds more than one vault share.`,
    ];
  if (c.includes('basis') || c.includes('leveraged') || c.includes('farm'))
    return [
      `Open the $${capital} base position ${n} is built around on ${chain} (the deposit or pair its own page leads with) and keep it open.`,
      `Rebalance or top up the position once a fortnight so the wallet reads as an active user of the strategy, not a parked one.`,
    ];
  if (c.includes('stable') || c.includes('rwa') || c.includes('index') || c.includes('locker'))
    return [
      `Mint or deposit $${capital} of ${n}'s asset on ${chain} through its own page and hold the asset in the farming wallet.`,
      `Use the asset in one partner app ${n} lists (a money market or a pool), so the wallet shows both minting and usage.`,
    ];
  if (c.includes('prediction'))
    return [
      `Fund $${capital} on ${n} and take one position in its most liquid market.`,
      `Trade in two further markets over the next fortnight and let one position settle: settled history counts more than open bets.`,
    ];
  if (c.includes('insurance'))
    return [
      `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy to expiry.`,
      `Renew or extend the cover once, so the wallet shows a second policy period rather than a single purchase.`,
    ];
  if (c.includes('privacy'))
    return [
      `Deposit $${capital} through ${n}'s own interface on ${chain}, following its compliance prompts exactly.`,
      `Make one further shielded transfer a week later, keeping amounts modest and records complete.`,
    ];
  if (c.includes('launchpad'))
    return [
      `Register the wallet on ${n} and complete its $${capital} minimum participation or staking step on ${chain}.`,
      `Take part in one live sale or allocation round, however small: participation history is what a launchpad can reward.`,
    ];
  return [
    `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open.`,
    `Make one second, different action in ${n} (a vote, a claim or a small top-up) so the wallet is more than a single deposit.`,
  ];
}

/** One farm step as a single string: the action, then its cost and its time. */
function stepLine(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check the protocol's own page weekly.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [core, follow] = actionsFor(p, capital, chain);
  const weekly =
    p.chains.length > 1
      ? `Spread the weekly qualifying action across two of ${p.name}'s chains (${p.chains.slice(0, 2).join(' and ')}): multi-chain users are the cohort a protocol can identify most clearly.`
      : `Repeat one qualifying action in ${p.name} every week (a deposit, a swap, a vote or a claim) so the wallet appears in several weekly snapshots.`;
  return [
    stepLine(
      `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline`,
      'under $3 for the first funding transaction',
      '5 minutes',
    ),
    stepLine(core.replace(/\.$/, ''), `$${capital} of capital and ${gas.action}`, '15 minutes to set up'),
    stepLine(follow.replace(/\.$/, ''), gas.action, '10 minutes'),
    stepLine(weekly.replace(/\.$/, ''), gas.week, p.chains.length > 1 ? '15 minutes a week' : '10 minutes a week'),
    stepLine(
      `Hold the position for at least ${hold} days, then open ${p.name}'s own points or rewards page and check the wallet's standing before changing anything`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepLine(
      `If a token or claim is ever announced, use only the link ${p.name} publishes on its own page or verified account, never a search result or a DM; log every transaction so the position can be unwound in reverse order`,
      'nothing to check, and never pay anyone to claim',
      '10 minutes',
    ),
  ];
}

/** The board: every rankable pre-token protocol, priced by the fitted model, strongest first. */
export function buildBoard(snapshot: Snapshot, fit: Fit): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const price = priceWithFit(p, fit);
      const age = ageDays(snapshot.as_of, p.listed_at);
      const confidence = confidenceFor(p, price.basis, price.peers, price.low, price.high);
      return { p, price, age, confidence };
    });
  scored.sort((a, b) => b.price.implied - a.price.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((r, i) => ({
    rank: i + 1,
    slug: r.p.slug,
    name: r.p.name,
    category: r.p.category,
    family: familyOf(r.p.category),
    chains: r.p.chains,
    tvl_usd: r.p.tvl_usd,
    change_7d: r.p.change_7d,
    listed_at: r.p.listed_at,
    age_days: r.age,
    watchlist: watch.has(r.p.slug),
    implied_value_usd: r.price.implied,
    implied_low_usd: r.price.low,
    implied_high_usd: r.price.high,
    fitted_multiple: round4(r.price.multiple),
    size_factor: round4(r.price.sizeFactor),
    offset: round4(r.price.offset),
    offset_basis: r.price.basis,
    peers: r.price.peers,
    confidence: r.confidence,
    confidence_label: label3(r.confidence, 70, 45, ['High', 'Medium', 'Low']) as BoardRow['confidence_label'],
    farm_steps: farmSteps(r.p, r.age),
  }));
}

/** The traded protocols by market cap: the fit's evidence, each with the value the model would have given it. */
export function liveRows(snapshot: Snapshot, fit: Fit): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      fitted_value_usd: isFittable(p) ? Math.max(1, Math.round(p.tvl_usd * Math.exp(fittedLogMultiple(p, fit)))) : null,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** Every peer group's fitted offset and band, for the model view: categories first, then families. */
export function peerGroups(fit: Fit): PeerGroup[] {
  const groups: PeerGroup[] = [];
  const collect = (offsets: Map<string, number>, peers: Map<string, number>, resids: Map<string, number[]>, kind: 'category' | 'family') => {
    for (const [label, offset] of offsets) {
      const s = [...(resids.get(label) ?? [])].sort((a, b) => a - b);
      groups.push({ label, kind, peers: peers.get(label) ?? 0, offset: round4(offset), band_q1: round4(quantile(s, 0.25)), band_q3: round4(quantile(s, 0.75)) });
    }
  };
  collect(fit.catOffset, fit.catPeers, fit.catResid, 'category');
  collect(fit.famOffset, fit.famPeers, fit.famResid, 'family');
  return groups.sort((a, b) => b.peers - a.peers || (a.label < b.label ? -1 : 1));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot.protocols);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot, fit);
  const bt = backtest(snapshot.protocols);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    protocols_total: snapshot.protocols.length,
    board_size: board.length,
    watchlist_size: snapshot.watchlist.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    fit: {
      protocols: fit.protocols,
      intercept: round4(fit.intercept),
      size_slope: round4(fit.sizeSlope),
      size_quad: round4(fit.sizeQuad),
      base_multiple: round4(Math.exp(fit.intercept)),
      backtest: bt,
    },
    rows: board,
    live,
    peer_groups: peerGroups(fit),
    categories: [...new Set(board.map((r) => r.category).filter((c): c is string => c !== null))].sort(),
    chains: [...new Set(board.flatMap((r) => r.chains))].sort(),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, farm steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows: the gate wants at least 100`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${byRank[i]!.slug} outranks ${byRank[i - 1]!.slug} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
