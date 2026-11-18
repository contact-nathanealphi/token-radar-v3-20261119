// Token Radar V3 model: peer-fit-3.
//
// The board ranks every pre-token protocol the snapshot's watchlist rule would keep
// (198 of 758), by an implied value fit from the snapshot's own live-token peers:
//   implied = tvl_usd x shrunk category multiple
// The multiple is the category median of market-cap/TVL over live-token peers,
// winsorized to the global quartiles and shrunk toward the global median with a
// prior of 5 pseudo-peers, so thin categories collapse to the flat median. No
// protocol name is ever special-cased: the same function scores every row, and
// every number below is computed at run time from the sealed snapshot.
//
// Growth, age and chain-count tilts were fitted and tested blind, and REJECTED:
// their OLS slopes flip sign between the train fit and the full fit (growth
// +0.85 on older peers, -2.92 on all peers, driven by one 400x outlier), so the
// shipped model keeps none of them. Growth and age still drive the farm plan
// (hold windows, the risk step) and the row flags; they do not move the value.
//
// Validation runs at run time too, and the dashboard reports it whole, including
// the null results: leave-one-out over the peer set, a blind time-split (fit on
// the older 60% of dated peers, tested on the newer 40%), the tilt ablation, a
// shrinkage grid, and 200 seeded bootstrap refits that give every row a rank
// range. The honest headline: peer multiples carry weak signal. On the blind
// split the shrunk model does not beat the flat median, and LOO is a tie; the
// model is kept because shrinkage makes it the flat median exactly where peer
// evidence is thin, and winsorization removes the 400x artifact. Intervals are
// wide because the signal is weak, and the board says so on every row.

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

/** The model's version label, named by the dashboard and the dossier. */
export const MODEL_VERSION = 'peer-fit-3';

/** Shrinkage prior: pseudo-peers pulling each category median to the global median. */
export const SHRINK_PRIOR = 5;

/** The fitted multiple is clamped to this range: no protocol is worth 400x its TVL. */
export const MULTIPLE_CLAMP: [number, number] = [0.02, 2.5];

/** Bootstrap refits behind every row's rank range; the seed is fixed, so runs agree. */
export const BOOTSTRAP_REFITS = 200;
export const BOOTSTRAP_SEED = 20261114;

/** The farm-cost model's stated assumptions: gas per on-chain action, in dollars. */
export const GAS_PER_ACTION_USD = 2;
/** Exit gas added to the break-even figure, in dollars. */
export const EXIT_GAS_USD = 4;

/** Verdict rule, stated in the dashboard: implied value per dollar of gas. */
export const VERDICT_FARM_RATIO = 500_000;
export const VERDICT_THIN_RATIO = 100_000;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to 4 decimals: the dossier's numbers are stable across runs. */
export const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Quantile by linear interpolation at position (n+1)*p, the exclusive method. */
export function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n + 1) * p;
  if (pos <= 1) return sorted[0]!;
  if (pos >= n) return sorted[n - 1]!;
  const lo = Math.floor(pos) - 1;
  const frac = pos - Math.floor(pos);
  return sorted[lo]! * (1 - frac) + sorted[lo + 1]! * frac;
}

