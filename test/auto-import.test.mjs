import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { DEFAULT_PARAMETERS } from '../catalog.mjs';
import {
  createAutoImporter,
  loadAutoImportConfig,
  validateAutoImportConfig,
} from '../auto-import.mjs';

const row = (code, price, name) =>
  '01010' +
  String(code).padStart(6, '0') +
  '0' +
  String(price).padStart(5, '0') +
  '016' +
  name.padEnd(50, ' ');

test('importação automática isola lojas e preserva catálogo em arquivos indisponíveis, incompletos ou inválidos', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-auto-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = join(dir, '001.txt');
  const second = join(dir, '002.txt');
  await writeFile(first, row(1, 1234, 'CARNE') + '\n' + row(2, 4321, 'BIFE') + '\n');
  await writeFile(second, row(1, 9876, 'CARNE') + '\n');
  let db = {
    stores: ['A', 'B'].map((name) => ({
      name,
      catalog: [],
      imports: [],
      parameters: DEFAULT_PARAMETERS,
    })),
  };
  const state = {
    read: () => db,
    write(fn) {
      const draft = structuredClone(db);
      const result = fn(draft);
      db = draft;
      return result;
    },
  };
  const errors = [];
  const job = createAutoImporter(
    state,
    {
      intervalSeconds: 5,
      sources: [
        { store: 'A', path: first },
        { store: 'B', path: second },
      ],
    },
    { onError: (x) => errors.push(x) }
  );
  await job.poll();
  assert.equal(db.stores[0].catalog.length, 0);
  assert.equal(job.status(db.stores[0]).state, 'waiting');
  await job.poll();
  assert.equal(job.status(db.stores[0]).state, 'ok');
  assert.ok(job.status(db.stores[0]).lastSuccess);
  assert.equal(db.stores[0].catalog[0].price, 1234);
  assert.equal(db.stores[1].catalog[0].price, 9876);
  await writeFile(first, row(1, 9999, 'CARNE'));
  await job.poll();
  await job.poll();
  assert.equal(db.stores[0].catalog[0].price, 1234);
  await rm(first);
  await writeFile(second, 'registro quebrado');
  await job.poll();
  await job.poll();
  assert.equal(job.status(db.stores[0]).state, 'error');
  assert.ok(job.status(db.stores[0]).lastSuccess);
  assert.equal(db.stores[0].catalog.length, 2);
  assert.equal(db.stores[1].catalog[0].price, 9876);
  assert.ok(errors.length >= 2);
});

test('configuração rejeita caminhos relativos e lojas duplicadas', () => {
  assert.throws(() => validateAutoImportConfig({ sources: [{ store: 'A', path: 'file.txt' }] }));
  assert.throws(() =>
    validateAutoImportConfig({
      sources: [
        { store: 'A', path: 'C:\\one.txt' },
        { store: 'A', path: 'C:\\two.txt' },
      ],
    })
  );
  assert.equal(
    validateAutoImportConfig({ sources: [{ store: 'A', path: '\\\\server\\share\\txitens.txt' }] })
      .sources.length,
    1
  );
});

test('leituras que nunca terminam têm limite por fonte e global e liberam capacidade ao retornar', async () => {
  const content = Buffer.from(row(1, 1234, 'CARNE') + '\n');
  const metadata = { isFile: () => true, size: content.length, mtimeMs: 1000 };
  let db = {
    stores: ['A', 'B'].map((name) => ({
      name,
      catalog: [],
      imports: [],
      parameters: structuredClone(DEFAULT_PARAMETERS),
    })),
  };
  const state = {
    read: () => db,
    write(fn) {
      const draft = structuredClone(db);
      const result = fn(draft);
      db = draft;
      return result;
    },
  };
  let clock = 100000;
  let blocked = true;
  const outstanding = [];
  const counts = new Map();
  const job = createAutoImporter(
    state,
    {
      intervalSeconds: 5,
      sources: [
        { store: 'A', path: 'C:/qa/a.txt' },
        { store: 'B', path: 'C:/qa/b.txt' },
      ],
    },
    {
      now: () => clock,
      onError() {},
      fileStat(path) {
        if (!blocked) return Promise.resolve(metadata);
        counts.set(path, (counts.get(path) || 0) + 1);
        return new Promise((resolve) => outstanding.push(resolve));
      },
      fileRead: async () => content,
    }
  );
  const polls = [];
  for (let index = 0; index < 250; index++) {
    polls.push(job.poll());
    clock += 15001;
  }
  assert.equal(outstanding.length, 3);
  assert.ok([...counts.values()].every((count) => count <= 2));
  assert.ok(db.stores.every((store) => job.status(store).state === 'error'));
  assert.ok(db.stores.every((store) => store.catalog.length === 0));

  // Truly completed operations release capacity. Time passing alone did not.
  blocked = false;
  for (const release of outstanding) release(metadata);
  await Promise.all(polls);
  await job.poll();
  await job.poll();
  assert.ok(db.stores.every((store) => job.status(store).state === 'ok'));
  assert.ok(db.stores.every((store) => store.catalog[0].price === 1234));
});

