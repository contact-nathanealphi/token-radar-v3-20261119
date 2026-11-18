// Token Radar V3 entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, fits the peer-fit-3 model, validates it blind,
// ranks the 198 rankable pre-token protocols, and writes the board, the
// dashboard's data, the judge-readable summary and the dossier:
//
//   /output/board.json       the ranked board (the gate's rows)
//   /output/data.js          the dashboard's dataset (rows + live set)
//   /output/dashboard/       the page, plus summary.js written here: the fitted
//                            model, every validation number, the 758 accounting
//                            and every row's bootstrap rank range, so the judge
//                            reads the evidence as source, not just screenshots
//   /output/screenshots/     the three views, copied from the repository
//   /output/dossier.json     built last with the vendored make.fun library
//
// The program is deterministic: fixed bootstrap seed, fixed sort orders, fixed
// rounding. Both grader runs write the same bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, summaryScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar, summary, validation, accounting } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// The summary is generated, so the dossier's source carries the fitted numbers.
writeFileSync(join(out, 'dashboard', 'summary.js'), summaryScript(summary));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

/** Total dashboard source bytes: the judge reads it whole only under the text cap. */
let dashboardBytes = 0;
for (const name of readdirSync(join(out, 'dashboard'))) dashboardBytes += statSync(join(out, 'dashboard', name)).size;

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked\n` +
    `token radar: validation LOO model ${validation.looModel} vs flat ${validation.looFlat}; blind split model ${validation.splitModel} vs flat ${validation.splitFlat} (n=${validation.splitTest})\n` +
    `token radar: accounting ${accounting.total} = ${accounting.live} live + ${accounting.preToken} pre-token; board ${accounting.boardRows}, watchlist ${accounting.watchlistOnBoard}/${accounting.watchlist}\n` +
    `token radar: dashboard source ${dashboardBytes} bytes (cap ${TEXT_MAX_BYTES}); screenshots ${shots.length}\n`,
);
