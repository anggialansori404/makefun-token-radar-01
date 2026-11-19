# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/anggialansori404/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/anggialansori404/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Token Radar v2: pre-token protocols, priced by a model fitted on the market's own record.**
`main.ts` (Node 22, standard library only) reads the sealed DefiLlama
snapshot at `/input/snapshot.json`, fits its pricing model on the
snapshot's traded protocols, prices every pre-token protocol with that
fit, and writes a ranked board, a static dashboard that shows its work,
and the dossier the judges read.

## The board

The universe is the snapshot watchlist's own definition of a launch
candidate, applied at every size rather than only above its $50M
floor: a protocol must record no token and be a protocol in its own
right. Wrapped, staked and bridged products of a token that already
trades are set aside — WBTC, Binance staked ETH and USDT0 record no
token in the snapshot, but each is a product of a traded token — and
so are the categories where the record cannot separate a protocol
from a product (Bridge, Canonical Bridge, Liquid Staking, Liquid
Restaking, Restaked BTC, CEX), exchange-named products and versioned
pools. On this snapshot that leaves 198 protocols, all 40 watchlist
members among them. The traded protocols are never ranked; the
dashboard carries them apart as the evidence the fit stands on, each
with its recorded value beside the value the model would have given it.

## The model (`fitcomps-1`)

The previous model (comps-2) priced a protocol at its TVL times the
median multiple of its traded category peers, with three hand-set
multipliers (momentum, maturity, breadth) on top. This model instead
**estimates** its pricing rule from the 128 traded protocols whose
market cap the snapshot records — the protocols where the market has
already answered what a dollar of TVL is worth as a token:

```text
ln(mcap / TVL) = intercept + size_slope x (ln TVL - mean ln TVL) + group offset
implied value  = TVL x exp(fitted ln multiple)
```

- **Size slope** — fitted at **-0.48** on this snapshot: the market
  pays a smaller multiple for a bigger protocol; a protocol ten times
  the typical TVL carries about a third of the typical multiple.
  A flat-multiple model assumes this slope is zero; the traded record
  says it is the single largest correction available.
- **Group offset** — the median residual of the protocol's category,
  shrunk toward zero by n/(n+6), so a category with two traded members
  barely moves the price and one with fifteen moves it most of the
  way. Categories with no traded members take their family's offset;
  a protocol with neither takes the market's.
- **Fitting** — iteratively reweighted least squares with weights
  1/max(|residual|, 0.05), tracking the conditional median rather than
  the mean, so the snapshot's extreme multiples (0.0003x to 400x)
  cannot set the price for everyone.
- **Band** — each row's band is the interquartile range of its peer
  group's residuals around that group's centre, put through the same
  price: a group the market prices inconsistently honestly shows a
  wide band, and the band always brackets the estimate.

Three candidate signals were fitted and **rejected**: 7-day TVL
growth, protocol age and chain count each move the backtest error by
less than their own noise, so they are shown on every row as context
(and age sets the farm plan's holding period) but they do not move
the price.

## Validation

Deterministic 10-fold cross-validation over the 128 traded protocols
(five fold partitions drawn from slug hashes; refit on nine folds,
price the held-out fold, compare with the recorded market cap). The
program recomputes the v2 row of this table at run time and prints it
in the dashboard; the comps-2 row is the same harness run against the
previous model's formula.

| Metric (held-out) | comps-2 (v1) | fitcomps-1 (v2) |
| --- | ---: | ---: |
| Median absolute error | x4.44 | **x3.87** |
| Mean bias (log10) | -0.158 | **+0.037** |
| Priced within 2x of recorded | 21% | **32%** |
| Priced within 5x of recorded | 53% | **60%** |
| Spearman rank correlation | **0.424** | 0.413 |

The fitted model is the more accurate and far less biased pricer;
the two rank the traded population about equally well (the 0.011
Spearman gap is inside the partitions' own spread). On the board
itself the two models agree closely (rank correlation 0.886 over the
198 rows); the fitted model's main corrections are to compress the
largest protocols, whose flat multiples overstated them, and to stop
letting single outlier peers (a 400x multiple) price a whole category.

Every row carries a six-step farm plan generated from its own record
(category action, primary chain's gas tier, TVL-sized capital,
age-sized holding period), each step with a cost and a time. An
implied value is what a token would be worth if the protocol's record
stayed as it is; the radar does not predict whether or when a token
is issued, and it says a protocol *records* no token, because
DefiLlama's record is not proof that none exists.

## Layout

- `main.ts` — the program: snapshot in, board + data + dossier out.
- `lib/model.ts` — the fitted model, its backtest, the farm plans and
  the gate self-check.
- `vendor/makefun-board.ts` — the vendored dossier library.
- `dashboard/` — the static page (board, watchlist, fit evidence, the
  model), no network, no framework.
- `screenshots/` — the board, a protocol detail, the watchlist filter.

Run it the way the grader does, or locally against the kit snapshot:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Both runs write the same bytes: the build is deterministic — fixed
iteration counts, hash-drawn validation folds, slug tie-breaks.
