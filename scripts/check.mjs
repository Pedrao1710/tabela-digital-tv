import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sources = [];
const ignoredDirectories = new Set([
  'node_modules',
  'data',
  'data-demo',
  '.qa',
  '.git',
  'coverage',
  'dist',
  'build',
]);

async function collect(directory, recursive = false) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    // Do not follow symlinks into data or dependency directories.
    if (entry.isDirectory() && recursive && !ignoredDirectories.has(entry.name)) {
      await collect(path, true);
    } else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) {
      sources.push(path);
    }
  }
}

// The explicit roots keep private data and temporary artifacts outside the scan.
await collect(root);
for (const directory of ['public', 'scripts', 'test']) {
  await collect(join(root, directory), true);
}
sources.sort();

for (const path of sources) {
  const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error('Falha de sintaxe em ' + relative(root, path));
    process.exit(result.status ?? 1);
  }
}

console.log('Sintaxe conferida em ' + sources.length + ' arquivos JavaScript.');
