import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const releaseName = 'tabela-digital-tv-' + manifest.version;
const destination = join(root, 'release');
const archive = join(destination, releaseName + '.tar.gz');
try {
  await lstat(archive);
  throw new Error('Este pacote já existe; não sobrescreva uma versão emitida.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(destination, { recursive: true });
const staging = await mkdtemp(join(tmpdir(), 'tabela-release-'));
const releaseDir = join(staging, releaseName);
const privateParts = new Set(['data', 'data-demo', '.qa', 'node_modules', '.git', 'release']);
const files = [];
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink())
      throw new Error('Link simbólico não permitido no pacote: ' + relative);
    if (
      privateParts.has(entry.name) ||
      (entry.name.startsWith('.env') && !entry.name.endsWith('.example'))
    ) {
      throw new Error('Conteúdo privado não permitido no pacote: ' + relative);
    }
    if (entry.isDirectory()) await collect(join(directory, entry.name), relative);
    else if (entry.isFile()) files.push(relative);
  }
}
try {
  await mkdir(releaseDir);
  const roots = (await readdir(root)).filter((name) => /\.mjs$/.test(name));
  const allowed = [
    ...roots,
    'public',
    'deploy',
    'test',
    'scripts',
    'package.json',
    'package-lock.json',
    '.prettierrc.json',
    '.prettierignore',
    '.editorconfig',
    '.dockerignore',
    '.gitignore',
    'README.md',
    'ARQUITETURA.md',
    'REVISAO-LOGIN.md',
    'REVISAO.md',
    'OPERACAO-24H.md',
  ];
  for (const name of allowed) {
    const info = await lstat(join(root, name));
    if (info.isSymbolicLink()) throw new Error('Link não permitido: ' + name);
    await cp(join(root, name), join(releaseDir, name), { recursive: true, dereference: false });
  }
  await writeFile(
    join(releaseDir, 'RELEASE.json'),
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        createdAt: new Date().toISOString(),
        status: 'candidate',
        productionValidated: false,
        privateDataIncluded: false,
      },
      null,
      2
    ) + '\n'
  );
  await collect(releaseDir);
  files.sort();
  const checksums = [];
  for (const name of files) {
    checksums.push(
      createHash('sha256')
        .update(await readFile(join(releaseDir, name)))
        .digest('hex') +
        '  ' +
        name
    );
  }
  await writeFile(join(releaseDir, 'SHA256SUMS'), checksums.join('\n') + '\n');
  const result = spawnSync('tar', ['-czf', archive, '-C', staging, releaseName], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Falha ao criar o arquivo do pacote.');
  const sha = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  await writeFile(archive + '.sha256', sha + '  ' + releaseName + '.tar.gz\n');
  console.log(
    JSON.stringify(
      { archive, sha256: sha, files: files.length, privateDataIncluded: false },
      null,
      2
    )
  );
} finally {
  const temporary = resolve(staging);
  const expectedPrefix =
    resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/') + 'tabela-release-';
  if (temporary.startsWith(expectedPrefix)) await rm(temporary, { recursive: true, force: true });
}
