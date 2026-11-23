import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapStores, STORES } from '../bootstrap-stores.mjs';
import { matchesPassword } from '../state.mjs';

test('inicialização cria contas separadas, associa as fontes e não grava senhas em claro', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabela-bootstrap-'));
  try {
    const config = join(dir, 'auto-import.json');
    bootstrapStores({
      dataDir: dir,
      configPath: config,
      passwords: ['segredo-demo-1', 'segredo-demo-2'],
    });
    const raw = readFileSync(join(dir, 'state.json'), 'utf8');
    const db = JSON.parse(raw);
    assert.equal(db.stores.length, 2);
    assert.equal(db.users.length, 2);
    assert.notEqual(db.users[0].storeId, db.users[1].storeId);
    assert.equal(matchesPassword('segredo-demo-1', db.users[0].hash), true);
    assert.equal(raw.includes('segredo-demo-1'), false);
    const settings = JSON.parse(readFileSync(config, 'utf8'));
    assert.deepEqual(
      settings.sources,
      STORES.map((s) => ({ store: s.name, path: s.path }))
    );
    const before = raw;
    assert.throws(
      () => bootstrapStores({ dataDir: dir, configPath: config, passwords: ['x', 'y'] }),
      /já existe/
    );
    assert.equal(readFileSync(join(dir, 'state.json'), 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('não substitui configuração preexistente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabela-bootstrap-'));
  try {
    const config = join(dir, 'auto-import.json');
    writeFileSync(config, 'pré-existente');
    assert.throws(
      () => bootstrapStores({ dataDir: dir, configPath: config, passwords: ['x', 'y'] }),
      /já existe/
    );
    assert.equal(readFileSync(config, 'utf8'), 'pré-existente');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
