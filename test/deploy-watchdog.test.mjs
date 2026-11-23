import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
const candidates = [process.env.TABELA_TEST_BASH, '/bin/bash', '/usr/bin/bash'];
if (git.status === 0) candidates.push(resolve(git.stdout.trim(), '../../../usr/bin/sh.exe'));
const bash = candidates.find(path => path && existsSync(path));
const shellPath = path => path.replaceAll('\\', '/').replace(/^([a-z]):\//i, (_, drive) => '/' + drive.toLowerCase() + '/');
const harness = [
  'install() { :; }',
  'flock() { [[ "${QA_BUSY:-0}" == 0 ]]; }',
  'timeout() { shift; "$@"; }',
  'date() { printf "%s\\n" "${QA_NOW:-1000}"; }',
  'docker() {',
  '  case "$1" in',
  '    inspect) printf "%s\\n" "$QA_STATE";;',
  '    restart) printf "restart\\n" >> "$TABELA_RUNTIME_DIR/calls"; return "${QA_FAIL:-0}";;',
  '    *) return 2;;',
  '  esac',
  '}',
  '. "$1"',
].join('\n');

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-watchdog-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  function run(extra = {}) {
    return spawnSync(bash, ['--noprofile', '--norc', '-c', harness, 'watchdog-test', shellPath(join(root, 'deploy/linux/watchdog.sh'))], {
      encoding: 'utf8',
      env: { ...process.env, TABELA_RUNTIME_DIR: shellPath(dir), QA_STATE: 'true false unhealthy tabela-digital', ...extra },
      timeout: 5000,
    });
  }
  async function calls() {
    try { return (await readFile(join(dir, 'calls'), 'utf8')).trim().split('\n').length; }
    catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  }
  return { dir, run, calls };
}

test('scripts Linux têm sintaxe Bash válida', { skip: !bash }, () => {
  for (const file of ['backup-two.sh', 'watchdog.sh', 'status.sh']) {
    const result = spawnSync(bash, ['-n', shellPath(join(root, 'deploy/linux', file))], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('watchdog não altera containers saudáveis, pausados, parados ou de outro serviço', { skip: !bash }, async t => {
  const f = await fixture(t);
  for (const state of ['true false healthy tabela-digital', 'true true unhealthy tabela-digital',
    'false false unhealthy tabela-digital', 'true false unhealthy outro-servico']) {
    const result = f.run({ QA_STATE: state });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(await f.calls(), 0);
});

test('watchdog respeita manutenção e operação concorrente', { skip: !bash }, async t => {
  const f = await fixture(t);
  assert.equal(f.run({ QA_BUSY: '1' }).status, 0);
  await writeFile(join(f.dir, 'maintenance'), 'manutenção de teste');
  assert.equal(f.run().status, 0);
  assert.equal(await f.calls(), 0);
});

test('watchdog limita tentativas mesmo quando a reinicialização falha', { skip: !bash }, async t => {
  const f = await fixture(t);
  assert.equal(f.run({ QA_FAIL: '7', QA_NOW: '1000' }).status, 7);
  assert.equal(await f.calls(), 1);
  assert.equal(f.run({ QA_NOW: '1100' }).status, 0);
  assert.equal(await f.calls(), 1);
  assert.equal(f.run({ QA_NOW: '1401' }).status, 0);
  assert.equal(await f.calls(), 2);
});
