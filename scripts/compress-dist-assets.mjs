import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const distDirectory = path.resolve(process.cwd(), 'dist');
const minimumBytes = 1_024;
const compressibleExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.svg',
  '.webmanifest',
]);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
  }));
  return files.flat();
}

async function companionIsCurrent(sourcePath, companionPath, sourceModifiedAt) {
  const companion = await stat(companionPath).catch(() => null);
  return Boolean(companion?.isFile() && companion.mtimeMs >= sourceModifiedAt);
}

const allFiles = await filesBelow(distDirectory);
const sourceFiles = allFiles.filter((filePath) => (
  !filePath.endsWith('.br')
  && !filePath.endsWith('.gz')
  && compressibleExtensions.has(path.extname(filePath))
));

let sourceBytes = 0;
let brotliBytes = 0;
let gzipBytes = 0;
let generatedFiles = 0;

for (const sourcePath of sourceFiles) {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.size < minimumBytes) {
    continue;
  }

  const brotliPath = `${sourcePath}.br`;
  const gzipPath = `${sourcePath}.gz`;
  const [brotliCurrent, gzipCurrent] = await Promise.all([
    companionIsCurrent(sourcePath, brotliPath, sourceStat.mtimeMs),
    companionIsCurrent(sourcePath, gzipPath, sourceStat.mtimeMs),
  ]);
  if (brotliCurrent && gzipCurrent) {
    continue;
  }

  const source = await readFile(sourcePath);
  const [brotliOutput, gzipOutput] = await Promise.all([
    brotliCompressAsync(source, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }),
    gzipAsync(source, { level: 9 }),
  ]);
  await Promise.all([
    writeFile(brotliPath, brotliOutput),
    writeFile(gzipPath, gzipOutput),
  ]);

  sourceBytes += source.length;
  brotliBytes += brotliOutput.length;
  gzipBytes += gzipOutput.length;
  generatedFiles += 2;
}

const percentage = sourceBytes > 0
  ? Math.round((1 - (brotliBytes / sourceBytes)) * 1_000) / 10
  : 0;
console.log(
  `Prepared ${generatedFiles} compressed files from ${sourceFiles.length} eligible assets. `
  + `${sourceBytes} raw bytes became ${brotliBytes} Brotli bytes (${percentage}% smaller) `
  + `and ${gzipBytes} gzip bytes.`,
);
