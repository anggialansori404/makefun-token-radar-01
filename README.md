# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/anggialansori404/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/anggialansori404/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Token Radar: pre-token protocols, priced from the market's own multiples.**
`main.ts` (Node 22, standard library only) reads the sealed DefiLlama
snapshot at `/input/snapshot.json` and writes a ranked board of the
protocols that record no token yet, a static dashboard that explains
every rank, and the dossier the judges read.

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
members among them.

## The model (`comps-2`)

```text
implied = TVL x peer multiple x momentum x maturity x breadth
```

- **Peer multiple** — the median mcap/TVL of the traded protocols in
  the same category (its own set when it has at least 4 traded
  members, else its family's, else the whole market's), with peer
  ratios winsorised to [0.02, 5]. The band on each row is the peer
  set's interquartile range through the same adjustments.
- **Momentum** — 1 + 0.35 x clamp(7-day TVL change, -50%, +100%)/100.
- **Maturity** — 0.75 + 0.45 x min(age in days, 1460)/1460; an
  unknown listing date is priced as 270 days.
- **Breadth** — 1 + 0.04 x min(chains - 1, 5).

Confidence scores the evidence behind each number (peer depth, peer
agreement, reported growth and age, size); readiness is a separate
signal and never moves the value. Each detail view also shows an
airdrop pool at an assumed 8% community allocation — an assumption,
stated in the dashboard, not a snapshot figure. An implied value is
what a token would be worth if the protocol's record stayed as it
is; the radar does not predict whether or when a token is issued,
and it says a protocol *records* no token, because DefiLlama's
record is not proof that none exists.

Every row carries a six-step farm plan generated from its own record
(category action, primary chain's gas tier, TVL-sized capital,
age-sized holding period), each step with a cost and a time.

## Layout

- `main.ts` — the program: snapshot in, board + data + dossier out.
- `lib/model.ts` — the model, the farm plans and the gate self-check.
- `vendor/makefun-board.ts` — the vendored dossier library.
- `dashboard/` — the static page (board, watchlist, live peers, the
  model), no network, no framework.
- `screenshots/` — the board, a protocol detail, the watchlist.

Run it the way the grader does, or locally against the kit snapshot:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Both runs write the same bytes: the build is deterministic.
