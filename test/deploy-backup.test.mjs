import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  'flock() { return 0; }',
  'timeout() { shift; "$@"; }',
  'realpath() { printf "%s\\n" "${@: -1}"; }',
  'mktemp() { printf "%s\\n" "$QA_SNAPSHOT"; }',
  'date() { printf "20261123T160000Z\\n"; }',
  'rm() { if [[ "${@: -1}" == "$TABELA_RUNTIME_DIR/maintenance" ]]; then "$QA_NODE" "$QA_UNLINK_SCRIPT" "$QA_MAINTENANCE"; fi; }',
  'gzip() { printf "archive\\n"; }',
  'tar() {',
  '  if [[ " $* " == *" -cf "* ]]; then',
  '    [[ "$QA_PHASE" != snapshot ]] || return 42',
  '    while (($#)); do if [[ "$1" == -cf ]]; then printf "snapshot\\n" > "$2"; break; fi; shift; done',
  '  fi',
  '}',
  'docker() { case "$1" in',
  '  inspect) if [[ "$*" == *Mounts* ]]; then printf "%s\\n" "$TABELA_DATA_DIR"; else printf "true false tabela-digital\\n"; fi;;',
  '  pause) printf "pause\\n" >> "$TABELA_RUNTIME_DIR/calls"; [[ "$QA_PHASE" != pause ]] || return 124;;',
  '  unpause) printf "unpause\\n" >> "$TABELA_RUNTIME_DIR/calls";;',
  '  *) return 2;;',
  'esac; }',
  'rclone() { printf "upload\\n" >> "$TABELA_RUNTIME_DIR/calls"; return 43; }',
  '. "$1"',
].join('\n');

test('backup retoma o painel em falha de pausa/snapshot e antes de transferência', { skip: !bash }, async t => {
  for (const [phase, status, expected] of [
    ['pause', 124, ['pause', 'unpause']],
    ['snapshot', 42, ['pause', 'unpause']],
    ['upload', 43, ['pause', 'unpause', 'upload']],
  ]) {
    const dir = await mkdtemp(join(tmpdir(), 'tabela-backup-control-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const app = join(dir, 'app');
    const data = join(dir, 'data');
    const runtime = join(dir, 'runtime');
    const snapshot = join(dir, 'snapshot');
    for (const path of [join(app, 'public'), data, runtime, snapshot]) await mkdir(path, { recursive: true });
    await writeFile(join(app, 'server.mjs'), '// fixture');
    await writeFile(join(data, 'state.json'), '{}');
    await writeFile(join(dir, 'unlink.mjs'), "import { unlinkSync } from 'node:fs'; unlinkSync(process.argv[2]);");
    const result = spawnSync(bash, ['--noprofile', '--norc', '-c', harness, 'backup-test', shellPath(join(root, 'deploy/linux/backup-two.sh'))], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, TABELA_APP_DIR: shellPath(app), TABELA_DATA_DIR: shellPath(data),
        TABELA_RUNTIME_DIR: shellPath(runtime), RCLONE_REMOTE: 'fake-crypt:qa',
        QA_PHASE: phase, QA_NODE: shellPath(process.execPath), QA_UNLINK_SCRIPT: join(dir, 'unlink.mjs'), QA_MAINTENANCE: join(runtime, 'maintenance'), QA_SNAPSHOT: shellPath(snapshot) },
    });
    assert.equal(result.status, status, phase + ': ' + result.stderr);
    assert.deepEqual((await readFile(join(runtime, 'calls'), 'utf8')).trim().split('\n'), expected, phase);
    assert.equal(existsSync(join(runtime, 'maintenance')), false, phase);
  }
});