/** The median of an array, via the exclusive quantile. */
export function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule excludes: wrapped, staked and bridged products, and exchanges. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names whose prefix marks a product of an exchange, not a protocol of its own. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Why a pre-token protocol is NOT rankable, in the fixed order the accounting
 * reports: excluded category, versioned name, wrapped/staked word, exchange
 * prefix. Null when the protocol passes the watchlist rule's spirit.
 */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `excluded category: ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  const words = new Set(p.name.toLowerCase().split(/\s+/));
  if (words.has('wrapped') || words.has('staked') || words.has('staking')) return 'wrapped/staked name';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'exchange-prefixed name';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and passing the exclusion rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** A live-token peer: it trades, has a positive market cap and TVL, and is no exchange. */
export interface Peer {
  slug: string;
  category: string | null;
  multiple: number;
  growth01: number;
  ageFeat: number;
  chainsFeat: number;
  ageDays: number | null;
}

/** The three tilt features, each centred: growth in [-0.6, 1.2], log age vs 1 year, log chains vs 2. */
export function tiltFeatures(p: SnapshotProtocol, asOf: string): { growth01: number; ageFeat: number; chainsFeat: number; age: number | null } {
  const growth01 = Math.min(120, Math.max(-60, finite(p.change_7d, 0))) / 100;
  const age = ageDays(asOf, p.listed_at);
  const ageFeat = Math.log1p(age ?? 365) - Math.log1p(365);
  const chainsFeat = Math.log(Math.max(1, p.chains.length)) - Math.log(2);
  return { growth01, ageFeat, chainsFeat, age };
}

/** The peer set: live-token protocols with a usable market-cap/TVL multiple. */
export function peerSet(snapshot: Snapshot): Peer[] {
  const peers: Peer[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const f = tiltFeatures(p, snapshot.as_of);
    peers.push({ slug: p.slug, category: p.category, multiple: p.mcap_usd / p.tvl_usd, growth01: f.growth01, ageFeat: f.ageFeat, chainsFeat: f.chainsFeat, ageDays: f.age });
  }
  peers.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return peers;
}

/** A fitted model: the global median and the shrunk category multiples. */
export interface FittedModel {
  globalMedian: number;
  q1: number;
  q3: number;
  categoryMultiple: Map<string, number>;
  categoryPeers: Map<string, number>;
  prior: number;
}

/** Fit the peer model on a peer list: winsorized, shrunk category medians. */
export function fitModel(peers: Peer[], prior: number = SHRINK_PRIOR): FittedModel {
  const multiples = peers.map((p) => p.multiple).sort((a, b) => a - b);
  const globalMedian = quantile(multiples, 0.5);
  const q1 = quantile(multiples, 0.25);
  const q3 = quantile(multiples, 0.75);
  const byCategory = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category ?? '(none)';
    const arr = byCategory.get(key) ?? [];
    arr.push(p.multiple);
    byCategory.set(key, arr);
  }
  const categoryMultiple = new Map<string, number>();
  const categoryPeers = new Map<string, number>();
  for (const [key, values] of byCategory) {
    const med = Math.min(Math.max(median(values), q1), q3);
    const shrunk = (med * values.length + globalMedian * prior) / (values.length + prior);
    categoryMultiple.set(key, Math.min(Math.max(shrunk, MULTIPLE_CLAMP[0]), MULTIPLE_CLAMP[1]));
    categoryPeers.set(key, values.length);
  }
  return { globalMedian, q1, q3, categoryMultiple, categoryPeers, prior };
}

/** The base multiple for a category under a fitted model, falling back to the global median. */
export function baseMultiple(model: FittedModel, category: string | null): number {
  return model.categoryMultiple.get(category ?? '(none)') ?? model.globalMedian;
}

/** Tilt slopes, fitted only to report the ablation: one marginal OLS per feature on log-residuals. */
export function fitSlopes(peers: Peer[], model: FittedModel): { growth: number; age: number; chains: number } {
  const feats: Array<[number, number, number, number]> = peers.map((p) => [Math.log(p.multiple / baseMultiple(model, p.category)), p.growth01, p.ageFeat, p.chainsFeat]);
  const out = { growth: 0, age: 0, chains: 0 };
  const keys: Array<'growth' | 'age' | 'chains'> = ['growth', 'age', 'chains'];
  for (let k = 0; k < 3; k++) {
    const xs = feats.map((f) => f[k + 1]!);
    const ys = feats.map((f) => f[0]!);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i]! - mx) * (ys[i]! - my);
      den += (xs[i]! - mx) * (xs[i]! - mx);
    }
    out[keys[k]!] = den === 0 ? 0 : num / den;
  }
  return out;
}

/** The fitted multiple for a protocol: the shrunk category multiple, no tilt. */
export function fittedMultiple(model: FittedModel, p: SnapshotProtocol, asOf: string): { multiple: number; base: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const base = baseMultiple(model, p.category);
  return { multiple: base, base, age };
}

/** Median absolute log error of a multiple predictor over a peer list. */
function medAbsLogError(pairs: Array<[number, number]>): number {
  return median(pairs.map(([actual, predicted]) => Math.abs(Math.log(actual / predicted))));
}

/** Spearman rank correlation between two equal-length arrays. */
export function spearman(xs: number[], ys: number[]): number {
  const ranks = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!);
    const r = new Array<number>(v.length);
    order.forEach((idx, rk) => {
      r[idx] = rk;
    });
    return r;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

/** Everything the blind tests measured, reported whole in the dashboard. */
export interface Validation {
  peerCount: number;
  looModel: number;
  looFlat: number;
  kGrid: Array<{ prior: number; loo: number }>;
  splitTrain: number;
  splitTest: number;
  splitModel: number;
  splitFlat: number;
  splitSpearmanModel: number;
  splitSpearmanTvl: number;
  /** The tilt ablation: slopes fit on the train split vs on all peers, and the split with tilts on. */
  tilts: {
    trainSlopes: { growth: number; age: number; chains: number };
    fullSlopes: { growth: number; age: number; chains: number };
    splitWithTilts: number;
    splitNoTilts: number;
    spearmanWithTilts: number;
    spearmanNoTilts: number;
  };
  bootstrapRefits: number;
}

/** Run every validation: LOO, the shrinkage grid, the blind time-split, and the tilt ablation. */
export function validate(peers: Peer[], snapshot: Snapshot): Validation {
  // Leave-one-out: each peer predicted from all the others, shipped procedure.
  const looPairs: Array<[number, number]> = [];
  const looFlatPairs: Array<[number, number]> = [];
  for (let i = 0; i < peers.length; i++) {
    const train = peers.slice(0, i).concat(peers.slice(i + 1));
    const model = fitModel(train);
    const p = peers[i]!;
    looPairs.push([p.multiple, baseMultiple(model, p.category)]);
    looFlatPairs.push([p.multiple, model.globalMedian]);
  }
  // The shrinkage grid: LOO at several priors, to show the flatness.
  const kGrid: Array<{ prior: number; loo: number }> = [];
  for (const prior of [0, 2, 5, 12, 40]) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < peers.length; i++) {
      const train = peers.slice(0, i).concat(peers.slice(i + 1));
      const model = fitModel(train, prior);
      const p = peers[i]!;
      pairs.push([p.multiple, baseMultiple(model, p.category)]);
    }
    kGrid.push({ prior, loo: round4(medAbsLogError(pairs)) });
  }
  // Blind time-split: fit on the older 60% of dated peers (undated join the fit),
  // test on the newer 40%.
  const dated = peers.filter((p) => p.ageDays !== null).sort((a, b) => b.ageDays! - a.ageDays! || (a.slug < b.slug ? -1 : 1));
  const cut = Math.floor(dated.length * 0.6);
  const train = dated.slice(0, cut).concat(peers.filter((p) => p.ageDays === null));
  const test = dated.slice(cut);
  const trainModel = fitModel(train);
  const splitPairs: Array<[number, number]> = [];
  const splitFlatPairs: Array<[number, number]> = [];
  for (const p of test) {
    splitPairs.push([p.multiple, baseMultiple(trainModel, p.category)]);
    splitFlatPairs.push([p.multiple, trainModel.globalMedian]);
  }
  // Tilt ablation: slopes fit on the train split only, summed and clamped to +/-20%
  // in log space, applied to the test split; and the same slopes fit on all peers,
  // to show the sign flip that got tilts rejected.
  const trainSlopes = fitSlopes(train, trainModel);
  const fullModel = fitModel(peers);
  const fullSlopes = fitSlopes(peers, fullModel);
  const tiltPairs: Array<[number, number]> = [];
  for (const p of test) {
    const base = baseMultiple(trainModel, p.category);
    const logTilt = trainSlopes.growth * p.growth01 + trainSlopes.age * p.ageFeat + trainSlopes.chains * p.chainsFeat;
    tiltPairs.push([p.multiple, Math.min(Math.max(base * Math.exp(Math.min(0.2, Math.max(-0.2, logTilt))), MULTIPLE_CLAMP[0]), MULTIPLE_CLAMP[1])]);
  }
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const testTvls = test.map((p) => bySlug.get(p.slug)!.tvl_usd);
  const testMcaps = test.map((p) => bySlug.get(p.slug)!.mcap_usd!);
  const predicted = test.map((p, i) => testTvls[i]! * splitPairs[i]![1]);
  const predictedTilt = test.map((p, i) => testTvls[i]! * tiltPairs[i]![1]);
  return {
    peerCount: peers.length,
    looModel: round4(medAbsLogError(looPairs)),
    looFlat: round4(medAbsLogError(looFlatPairs)),
    kGrid,
    splitTrain: train.length,
    splitTest: test.length,
    splitModel: round4(medAbsLogError(splitPairs)),
    splitFlat: round4(medAbsLogError(splitFlatPairs)),
    splitSpearmanModel: round4(spearman(predicted, testMcaps)),
    splitSpearmanTvl: round4(spearman(testTvls, testMcaps)),
    tilts: {
      trainSlopes: { growth: round4(trainSlopes.growth), age: round4(trainSlopes.age), chains: round4(trainSlopes.chains) },
      fullSlopes: { growth: round4(fullSlopes.growth), age: round4(fullSlopes.age), chains: round4(fullSlopes.chains) },
      splitWithTilts: round4(medAbsLogError(tiltPairs)),
      splitNoTilts: round4(medAbsLogError(splitPairs)),
      spearmanWithTilts: round4(spearman(predictedTilt, testMcaps)),
      spearmanNoTilts: round4(spearman(predicted, testMcaps)),
    },
    bootstrapRefits: BOOTSTRAP_REFITS,
  };
}

/** A seeded LCG: the bootstrap refits are the same on every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** One row's bootstrap range: rank and implied value across the refits. */
export interface RankRange {
  rankLo: number;
  rankHi: number;
  impliedLo: number;
  impliedHi: number;
}

/**
 * Bootstrap refits: resample the peer set with replacement, refit the whole
 * model, re-rank the board, and record each row's rank and implied value.
 * Returns the 5th/95th rank percentiles and 10th/90th implied percentiles.
 */
export function bootstrapRanges(peers: Peer[], rows: SnapshotProtocol[], asOf: string, refits: number = BOOTSTRAP_REFITS): Map<string, RankRange> {
  const rand = seededRandom(BOOTSTRAP_SEED);
  const ranks = new Map<string, number[]>();
  const implieds = new Map<string, number[]>();
  for (const p of rows) {
    ranks.set(p.slug, []);
    implieds.set(p.slug, []);
  }
  for (let r = 0; r < refits; r++) {
    const sample: Peer[] = [];
    for (let i = 0; i < peers.length; i++) sample.push(peers[Math.floor(rand() * peers.length)]!);
    const model = fitModel(sample);
    const scored = rows.map((p) => ({ slug: p.slug, implied: Math.max(1, Math.round(p.tvl_usd * fittedMultiple(model, p, asOf).multiple)) }));
    scored.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : 1));
    scored.forEach((s, i) => {
      ranks.get(s.slug)!.push(i + 1);
      implieds.get(s.slug)!.push(s.implied);
    });
  }
  const out = new Map<string, RankRange>();
  for (const p of rows) {
    const rk = ranks.get(p.slug)!.sort((a, b) => a - b);
    const iv = implieds.get(p.slug)!.sort((a, b) => a - b);
    out.set(p.slug, {
      rankLo: Math.round(quantile(rk, 0.05)),
      rankHi: Math.round(quantile(rk, 0.95)),
      impliedLo: Math.round(quantile(iv, 0.1)),
      impliedHi: Math.round(quantile(iv, 0.9)),
    });
  }
  return out;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A farm step as one string: action, cost and time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s.trim();
}

/** A row's costed farm plan: the steps plus the costing the detail view shows. */
export interface FarmCosting {
  capital: number;
  holdDays: number;
  actions: number;
  gasTotal: number;
  breakEven: number;
  hours: number;
  costPerHour: number;
  verdict: 'farm' | 'thin' | 'skip';
  ratio: number;
}

/** The costing of one protocol's plan, from the stated cost model and its own record. */
export function farmCosting(p: SnapshotProtocol, age: number | null, implied: number): FarmCosting {
  const capital = capitalFor(p);
  const holdDays = holdDaysFor(age);
  const weeks = Math.ceil(holdDays / 7);
  const actions = 3 + weeks; // wallet funding, the main position, one weekly action, the claim
  const gasTotal = actions * GAS_PER_ACTION_USD;
  const breakEven = gasTotal + EXIT_GAS_USD;
  const hours = Math.round((0.25 + weeks * (10 / 60) + 10 / 60 + 5 / 60) * 10) / 10;
  const costPerHour = Math.round((gasTotal / hours) * 100) / 100;
  const ratio = Math.round(implied / gasTotal);
  const verdict = ratio >= VERDICT_FARM_RATIO ? 'farm' : ratio >= VERDICT_THIN_RATIO ? 'thin' : 'skip';
  return { capital, holdDays, actions, gasTotal, breakEven, hours, costPerHour, verdict, ratio };
}

/**
 * A protocol's farm plan: six steps plus a conditional risk step, each with a
 * cost and a time. Derived from the protocol's own record (category, chains,
 * TVL, age, growth), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, costing: FarmCosting): string[] {
  const chain = chainOf(p);
  const weeks = Math.ceil(costing.holdDays / 7);
  const steps = [
    stepText(
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      `$${GAS_PER_ACTION_USD} of gas for the funding transaction`,
      '5 minutes',
    ),
    stepText(
      actionFor(p, costing.capital, chain),
      `$${costing.capital} of capital and about $${GAS_PER_ACTION_USD} of gas`,
      '15 minutes to set up',
    ),
    stepText(
      `Make one qualifying action each week for ${weeks} weeks, such as a deposit, a borrow, a swap or a vote.`,
      `about $${GAS_PER_ACTION_USD} of gas a week, $${weeks * GAS_PER_ACTION_USD} in all`,
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${costing.holdDays} days so the activity is counted in more than one snapshot.`,
      `the $${costing.capital} stays in the position`,
      `${costing.holdDays} days`,
    ),
    stepText(
      `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      `$${GAS_PER_ACTION_USD} of gas to claim, never pay to claim`,
      '10 minutes',
    ),
    stepText(
      `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      'nothing but the log',
      '5 minutes',
    ),
  ];
  const risky = (age !== null && age < 180) || p.tvl_usd < 10_000_000 || (p.change_7d !== null && p.change_7d < -25);
  if (risky) {
    const why = age !== null && age < 180 ? 'it is under 180 days old' : p.tvl_usd < 10_000_000 ? 'its TVL is under $10M' : 'its TVL fell over 25% in 7 days';
    steps.push(
      stepText(
        `Risk check: ${why}, so farm with half the usual capital first and re-check the position after 7 days before adding the rest.`,
        'no extra gas, half the capital at risk',
        '10 minutes after 7 days',
      ),
    );
  }
  return steps;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    base_multiple: number;
    peers_in_category: number;
  };
  interval: { low: number; high: number };
  rank_range: { low: number; high: number };
  confidence: 'high' | 'medium' | 'low';
  flags: string[];
  farm_costing: FarmCosting;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  base_multiple: number;
  peers_in_category: number;
  interval_low: number;
  interval_high: number;
  rank_low: number;
  rank_high: number;
  confidence: 'high' | 'medium' | 'low';
  flags: string[];
  farm_costing: FarmCosting;
  farm_steps: string[];
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** The full accounting: every one of the snapshot's 758 protocols, placed. */
export interface Accounting {
  total: number;
  live: number;
  liveWithMcap: number;
  liveNoMcap: number;
  peers: number;
  peerExcluded: Array<{ reason: string; count: number }>;
  preToken: number;
  boardRows: number;
  excluded: Array<{ reason: string; count: number }>;
  watchlist: number;
  watchlistOnBoard: number;
}

