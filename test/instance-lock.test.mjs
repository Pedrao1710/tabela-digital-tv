import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { lockDataDirectory } from '../instance-lock.mjs';

test('outra instância não abre os mesmos dados e o bloqueio pode ser liberado', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-lock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const release = await lockDataDirectory(dir);
  await assert.rejects(lockDataDirectory(dir), /dados já estão em uso|porta de proteção/);
  await new Promise((resolve) => {
    release();
    setImmediate(resolve);
  });
  const releaseAgain = await lockDataDirectory(dir);
  releaseAgain();
});

test('encerramento inesperado libera a proteção para uma nova instância', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-crash-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const moduleUrl = pathToFileURL(join(process.cwd(), 'instance-lock.mjs')).href;
  const script = `import {lockDataDirectory} from ${JSON.stringify(moduleUrl)}; await lockDataDirectory(process.argv[1]); console.log('ready');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null && !child.killed) child.kill();
  });
  const [output] = await once(child.stdout, 'data');
  assert.match(output.toString(), /ready/);
  await assert.rejects(lockDataDirectory(dir), /dados já estão em uso|porta de proteção/);
  const ended = once(child, 'exit');
  child.kill();
  await ended;
  const release = await lockDataDirectory(dir);
  release();
});

test('servidores em portas diferentes não podem abrir a mesma pasta', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-instancias-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = {
    env: {
      ...process.env,
      TABELA_DATA: dir,
      TABELA_PORT: '0',
      TABELA_HOST: '127.0.0.1',
      TABELA_AUTO_IMPORT_CONFIG: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const first = spawn(process.execPath, ['server.mjs'], options);
  t.after(() => {
    if (first.exitCode === null && !first.killed) first.kill();
  });
  const [output] = await once(first.stdout, 'data');
  assert.match(output.toString(), /Tabela Digital Arapongas/);
  const second = spawn(process.execPath, ['server.mjs'], options);
  let errorText = '';
  second.stderr.on('data', (chunk) => {
    errorText += chunk.toString();
  });
  const [exitCode] = await once(second, 'exit');
  assert.notEqual(exitCode, 0);
  assert.match(errorText, /dados já estão em uso|porta de proteção/);
  const ended = once(first, 'exit');
  first.kill();
  await ended;
});
