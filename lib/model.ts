// Token Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board's universe is the watchlist's own definition of a launch candidate, applied at
// every size instead of only above the snapshot's $50M floor: a protocol that records no token
// and is not a wrapped, staked or bridged product of a token that already trades, not an
// exchange or an exchange's product, and not a versioned pool of another protocol. In the
// categories where DefiLlama's record cannot separate a protocol from a product (Bridge,
// Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX) the radar sets the
// category aside rather than guess: WBTC, Binance staked ETH and USDT0 record no token in the
// snapshot, but each is a product of a token that trades, and a radar that ranked them as
// launches would be ranking the wrapper, not a protocol. The watchlist is the floor the gate
// checks, never the ceiling of the board: the same rule without the floor finds the rest.
//
// The value model is anchored in the snapshot's own market. Protocols whose token already trades
// reveal what the market pays for a dollar of TVL in each category: the ratio mcap / TVL. A
// pre-token protocol's implied value is its own TVL priced at the multiple its traded peers
// carry, then adjusted by three things the snapshot records about the protocol itself:
//
//   implied = TVL x peer_multiple x momentum x maturity x breadth
//
//   peer_multiple  median mcap/TVL of traded protocols in the same category (the category's own
//                  set when it has at least 4 traded members, else its family's, else the whole
//                  market's), with the peer ratios winsorised to [0.02, 5] so one mania or one
//                  dead token cannot price a whole category.
//   momentum       1 + 0.35 x clamp(change_7d, -50, +100) / 100: a protocol gaining TVL is
//                  worth more per dollar of it; one bleeding TVL, less. Unreported: 1.
//   maturity       0.75 + 0.45 x min(age_days, 1460) / 1460: four years of operating with no
//                  token is the strongest record the snapshot can show; a protocol listed last
//                  month has almost none. Unknown listing date: priced as 270 days.
//   breadth        1 + 0.04 x min(chains - 1, 5): distribution across chains is worth a little.
//
// The band around the value is the peer set's own interquartile range put through the same
// adjustments, so a category the market prices inconsistently honestly shows a wide band.
// Confidence scores the evidence behind the number: how many peers priced it, how tightly they
// agree, whether the snapshot reports the protocol's growth and age, and its size. Readiness is
// a separate signal (size, record, momentum) shown beside the value; it never moves the value.
//
// The live-token protocols are never ranked: they already have a market price, and the dashboard
// shows them apart as the peer evidence the model stands on. No protocol name is special-cased
// anywhere in this file: one function prices every row.

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
  min_category_peers: 4,
  winsor_low: 0.02,
  winsor_high: 5,
  momentum_weight: 0.35,
  momentum_floor: -50,
  momentum_cap: 100,
  maturity_floor: 0.75,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 270,
  breadth_per_chain: 0.04,
  breadth_max_chains: 5,
  airdrop_share: 0.08,
} as const;

/** The model's version label, printed in the dashboard and in board.json. */
export const MODEL_VERSION = 'comps-2';

/** How many live-token protocols the dashboard carries as the peer-evidence view. */
export const LIVE_ROWS = 36;

/**
 * Category families: categories whose traded members price one another when a category's own
 * traded set is too thin to trust. A family is a valuation peer group, nothing more.
 */
