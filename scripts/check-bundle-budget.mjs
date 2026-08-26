import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const distDirectory = path.resolve(process.cwd(), 'dist');
const assetsDirectory = path.join(distDirectory, 'assets');

function budgetFromEnvironment(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const budgets = {
  // Event camera precedence, mapped Sprint fallback, remote tablet-bike
  // wiring, and the guarded club-tablet demo entry add about 3 KB to the
  // entry controller; the full owner/tablet surfaces remain lazy-loaded and
  // network-relevant compressed budgets stay unchanged.
  javascriptRawBytes: budgetFromEnvironment('TRACKLAB_BUDGET_JS_RAW_BYTES', 612_000),
  javascriptBrotliBytes: budgetFromEnvironment('TRACKLAB_BUDGET_JS_BR_BYTES', 175_000),
  cssRawBytes: budgetFromEnvironment('TRACKLAB_BUDGET_CSS_RAW_BYTES', 134_000),
  cssBrotliBytes: budgetFromEnvironment('TRACKLAB_BUDGET_CSS_BR_BYTES', 20_000),
  initialBrotliBytes: budgetFromEnvironment('TRACKLAB_BUDGET_INITIAL_BR_BYTES', 195_000),
};

async function sumBytes(filePaths) {
  const sizes = await Promise.all(filePaths.map(async (filePath) => (await stat(filePath)).size));
  return sizes.reduce((total, size) => total + size, 0);
}

const assetNames = await readdir(assetsDirectory);
const javascriptFiles = assetNames
  .filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name))
  .map((name) => path.join(assetsDirectory, name));
const cssFiles = assetNames
  .filter((name) => /^index-[A-Za-z0-9_-]+\.css$/.test(name))
  .map((name) => path.join(assetsDirectory, name));

if (javascriptFiles.length === 0 || cssFiles.length === 0) {
  throw new Error('The production entry JavaScript and CSS assets were not found in dist/assets.');
}

const javascriptBrotliFiles = javascriptFiles.map((filePath) => `${filePath}.br`);
const cssBrotliFiles = cssFiles.map((filePath) => `${filePath}.br`);
await Promise.all([...javascriptBrotliFiles, ...cssBrotliFiles].map((filePath) => readFile(filePath)));

const measurements = {
  javascriptRawBytes: await sumBytes(javascriptFiles),
  javascriptBrotliBytes: await sumBytes(javascriptBrotliFiles),
  cssRawBytes: await sumBytes(cssFiles),
  cssBrotliBytes: await sumBytes(cssBrotliFiles),
};
measurements.initialBrotliBytes = measurements.javascriptBrotliBytes + measurements.cssBrotliBytes;

const labels = {
  javascriptRawBytes: 'JavaScript raw',
  javascriptBrotliBytes: 'JavaScript Brotli',
  cssRawBytes: 'CSS raw',
  cssBrotliBytes: 'CSS Brotli',
  initialBrotliBytes: 'Initial JS + CSS Brotli',
};
const failures = [];

for (const [key, measuredBytes] of Object.entries(measurements)) {
  const maximumBytes = budgets[key];
  const status = measuredBytes <= maximumBytes ? 'PASS' : 'FAIL';
  console.log(`${status} ${labels[key]}: ${measuredBytes.toLocaleString()} / ${maximumBytes.toLocaleString()} bytes`);
  if (measuredBytes > maximumBytes) {
    failures.push(`${labels[key]} exceeded its budget by ${(measuredBytes - maximumBytes).toLocaleString()} bytes.`);
  }
}

if (failures.length > 0) {
  throw new Error(`Production bundle budget failed:\n- ${failures.join('\n- ')}`);
}