test('fontes além do limite global recebem vez sem criar uma fila de leituras', async () => {
  const content = Buffer.from(row(1, 1234, 'CARNE') + '\n');
  const names = ['A', 'B', 'C', 'D', 'E'];
  let db = {
    stores: names.map((name) => ({
      name,
      catalog: [],
      imports: [],
      parameters: structuredClone(DEFAULT_PARAMETERS),
    })),
  };
  const state = {
    read: () => db,
    write(fn) {
      const draft = structuredClone(db);
      const result = fn(draft);
      db = draft;
      return result;
    },
  };
  let active = 0;
  let maximum = 0;
  const visited = new Set();
  const job = createAutoImporter(
    state,
    {
      intervalSeconds: 5,
      sources: names.map((name) => ({ store: name, path: 'C:/qa/' + name + '.txt' })),
    },
    {
      onError() {},
      async fileStat(path) {
        visited.add(path);
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        return { isFile: () => true, size: content.length, mtimeMs: 1000 };
      },
      fileRead: async () => content,
    }
  );
  for (let index = 0; index < 6; index++) await job.poll();
  assert.equal(visited.size, names.length);
  assert.ok(maximum <= 3);
  assert.ok(db.stores.every((store) => store.catalog[0]?.price === 1234));
});

test('catálogo restaurado é sinalizado sem substituir a escolha manual', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-manual-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'itens.txt');
  await writeFile(file, row(1, 1234, 'CARNE') + '\n');
  let db = {
    stores: [
      {
        id: 'a',
        name: 'A',
        catalog: [],
        imports: [],
        parameters: structuredClone(DEFAULT_PARAMETERS),
      },
    ],
  };
  const state = {
    read: () => db,
    write(fn) {
      const draft = structuredClone(db);
      const result = fn(draft);
      db = draft;
      return result;
    },
  };
  const job = createAutoImporter(state, { sources: [{ storeId: 'a', path: file }] });
  await job.poll();
  await job.poll();
  db.stores[0].catalog[0].price = 100;
  await job.poll();
  assert.equal(job.status(db.stores[0]).state, 'override');
  assert.equal(db.stores[0].catalog[0].price, 100);
  const restarted = createAutoImporter(state, { sources: [{ storeId: 'a', path: file }] });
  await restarted.poll();
  await restarted.poll();
  assert.equal(restarted.status(db.stores[0]).state, 'override');
  assert.equal(db.stores[0].catalog[0].price, 100);
  await writeFile(file, row(1, 5678, 'CARNE') + '\n');
  await restarted.poll();
  await restarted.poll();
  assert.equal(restarted.status(db.stores[0]).state, 'ok');
  assert.equal(db.stores[0].catalog[0].price, 5678);
});

test('fonte travada não impede outra loja e perde indicação de sucesso', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-trava-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = join(dir, '001.txt');
  const second = join(dir, '002.txt');
  await writeFile(first, row(1, 1234, 'CARNE') + '\n');
  await writeFile(second, row(1, 9876, 'CARNE') + '\n');
  let db = {
    stores: ['A', 'B'].map((name) => ({
      name,
      catalog: [],
      imports: [],
      parameters: structuredClone(DEFAULT_PARAMETERS),
    })),
  };
  const state = {
    read: () => db,
    write(fn) {
      const draft = structuredClone(db);
      const result = fn(draft);
      db = draft;
      return result;
    },
  };
  let blocked = false;
  let clock = 100000;
  const fs = await import('node:fs/promises');
  const job = createAutoImporter(
    state,
    {
      intervalSeconds: 5,
      sources: [
        { store: 'A', path: first },
        { store: 'B', path: second },
      ],
    },
    {
      now: () => clock,
      fileStat: (path) => (blocked && path === first ? new Promise(() => {}) : fs.stat(path)),
    }
  );
  await job.poll();
  await job.poll();
  blocked = true;
  void job.poll();
  await new Promise((resolve) => setTimeout(resolve, 25));
  clock += 16000;
  assert.equal(job.status(db.stores[0]).state, 'error');
  blocked = false;
  await job.poll();
  assert.equal(job.status(db.stores[1]).state, 'ok');
  assert.equal(db.stores[1].catalog[0].price, 9876);
});

