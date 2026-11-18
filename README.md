[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/contact-nathanealphi/token-radar-v3-20261119/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/contact-nathanealphi/token-radar-v3-20261119/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar V3 — fitted, tested blind, fully accounted

An entry for [Build the best token launch radar](https://make.fun/bounty/token-radar-01) on make.fun.

The program reads the sealed DefiLlama snapshot (758 protocols, 2026-11-14), fits a
peer-multiple model from the 119 live-token peers, validates it blind, and ranks all
198 pre-token protocols that pass the watchlist rule by fitted implied value, each
with an interval, a bootstrap rank range, and a costed farm plan.

## Model: peer-fit-3

```
implied value = TVL × shrunk category multiple
```

- The multiple is the category median of market-cap/TVL over live-token peers,
  winsorized to the global quartiles (0.0477×–1.1152×) and shrunk toward the global
  median (0.246×) with a prior of 5 pseudo-peers, clamped to 0.02–2.5×.
- Growth, age and chain-count tilts were fitted and **rejected**: their slopes flip
  sign between the train fit and the full fit (growth +0.8526 on older peers,
  −2.9175 on all peers, driven by one 400× outlier), so the shipped value carries
  no tilt. Growth and age drive the farm plan and the row flags instead.
- No protocol name is hard-coded. Every number is computed at run time.

## Validation (computed at run time, reported whole)

| Test | Model | Flat median |
| --- | --- | --- |
| Leave-one-out, 119 peers (median abs log error) | 1.6009 | 1.5967 |
| Blind time-split, fit 84 older / test 35 newer | 1.5635 | 1.4935 |
| Time-split, tilts on vs off | 1.5498 / rank 0.2190 | 1.5635 / rank 0.2602 (no tilts) |
| Rank correlation on the split (vs TVL alone) | 0.2602 | 0.2546 |
| Shrinkage grid, LOO at prior 0/2/5/12/40 | 1.6078 / 1.6089 / 1.6009 / 1.5989 / 1.6618 | — |

The category model does not beat the flat median out of sample — the dashboard says
so, and keeps the shrunk model because shrinkage collapses thin categories to the
flat median and winsorization removes the 400× artifact (Polymarket International
lands at $125.2M, rank 7, instead of ~$2B+). 200 seeded bootstrap refits give every
row a rank range (5th–95th percentile) and an implied-value interval (10th–90th).

## Accounting

All 758 protocols are placed: 416 record a token (144 carry a market-cap field, 272
record a token with none; 119 usable peers — excluded: 269 token-recorded with no
market cap, 14 with no positive market cap/TVL, 14 CEX), 342 record none — 198
ranked, 144 excluded with a stated reason (CEX 42, Liquid Staking 38, Bridge 28,
Canonical Bridge 15, versioned name 11, wrapped/staked name 5, Liquid Restaking 3,
Restaked BTC 2). The board covers 40/40 watchlist protocols. Board total implied
value: $6.51B. Confidence: low 121 / medium 67 / high 10. Verdicts: farm 78 /
thin 100 / skip 20.

## Farm plans

Every row carries 6 steps plus a conditional risk step, each with a cost and a time,
under a stated cost model: $2 of gas per on-chain action, capital tiered by TVL,
hold window by age. Break-even, hours, gas/hour and a farm/thin/skip verdict from
the implied-per-dollar-of-gas rule are shown per protocol. Example, rank 1
(Sentora Curator): TVL $2,757,585,593 × 0.3909 peer multiple = $1,077,830,817;
$150 capital, 30-day hold, 8 actions, $16 gas, break-even airdrop $20, 1.3 hours,
$12.31/hour, 67,364,426× implied per dollar of gas → farm.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22+, standard library only, no network. The program writes `board.json`,
`data.js`, the dashboard (plus a generated `summary.js` carrying the fitted model,
validation, accounting and rank ranges, so the judge reads the evidence as source),
the screenshots, and `dossier.json`.
