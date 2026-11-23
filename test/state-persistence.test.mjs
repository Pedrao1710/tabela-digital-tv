import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addStore, openState } from '../state.mjs';

test('estado só é publicado após sincronização durável e falha de sync mantém a versão anterior', (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabela-state-durable-'));
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const state = openState(dir, false);
  state.write((db) => addStore(db, 'Loja anterior'));
  const before = fs.readFileSync(join(dir, 'state.json'), 'utf8');
  let syncCalls = 0;
  t.mock.method(fs, 'fsyncSync', () => {
    syncCalls++;
    throw new Error('sincronização indisponível');
  });
  syncBuiltinESMExports();
  assert.throws(
    () => state.write((db) => addStore(db, 'Não publicar')),
    /sincronização indisponível/
  );
  assert.equal(syncCalls, 1);
  assert.equal(state.read().stores.length, 1);
  assert.equal(fs.readFileSync(join(dir, 'state.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);

  t.mock.restoreAll();
  syncBuiltinESMExports();
  state.write((db) => addStore(db, 'Loja nova'));
  const restarted = openState(dir, false);
  assert.deepEqual(
    restarted.read().stores.map((store) => store.name),
    ['Loja anterior', 'Loja nova']
  );
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('falha na troca do arquivo preserva a transação e limpa o temporário exclusivo', (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabela-state-rename-'));
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const state = openState(dir, false);
  state.write((db) => addStore(db, 'Original'));
  const before = fs.readFileSync(join(dir, 'state.json'), 'utf8');
  const pendingNames = [];
  t.mock.method(fs, 'renameSync', (pending, target) => {
    assert.equal(target, join(dir, 'state.json'));
    assert.match(pending, /state\.json\.[0-9a-f]{16}\.tmp$/);
    pendingNames.push(pending);
    throw new Error('troca indisponível');
  });
  syncBuiltinESMExports();
  for (let index = 0; index < 2; index++) {
    assert.throws(() => state.write((db) => addStore(db, 'Descartar')), /troca indisponível/);
  }
  assert.notEqual(pendingNames[0], pendingNames[1]);
  assert.equal(state.read().stores.length, 1);
  assert.equal(fs.readFileSync(join(dir, 'state.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});
