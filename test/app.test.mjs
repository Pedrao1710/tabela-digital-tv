import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';

const line = (price, code = '004260', name = 'ANGUS ENTRECOT kg') =>
  '01010' + code + '0' + price + '016' + name.padEnd(50);

function priceFile(price) {
  const data = new FormData();
  data.set('file', new Blob([line(price) + '\r\n']), 'txitens.txt');
  return data;
}

test('Toledo usa os campos 5,6 e 12,5, com preço em centavos', async () => {
  const { parsePriceFile, DEFAULT_PARAMETERS } = await import('../catalog.mjs');
  const items = parsePriceFile(Buffer.from(line('06990') + '\r\n'), DEFAULT_PARAMETERS);
  assert.deepEqual(items, [{ code: '4260', name: 'ANGUS ENTRECOT kg', price: 6990, promo: null }]);
  assert.throws(
    () => parsePriceFile(Buffer.from(line('06990') + '\n' + line('01200')), DEFAULT_PARAMETERS),
    /duplicado/i
  );
  assert.throws(() => parsePriceFile(Buffer.from(line('0699X')), DEFAULT_PARAMETERS), /preço/i);
});

test('da importação à TV, com isolamento, proteção contra corrida e restauração após reiniciar', async (t) => {
  const { createApp } = await import('../server.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'tabela-digital-test-'));
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  let base;
  async function start() {
    server = createApp({ dataDir: dir });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
  }
  await start();
  const health = await fetch(base + '/healthz');
  assert.equal(health.status, 200);
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  assert.deepEqual(await health.json(), { ok: true, service: 'tabela-digital', version });
  const entry = await fetch(base + '/tv');
  assert.equal(entry.status, 200);
  assert.match(await entry.text(), /<form[^>]+method="post"[^>]+action="\/tv"/);
  let cookie = '';
  async function send(path, body, status = 200) {
    const headers = cookie ? { cookie } : {};
    if (body) headers.origin = base;
    if (body && !(body instanceof FormData)) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers, body });
    const json = await res.json();
    assert.equal(res.status, status, JSON.stringify(json));
    if (res.headers.has('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return json;
  }
  const action = (action, data = {}, status) => send('/api/action', { action, ...data }, status);
  await send('/api/state', null, 401);
  const setup = {
    name: 'Teste',
    email: 'owner@example.test',
    password: 'teste-interno-000',
    storeName: 'Loja A',
  };
  await send('/api/setup', setup, 403);
  const codeFile = join(dir, 'setup-code.txt');
  const setupCode = (await readFile(codeFile, 'utf8')).trim();
  await send('/api/setup', { ...setup, setupCode });
  await assert.rejects(readFile(codeFile), { code: 'ENOENT' });
  await send('/api/setup', { ...setup, setupCode }, 403);
  let state = await action('save-list', { name: 'Carnes', codes: ['004260'] });
  state = await action('save-screen', {
    name: 'TV do açougue',
    listIds: [state.lists[0].id],
    mediaIds: [],
    theme: 'red',
    rotationSeconds: null,
    rows: 8,
  });
  const tvPath = '/api/tv/' + state.screens[0].token;
  const displayUrl = base + '/tv/' + state.screens[0].token;
  const displayEntry = await fetch(displayUrl, { redirect: 'manual' });
  assert.equal(displayEntry.status, 302);
  assert.equal(displayEntry.headers.get('location'), '/tv');
  const readProducts = async () => (await send(tvPath)).groups.flatMap((group) => group.products);
  const preview = await send('/api/import/preview', priceFile('06990'));
  assert.deepEqual(await readProducts(), []);
  assert.equal(preview.added, 1);
  const wrong = priceFile('07990');
  wrong.set('ticket', preview.ticket);
  await send('/api/import', wrong, 409);
  const correct = priceFile('06990');
  correct.set('ticket', preview.ticket);
  state = await send('/api/import', correct);
  assert.equal((await readProducts())[0].price, 6990);
  const firstImport = state.imports[0].id;
  await send('/api/import', correct, 409);
  const newer = priceFile('07990');
  const nextPreview = await send('/api/import/preview', newer);
  newer.set('ticket', nextPreview.ticket);
  await send('/api/import', newer);
  assert.equal((await readProducts())[0].price, 7990);
  await action('restore-import', { id: firstImport });
  assert.equal((await readProducts())[0].price, 6990);
  const photo = new FormData();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHqkAAAAASUVORK5CYII=',
    'base64'
  );
  photo.set('file', new Blob([png], { type: 'image/png' }), 'produto.png');
  state = await send('/api/media', photo);
  const imageId = state.media[0].id;
  const screen = state.screens[0];
  await action('save-screen', {
    ...screen,
    appearance: { slider: 4, oddColor: '#ed0707', slideBackgroundId: imageId },
  });
  await action('set-product-image', { code: '004260', imageId });
  const tv = await send(tvPath);
  assert.equal(tv.screen.appearance.slider, 4);
  assert.equal(tv.screen.appearance.oddColor, '#ed0707');
  assert.equal(tv.groups[0].products[0].imageUrl, tv.screen.appearance.slideBackgroundUrl);
  const imageUrl = base + tv.groups[0].products[0].imageUrl;
  const anonymousImage = await fetch(imageUrl);
  assert.equal(anonymousImage.status, 401);
  const media = await fetch(imageUrl, { headers: { cookie } });
  assert.equal(media.headers.get('content-type'), 'image/png');
  assert.match(media.headers.get('cache-control'), /no-store/);
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), png);
  await action('set-media-active', { id: imageId, active: false });
  assert.equal((await fetch(imageUrl, { headers: { cookie } })).status, 404);
  assert.equal((await readProducts())[0].imageUrl, undefined);
  state = await action('add-store', { name: 'Loja B' });
  const otherId = state.stores.find((store) => store.name === 'Loja B').id;
  await action('add-user', {
    name: 'Operador',
    email: 'operador@example.test',
    password: 'teste-interno-111',
    storeId: otherId,
  });
  await send('/api/logout', {});
  await send(tvPath, null, 401);
  await send('/api/login', { email: 'operador@example.test', password: 'teste-interno-111' });
  state = await send('/api/state');
  assert.deepEqual(state.catalog, []);
  assert.deepEqual(state.screens, []);
  await send(tvPath, null, 404);
  await action('switch-store', { id: 'forbidden' }, 403);
  await new Promise((resolve) => server.close(resolve));
  cookie = '';
  await start();
  await send(tvPath, null, 401);
  await send('/api/login', { email: 'owner@example.test', password: 'teste-interno-000' });
  assert.equal((await readProducts())[0].price, 6990);
  const remote = await fetch(base + '/tv', {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: base },
    body: new URLSearchParams({ email: 'owner@example.test', password: 'teste-interno-000' }),
  });
  assert.equal(remote.status, 303);
  const displaySession = { cookie: remote.headers.get('set-cookie').split(';')[0] };
  const chooser = await fetch(base + '/tv', { headers: displaySession });
  assert.match(await chooser.text(), /TV do açougue/);
  const television = await fetch(base + tvPath, { headers: displaySession });
  assert.equal(television.status, 200);
  assert.match(television.headers.get('cache-control'), /no-store/);
  const dashboard = await fetch(base + '/api/state', { headers: displaySession });
  assert.ok([401, 403].includes(dashboard.status));
  const displayIdentity = await fetch(base + '/api/session', { headers: displaySession });
  assert.equal((await displayIdentity.json()).user, null);
  state = await send('/api/state');
  await action('rotate-link', { id: state.screens[0].id });
  await send(tvPath, null, 404);
});