test('fonte travada tenta novamente e resultado antigo não substitui o novo', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-retomada-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'itens.txt');
  await writeFile(file, row(1, 1234, 'CARNE') + '\n');
  let db = {
    stores: [
      { name: 'A', catalog: [], imports: [], parameters: structuredClone(DEFAULT_PARAMETERS) },
    ],
  };
  const state = {
    read: () => db,
    write(fn) {
      const draft = structuredClone(db);
      const result = fn(draft);
      db = draft;
      return result;
    },
  };
  const fs = await import('node:fs/promises');
  let clock = 100000,
    block = false,
    release;
  const job = createAutoImporter(
    state,
    { intervalSeconds: 5, sources: [{ store: 'A', path: file }] },
    {
      now: () => clock,
      onError() {},
      fileStat: (path) =>
        block
          ? new Promise((resolve) => {
              release = resolve;
            })
          : fs.stat(path),
    }
  );
  await job.poll();
  await job.poll();
  block = true;
  const old = job.poll();
  await new Promise((resolve) => setImmediate(resolve));
  clock += 16000;
  block = false;
  await writeFile(file, row(1, 9876, 'CARNE') + '\n');
  await job.poll();
  await job.poll();
  assert.equal(db.stores[0].catalog[0].price, 9876);
  release(await fs.stat(file));
  await old;
  assert.equal(db.stores[0].catalog[0].price, 9876);
  assert.equal(job.status(db.stores[0]).state, 'ok');
});

test('uma alteração dos parâmetros reinterpreta o mesmo arquivo após duas leituras estáveis', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-params-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'itens.txt');
  await writeFile(file, row(1, 1234, 'CARNE') + '\n');
  let db = {
    stores: [
      { name: 'A', catalog: [], imports: [], parameters: structuredClone(DEFAULT_PARAMETERS) },
    ],
  };
  const state = {
    read: () => db,
    write(fn) {
      const draft = structuredClone(db);
      const result = fn(draft);
      db = draft;
      return result;
    },
  };
  const job = createAutoImporter(state, { sources: [{ store: 'A', path: file }] });
  await job.poll();
  await job.poll();
  assert.equal(db.stores[0].catalog[0].name, 'CARNE');
  db.stores[0].parameters.name.length = 3;
  await job.poll();
  assert.equal(db.stores[0].catalog[0].name, 'CARNE');
  await job.poll();
  assert.equal(db.stores[0].catalog[0].name, 'CAR');
});

test('indisponibilidade da rede exige duas novas leituras bem-sucedidas antes de importar', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-rede-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'itens.txt');
  const contents = row(1, 1234, 'CARNE') + '\n';
  await writeFile(file, contents);
  let db = {
    stores: [
      { name: 'A', catalog: [], imports: [], parameters: structuredClone(DEFAULT_PARAMETERS) },
    ],
  };
  const state = {
    read: () => db,
    write(fn) {
      const draft = structuredClone(db);
      const result = fn(draft);
      db = draft;
      return result;
    },
  };
  const job = createAutoImporter(
    state,
    { sources: [{ store: 'A', path: file }] },
    { onError() {} }
  );
  await job.poll();
  await rm(file);
  await job.poll();
  await writeFile(file, contents);
  await job.poll();
  assert.equal(db.stores[0].catalog.length, 0);
  await job.poll();
  assert.equal(db.stores[0].catalog[0].price, 1234);
});

test('carrega padrão, migra nomes para IDs e preserva vínculo após renomear loja', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-bind-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'itens.txt');
  const configPath = join(dir, 'auto-import.json');
  await writeFile(file, row(1, 1234, 'CARNE') + '\n');
  await writeFile(
    configPath,
    JSON.stringify({ intervalSeconds: 5, sources: [{ store: 'Original', path: file }] })
  );
  let db = {
    stores: [
      {
        id: 'id-123',
        name: 'Original',
        catalog: [],
        imports: [],
        parameters: structuredClone(DEFAULT_PARAMETERS),
      },
    ],
  };
  const state = {
    read: () => db,
    write(fn) {
      const draft = structuredClone(db);
      const result = fn(draft);
      db = draft;
      return result;
    },
  };
  const config = loadAutoImportConfig(dir, undefined, db.stores);
  assert.equal(config.sources[0].storeId, 'id-123');
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).sources[0].storeId, 'id-123');
  db.stores[0].name = 'Renomeada';
  const reloaded = loadAutoImportConfig(dir, undefined, db.stores);
  const job = createAutoImporter(state, reloaded);
  await job.poll();
  await job.poll();
  assert.equal(db.stores[0].catalog[0].price, 1234);
});

test('não altera configuração ambígua e respeita caminho explícito', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tabela-bind-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(loadAutoImportConfig(dir, undefined, []), null);
  assert.throws(() => loadAutoImportConfig(dir, join(dir, 'ausente.json'), []), /não encontrado/);
  const custom = join(dir, 'custom.json');
  const raw = JSON.stringify({ sources: [{ store: 'Duplicada', path: join(dir, 'itens.txt') }] });
  await writeFile(custom, raw);
  assert.throws(
    () =>
      loadAutoImportConfig(dir, custom, [
        { id: '1', name: 'Duplicada' },
        { id: '2', name: 'Duplicada' },
      ]),
    /ambígua/
  );
  assert.equal(await readFile(custom, 'utf8'), raw);
});