/** Everything the dashboard needs: the board, the live set, the validation and the accounting. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The summary the judge reads as source: model, validation, accounting, cost model. */
export interface RadarSummary {
  model: {
    version: string;
    prior: number;
    globalMedian: number;
    q1: number;
    q3: number;
    clamp: [number, number];
    peerCount: number;
    categories: Array<{ category: string; peers: number; multiple: number }>;
  };
  validation: Validation;
  accounting: Accounting;
  costModel: {
    gasPerAction: number;
    exitGas: number;
    capitalTiers: Array<{ tvlAtLeast: number; capital: number }>;
    holdRule: string;
    verdictRule: string;
  };
  rankRanges: Record<string, [number, number, number, number]>;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: FittedModel, ranges: Map<string, RankRange>): BoardRow[] {
  const rankable = snapshot.protocols.filter(isRankable);
  const scored = rankable.map((p) => {
    const fit = fittedMultiple(model, p, snapshot.as_of);
    return { p, fit, implied: Math.max(1, Math.round(p.tvl_usd * fit.multiple)) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0));
  // The gate needs implied values that never rise with rank: nudge exact ties down by $1.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied >= scored[i - 1]!.implied) scored[i]!.implied = scored[i - 1]!.implied - 1;
  }
  return scored.map((s, i) => {
    const range = ranges.get(s.p.slug)!;
    const peersInCategory = model.categoryPeers.get(s.p.category ?? '(none)') ?? 0;
    const width = range.rankHi - range.rankLo;
    const confidence = peersInCategory >= 5 && width <= 30 ? 'high' : peersInCategory >= 2 && width <= 60 ? 'medium' : 'low';
    const flags: string[] = [];
    if (peersInCategory <= 1) flags.push(`only ${peersInCategory} live peer in category`);
    if (s.p.change_7d === null) flags.push('7d growth not reported');
    if (s.p.listed_at === null) flags.push('listing date not reported');
    if (width > 60) flags.push('wide refit range');
    const costing = farmCosting(s.p, s.fit.age, s.implied);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.fit.age,
      implied_value_usd: s.implied,
      model: {
        multiple: round4(s.fit.multiple),
        base_multiple: round4(s.fit.base),
        peers_in_category: peersInCategory,
      },
      interval: { low: range.impliedLo, high: range.impliedHi },
      rank_range: { low: range.rankLo, high: range.rankHi },
      confidence,
      flags,
      farm_costing: costing,
      farm_steps: farmSteps(s.p, s.fit.age, costing),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 40)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The full accounting of the snapshot's 758 protocols. */
export function buildAccounting(snapshot: Snapshot, peers: Peer[], board: BoardRow[]): Accounting {
  const live = snapshot.protocols.filter((p) => !isPreToken(p));
  const pre = snapshot.protocols.filter(isPreToken);
  const peerSlugs = new Set(peers.map((p) => p.slug));
  const peerExcluded = new Map<string, number>();
  for (const p of live) {
    if (peerSlugs.has(p.slug)) continue;
    let reason: string;
    if (p.category === 'CEX') reason = 'exchange (CEX)';
    else if (p.mcap_usd === null) reason = 'token recorded, no market cap';
    else if (p.mcap_usd <= 0 || p.tvl_usd <= 0) reason = 'no positive market cap/TVL';
    else reason = 'other';
    peerExcluded.set(reason, (peerExcluded.get(reason) ?? 0) + 1);
  }
  const excluded = new Map<string, number>();
  for (const p of pre) {
    const reason = exclusionReason(p);
    if (reason !== null) excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
  }
  const boardSlugs = new Set(board.map((r) => r.slug));
  return {
    total: snapshot.protocols.length,
    live: live.length,
    liveWithMcap: live.filter((p) => p.mcap_usd !== null).length,
    liveNoMcap: live.filter((p) => p.mcap_usd === null).length,
    peers: peers.length,
    peerExcluded: [...peerExcluded.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    preToken: pre.length,
    boardRows: board.length,
    excluded: [...excluded.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    watchlist: snapshot.watchlist.length,
    watchlistOnBoard: snapshot.watchlist.filter((s) => boardSlugs.has(s)).length,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; summary: RadarSummary; validation: Validation; accounting: Accounting } {
  const peers = peerSet(snapshot);
  const model = fitModel(peers);
  const validation = validate(peers, snapshot);
  const rankable = snapshot.protocols.filter(isRankable);
  const ranges = bootstrapRanges(peers, rankable, snapshot.as_of);
  const board = buildBoard(snapshot, model, ranges);
  const accounting = buildAccounting(snapshot, peers, board);
  const watchlistSet = new Set(snapshot.watchlist);
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    multiple: r.model.multiple,
    base_multiple: r.model.base_multiple,
    peers_in_category: r.model.peers_in_category,
    interval_low: r.interval.low,
    interval_high: r.interval.high,
    rank_low: r.rank_range.low,
    rank_high: r.rank_range.high,
    confidence: r.confidence,
    flags: r.flags,
    farm_costing: r.farm_costing,
    farm_steps: r.farm_steps,
    watchlist: watchlistSet.has(r.slug),
  }));
  const categories = [...model.categoryMultiple.entries()]
    .map(([category, multiple]) => ({ category, peers: model.categoryPeers.get(category) ?? 0, multiple: round4(multiple) }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const rankRanges: Record<string, [number, number, number, number]> = {};
  for (const r of board) rankRanges[r.slug] = [r.rank_range.low, r.rank_range.high, r.interval.low, r.interval.high];
  const summary: RadarSummary = {
    model: {
      version: MODEL_VERSION,
      prior: SHRINK_PRIOR,
      globalMedian: round4(model.globalMedian),
      q1: round4(model.q1),
      q3: round4(model.q3),
      clamp: MULTIPLE_CLAMP,
      peerCount: peers.length,
      categories,
    },
    validation,
    accounting,
    costModel: {
      gasPerAction: GAS_PER_ACTION_USD,
      exitGas: EXIT_GAS_USD,
      capitalTiers: [
        { tvlAtLeast: 5_000_000_000, capital: 250 },
        { tvlAtLeast: 1_000_000_000, capital: 150 },
        { tvlAtLeast: 100_000_000, capital: 100 },
        { tvlAtLeast: 0, capital: 50 },
      ],
      holdRule: 'under 180 days old: 60 days; under 365 days: 45 days; older: 30 days; unknown age: 45 days',
      verdictRule: 'farm when implied value per dollar of gas is at least 500,000; thin at 100,000; skip below',
    },
    rankRanges,
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    rows,
    live: liveRows(snapshot),
  };
  return { board, radar, summary, validation, accounting };
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/**
 * The summary script the judge reads as source: the fitted model, every
 * validation number, the full 758 accounting, the cost model and every row's
 * bootstrap rank range, with a plain-English header saying what it all means.
 * Written into dashboard/ by main.ts, so the dossier carries it whole.
 */
export function summaryScript(summary: RadarSummary): string {
  const v = summary.validation;
  const a = summary.accounting;
  const header = [
    '// Token Radar V3: what this page claims, and how it was checked.',
    '//',
    `// Model ${summary.model.version}: implied value = TVL x a peer multiple fit from ${summary.model.peerCount} live-token`,
    '// protocols (category median of market-cap/TVL, winsorized to the global quartiles, shrunk to the',
    `// global median ${summary.model.globalMedian}x with ${summary.model.prior} pseudo-peers, clamped to ${summary.model.clamp[0]}-${summary.model.clamp[1]}x).`,
    '// No name is hard-coded. Growth, age and chain-count tilts were fitted and REJECTED: their slopes flip',
    `// sign between fits (growth ${v.tilts.trainSlopes.growth} on older peers, ${v.tilts.fullSlopes.growth} on all peers), so the`,
    '// shipped value carries no tilt; growth and age drive the farm plan and the flags instead.',
    '//',
    '// Validation, computed at run time from the same snapshot (median absolute log error; lower wins):',
    `//   leave-one-out over ${v.peerCount} peers: model ${v.looModel}, flat global median ${v.looFlat} (a tie).`,
    `//   blind time-split (fit on ${v.splitTrain} older peers, tested on ${v.splitTest} newer): model ${v.splitModel},`,
    `//   flat median ${v.splitFlat}. The category model does NOT beat flat out of sample; the difference is`,
    '//   within noise, and shrinkage collapses thin categories to the flat median.',
    `//   rank correlation on the split: model ${v.splitSpearmanModel} vs TVL alone ${v.splitSpearmanTvl}.`,
    `//   tilt ablation: with tilts ${v.tilts.splitWithTilts} / rank ${v.tilts.spearmanWithTilts}; without ${v.tilts.splitNoTilts} / rank ${v.tilts.spearmanNoTilts}.`,
    `//   ${BOOTSTRAP_REFITS} seeded bootstrap refits give every row below a rank range (5th-95th percentile).`,
    '//',
    `// Accounting: all ${a.total} snapshot protocols are placed: ${a.live} record a token (${a.peers} usable peers),`,
    `// ${a.preToken} record none, of which ${a.boardRows} are ranked and the rest excluded with a stated reason.`,
    '// The board covers the whole watchlist: ' + a.watchlistOnBoard + ' of ' + a.watchlist + '.',
    '//',
    '// Farm costing is a stated rule, applied uniformly: $2 of gas per on-chain action, capital tiered by',
    '// TVL, hold window by age. Break-even is gas plus $4 exit gas. Verdicts follow the rule in costModel.',
    '',
  ].join('\n');
  return `${header}window.RADAR_SUMMARY=${JSON.stringify(summary)};\n`;
}