export const FAMILIES: Record<string, string[]> = {
  'Lending & credit': ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets'],
  'Trading & derivatives': ['Dexs', 'Derivatives', 'Interest Rate Derivatives', 'Synthetics', 'OTC Marketplace', 'Prediction Market'],
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

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The peer evidence behind one row's value. */
export interface PeerStats {
  basis: 'category' | 'family' | 'market';
  label: string;
  peers: number;
  multiple: number;
  multiple_q1: number;
  multiple_q3: number;
}

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
  airdrop_pool_usd: number;
  confidence: number;
  confidence_label: 'High' | 'Medium' | 'Low';
  readiness: number;
  readiness_label: 'Prime' | 'Warm' | 'Early';
  peers: PeerStats;
  drivers: {
    peer_multiple: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row. */
export interface RadarRow {
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
  airdrop_pool_usd: number;
  confidence: number;
  confidence_label: string;
  readiness: number;
  readiness_label: string;
  peers: PeerStats;
  drivers: BoardRow['drivers'];
  farm_steps: string[];
}

/** A live-token protocol: the market's own value, carried as peer evidence, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** One peer group's pricing summary, for the dashboard's model view. */
export interface PeerGroup {
  label: string;
  kind: 'category' | 'family';
  peers: number;
  multiple: number;
  multiple_q1: number;
  multiple_q3: number;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  airdrop_share: number;
  protocols_total: number;
  board_size: number;
  watchlist_size: number;
  early_size: number;
  live_size: number;
  market_multiple: number;
  rows: RadarRow[];
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

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word in the name that marks a wrapped or staked product of another token. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's products, not protocols. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Categories where the record cannot separate a protocol from a product of a traded token:
 * bridges and staking wrappers are set aside whole, exactly as the snapshot's watchlist does.
 */
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

/** The traded multiple one live protocol reveals, winsorised; null when it has no price or no TVL. */
function liveMultiple(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || p.tvl_usd <= 0) return null;
  return clamp(p.mcap_usd / p.tvl_usd, MODEL.winsor_low, MODEL.winsor_high);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Median and quartiles of a peer set's multiples. */
function summarise(multiples: number[]): { median: number; q1: number; q3: number } {
  const s = [...multiples].sort((a, b) => a - b);
  return { median: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75) };
}

/** Every peer set the model can price from: by category, by family, and the whole market. */
export interface PeerIndex {
  byCategory: Map<string, number[]>;
  byFamily: Map<string, number[]>;
  market: number[];
}

export function buildPeerIndex(protocols: SnapshotProtocol[]): PeerIndex {
  const byCategory = new Map<string, number[]>();
  const byFamily = new Map<string, number[]>();
  const market: number[] = [];
  for (const p of protocols) {
    if (isPreToken(p)) continue;
    const m = liveMultiple(p);
    if (m === null) continue;
    market.push(m);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(m);
      byCategory.set(p.category, list);
      const fam = familyOf(p.category);
      if (fam !== null) {
        const fl = byFamily.get(fam) ?? [];
        fl.push(m);
        byFamily.set(fam, fl);
      }
    }
  }
  return { byCategory, byFamily, market };
}

/** The peer set that prices one protocol: its category's if it is deep enough, else its family's, else the market's. */
export function peerStatsFor(p: SnapshotProtocol, index: PeerIndex): PeerStats {
  const cat = p.category;
  if (cat !== null) {
    const own = index.byCategory.get(cat) ?? [];
    if (own.length >= MODEL.min_category_peers) {
      const s = summarise(own);
      return { basis: 'category', label: cat, peers: own.length, multiple: s.median, multiple_q1: s.q1, multiple_q3: s.q3 };
    }
    const fam = familyOf(cat);
    if (fam !== null) {
      const kin = index.byFamily.get(fam) ?? [];
      if (kin.length >= MODEL.min_category_peers) {
        const s = summarise(kin);
        return { basis: 'family', label: fam, peers: kin.length, multiple: s.median, multiple_q1: s.q1, multiple_q3: s.q3 };
      }
    }
  }
  const s = summarise(index.market);
  return { basis: 'market', label: 'Whole market', peers: index.market.length, multiple: s.median, multiple_q1: s.q1, multiple_q3: s.q3 };
}

/** The three adjustments and the implied value one protocol gets, with its band. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  peers: PeerStats,
): {
  implied: number;
  low: number;
  high: number;
  momentumMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, MODEL.momentum_floor, MODEL.momentum_cap);
  const momentumMult = 1 + MODEL.momentum_weight * (growth / 100);
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturityMult = MODEL.maturity_floor + (clamp(ageForModel, 0, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const breadthMult = 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_chains);
  const adj = momentumMult * maturityMult * breadthMult;
  const implied = Math.max(1, Math.round(p.tvl_usd * peers.multiple * adj));
  const low = Math.max(1, Math.round(p.tvl_usd * peers.multiple_q1 * adj));
  const high = Math.max(low, Math.round(p.tvl_usd * peers.multiple_q3 * adj));
  return { implied, low, high, momentumMult, maturityMult, breadthMult, age };
}

/** Confidence in a row's number, 0..100: peer depth, peer agreement, reported data, size. */
export function confidenceFor(p: SnapshotProtocol, peers: PeerStats): number {
  let score = 0;
  if (peers.peers >= 15) score += 40;
  else if (peers.peers >= 8) score += 30;
  else if (peers.peers >= MODEL.min_category_peers) score += 20;
  else score += 10;
  const spread = peers.multiple > 0 ? (peers.multiple_q3 - peers.multiple_q1) / peers.multiple : 99;
  if (spread <= 1) score += 25;
  else if (spread <= 2) score += 18;
  else if (spread <= 4) score += 10;
  else score += 5;
  if (p.change_7d !== null) score += 10;
  if (p.listed_at !== null) score += 10;
  if (p.tvl_usd >= 50_000_000) score += 15;
  else if (p.tvl_usd >= 20_000_000) score += 8;
  return clamp(Math.round(score), 1, 100);
}

/** Readiness, 0..100: how much of a launch candidate the record makes it. Never moves the value. */
export function readinessFor(p: SnapshotProtocol, age: number | null): number {
  const sizeNorm = clamp((Math.log10(Math.max(p.tvl_usd, 1)) - Math.log10(5_000_000)) / (Math.log10(8_000_000_000) - Math.log10(5_000_000)), 0, 1);
  const ageNorm = clamp((age ?? MODEL.unknown_age_days) / MODEL.maturity_days, 0, 1);
  const growthNorm = p.change_7d === null ? 0.4 : clamp((clamp(p.change_7d, -50, 100) + 50) / 150, 0, 1);
  return clamp(Math.round(100 * (0.4 * sizeNorm + 0.35 * ageNorm + 0.25 * growthNorm)), 0, 100);
}

const label3 = (n: number, high: number, mid: number, labels: [string, string, string]): string =>
  n >= high ? labels[0] : n >= mid ? labels[1] : labels[2];

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas tier of a chain, from its name: mainnet-priced, cheap L2, or near-free. */
function gasTier(chain: string): { action: string; week: string } {
  if (chain === 'Ethereum') return { action: '$10-25 of gas', week: 'about $8 of gas a week' };
  if (chain === 'Solana' || chain === 'Bitcoin') return { action: 'under $1 of fees', week: 'under $1 of fees a week' };
  return { action: '$1-3 of gas', week: 'about $1 of gas a week' };
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

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasTier(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [core, follow] = actionsFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`,
      cost: 'under $3 for the first funding transaction',
      time: '5 minutes',
    },
    { text: core, cost: `$${capital} of capital and ${gas.action}`, time: '15 minutes to set up' },
    { text: follow, cost: gas.action, time: '10 minutes' },
    {
      text: `Repeat one qualifying action in ${p.name} every week (a deposit, a swap, a vote or a claim) so the wallet appears in several weekly snapshots.`,
      cost: gas.week,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, then open ${p.name}'s own points or rewards page and check the wallet's standing before changing anything.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `If a token or claim is ever announced, use only the link ${p.name} publishes on its own page or verified account, never a search result or a DM; log every transaction so the position can be unwound in reverse order.`,
      cost: 'nothing to check, and never pay anyone to claim',
      time: '10 minutes',
    },
  ];
  if (p.chains.length > 1) {
    steps[3] = {
      text: `Spread the weekly qualifying action across two of ${p.name}'s chains (${p.chains.slice(0, 2).join(' and ')}): multi-chain users are the cohort protocols can identify most clearly.`,
      cost: gas.week,
      time: '15 minutes a week',
    };
  }
  return steps;
}

