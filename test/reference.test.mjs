import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { matchesPassword, tvState } from '../state.mjs';

test('migração copia contas isoladas, letreiro, preços, tela e fotos com credenciais em hash', async (t) => {
  const { copyReference } = await import('../reference.mjs');
  const root = await mkdtemp(join(tmpdir(), 'arapongas-reference-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assetsDir = join(root, 'assets');
  const dataDir = join(root, 'data');
  await mkdir(assetsDir);
  const file = 'carne.jpg';
  const jpeg = Buffer.alloc(24);
  jpeg.set([255, 216, 255]);
  await writeFile(join(assetsDir, file), jpeg);
  const snapshots = ['Loja A', 'Loja B'].map((name, index) => ({
    name,
    displayName: 'SUPERMERCADO ARAPONGAS',
    city: 'Campo Grande',
    message: 'BEM-VINDO!',
    rotationSeconds: 15,
    products: [{ code: '1', name: 'PICANHA kg', price: 11590 + index, promo: null }],
    lists: [{ key: 'l1', name: 'Carnes', codes: ['1'] }],
    screens: [
      { key: 'tv1', name: 'Açougue TV 1', listKeys: ['l1'], appearance: { oddColor: '#ed0707' } },
    ],
    media: [{ key: 'm1', name: 'Foto', file, screenKeys: ['tv1'], active: index === 0 }],
  }));
  const credentials = [
    { email: 'a@example.test', password: 'legacy-A' },
    { email: 'b@example.test', password: 'legacy-B' },
  ];
  copyReference({ dataDir, assetsDir, snapshots, credentials });
  const raw = await readFile(join(dataDir, 'state.json'), 'utf8');
  const db = JSON.parse(raw);
  assert.equal(db.users.length, 2);
  assert.notEqual(db.users[0].storeId, db.users[1].storeId);
  assert.ok(db.users.every((user) => user.role === 'operator'));
  assert.ok(matchesPassword('legacy-A', db.users[0].hash));
  assert.ok(!raw.includes('legacy-A'));
  assert.deepEqual(await readFile(join(dataDir, 'images', db.stores[0].media[0].id)), jpeg);
  const tv = tvState(db.stores[0], db.stores[0].screens[0]);
  assert.equal(tv.store.name, 'SUPERMERCADO ARAPONGAS');
  assert.equal(tv.store.message, 'BEM-VINDO!');
  assert.equal(tv.screen.appearance.oddColor, '#ed0707');
  assert.equal(tv.groups[0].products[0].price, 11590);
  assert.equal(tv.media.length, 1);
  assert.equal(tvState(db.stores[1], db.stores[1].screens[0]).media.length, 0);
  assert.throws(() => copyReference({ dataDir, assetsDir, snapshots, credentials }), /já contém/i);
  assert.equal(await readFile(join(dataDir, 'state.json'), 'utf8'), raw);
});

test('migração aceita PNG e WebP e rejeita conteúdo incompatível', async (t) => {
  const { copyReference } = await import('../reference.mjs');
  const root = await mkdtemp(join(tmpdir(), 'arapongas-formats-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assetsDir = join(root, 'assets');
  await mkdir(assetsDir);
  const png = Buffer.alloc(24);
  png.set(Buffer.from('89504e470d0a1a0a', 'hex'));
  const webp = Buffer.alloc(24);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  await writeFile(join(assetsDir, 'foto.png'), png);
  await writeFile(join(assetsDir, 'foto.webp'), webp);
  await writeFile(join(assetsDir, 'falsa.png'), webp);
  const snapshot = {
    name: 'Loja',
    rotationSeconds: 15,
    products: [],
    lists: [],
    screens: [],
    media: ['foto.png', 'foto.webp'].map((file, i) => ({
      key: String(i),
      name: file,
      file,
      active: true,
      screenKeys: [],
    })),
  };
  const credentials = [{ email: 'a@example.test', password: 'legacy-A' }];
  const dataDir = join(root, 'data');
  copyReference({ dataDir, assetsDir, snapshots: [snapshot], credentials });
  const db = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(
    db.stores[0].media.map((media) => media.mime),
    ['image/png', 'image/webp']
  );
  assert.throws(
    () =>
      copyReference({
        dataDir: join(root, 'invalid'),
        assetsDir,
        snapshots: [{ ...snapshot, media: [{ ...snapshot.media[0], file: 'falsa.png' }] }],
        credentials,
      }),
    /formato incompatível/
  );
});