/** The board: every rankable pre-token protocol, priced and ranked, strongest first. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = buildPeerIndex(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const peersRaw = peerStatsFor(p, index);
      const peers: PeerStats = {
        basis: peersRaw.basis,
        label: peersRaw.label,
        peers: peersRaw.peers,
        multiple: round4(peersRaw.multiple),
        multiple_q1: round4(peersRaw.multiple_q1),
        multiple_q3: round4(peersRaw.multiple_q3),
      };
      const s = scoreProtocol(p, snapshot.as_of, peersRaw);
      const confidence = confidenceFor(p, peersRaw);
      const readiness = readinessFor(p, s.age);
      return { p, peers, s, confidence, readiness };
    });
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    age_days: r.s.age,
    watchlist: watch.has(r.p.slug),
    implied_value_usd: r.s.implied,
    implied_low_usd: r.s.low,
    implied_high_usd: r.s.high,
    airdrop_pool_usd: Math.max(1, Math.round(r.s.implied * MODEL.airdrop_share)),
    confidence: r.confidence,
    confidence_label: label3(r.confidence, 70, 45, ['High', 'Medium', 'Low']) as BoardRow['confidence_label'],
    readiness: r.readiness,
    readiness_label: label3(r.readiness, 70, 45, ['Prime', 'Warm', 'Early']) as BoardRow['readiness_label'],
    peers: r.peers,
    drivers: {
      peer_multiple: r.peers.multiple,
      momentum_multiplier: round4(r.s.momentumMult),
      maturity_multiplier: round4(r.s.maturityMult),
      breadth_multiplier: round4(r.s.breadthMult),
    },
    farm_steps: farmSteps(r.p, r.s.age).map(stepText),
  }));
}

/** The live-token protocols by market cap: the peer evidence, shown apart and never ranked. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
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
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** Every peer group's pricing summary for the model view: categories first, then families. */
export function peerGroups(snapshot: Snapshot): PeerGroup[] {
  const index = buildPeerIndex(snapshot.protocols);
  const groups: PeerGroup[] = [];
  for (const [label, multiples] of index.byCategory) {
    if (multiples.length < MODEL.min_category_peers) continue;
    const s = summarise(multiples);
    groups.push({ label, kind: 'category', peers: multiples.length, multiple: round4(s.median), multiple_q1: round4(s.q1), multiple_q3: round4(s.q3) });
  }
  for (const [label, multiples] of index.byFamily) {
    const s = summarise(multiples);
    groups.push({ label, kind: 'family', peers: multiples.length, multiple: round4(s.median), multiple_q1: round4(s.q1), multiple_q3: round4(s.q3) });
  }
  const m = summarise(index.market);
  groups.push({ label: 'Whole market', kind: 'family', peers: index.market.length, multiple: round4(m.median), multiple_q1: round4(m.q1), multiple_q3: round4(m.q3) });
  return groups.sort((a, b) => b.peers - a.peers || (a.label < b.label ? -1 : 1));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const groups = peerGroups(snapshot);
  const market = groups.find((g) => g.label === 'Whole market');
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    airdrop_share: MODEL.airdrop_share,
    protocols_total: snapshot.protocols.length,
    board_size: board.length,
    watchlist_size: snapshot.watchlist.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    market_multiple: market ? market.multiple : 0,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      family: r.family,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      implied_low_usd: r.implied_low_usd,
      implied_high_usd: r.implied_high_usd,
      airdrop_pool_usd: r.airdrop_pool_usd,
      confidence: r.confidence,
      confidence_label: r.confidence_label,
      readiness: r.readiness,
      readiness_label: r.readiness_label,
      peers: r.peers,
      drivers: r.drivers,
      farm_steps: r.farm_steps,
    })),
    live,
    peer_groups: groups,
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
