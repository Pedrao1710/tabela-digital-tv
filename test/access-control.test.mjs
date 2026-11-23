import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { openState, addStore, addUser, token } from '../state.mjs';

async function fixture(t, empty = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'tabela-access-'));
  const screen = token();
  const otherScreen = token();
  const password = 'teste-sintetico-acesso';
  if (!empty)
    openState(dataDir, false).write((db) => {
      const store = addStore(db, 'Loja A');
      const other = addStore(db, 'Loja B');
      for (const [item, key] of [
        [store, screen],
        [other, otherScreen],
      ])
        item.screens.push({ id: 'screen', token: key, name: 'TV', listIds: [], mediaIds: [] });
      addUser(
        db,
        { name: 'Operador', email: 'operador@example.test', password, storeId: store.id },
        'operator'
      );
    });
  const server = createApp({ dataDir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, data, cookie = '', extra = {}) =>
    fetch(base + path, {
      method: 'POST',
      redirect: 'manual',
      headers: { origin: base, 'content-type': 'application/json', cookie, ...extra },
      body: JSON.stringify(data),
    });
  const login = async () => {
    const res = await post('/api/login', { email: 'operador@example.test', password });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  };
  return { dataDir, base, post, login, password, screen, otherScreen };
}

test('TV e imagens exigem sessão, loja correta e escopo de exibição limitado', async (t) => {
  const f = await fixture(t);
  for (const path of [
    '/api/state',
    '/api/tv/' + f.screen,
    '/media/' + f.screen + '/' + 'a'.repeat(24),
  ]) {
    assert.equal((await fetch(f.base + path)).status, 401, path);
  }
  const form = new URLSearchParams({ email: 'operador@example.test', password: f.password });
  const entry = await fetch(f.base + '/tv');
  assert.equal(
    entry.headers.get('referrer-policy'),
    'same-origin',
    'O formulário nativo precisa preservar Origin para passar pela validação CSRF.'
  );
  const login = await fetch(f.base + '/tv', {
    method: 'POST',
    redirect: 'manual',
    headers: { origin: f.base },
    body: form,
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(f.base + '/api/tv/' + f.screen, { headers: { cookie } })).status, 200);
  assert.equal(
    (await fetch(f.base + '/api/tv/' + f.otherScreen, { headers: { cookie } })).status,
    404
  );
  assert.equal((await fetch(f.base + '/api/state', { headers: { cookie } })).status, 403);
  assert.equal(
    (await f.post('/api/action', { action: 'update-profile', name: 'Indevido' }, cookie)).status,
    403
  );
  await f.post('/api/logout', {}, cookie);
  assert.equal((await fetch(f.base + '/api/tv/' + f.screen, { headers: { cookie } })).status, 401);
});

test('troca de senha revoga todas as sessões antigas e rotaciona a sessão atual', async (t) => {
  const f = await fixture(t);
  const first = await f.login();
  const second = await f.login();
  const changed = await f.post(
    '/api/action',
    {
      action: 'change-password',
      currentPassword: f.password,
      password: 'nova-senha-sintetica',
    },
    second
  );
  assert.equal(changed.status, 200);
  const rotated = changed.headers.get('set-cookie').split(';')[0];
  assert.notEqual(rotated, second);
  for (const cookie of [first, second])
    assert.equal((await fetch(f.base + '/api/state', { headers: { cookie } })).status, 401);
  assert.equal((await fetch(f.base + '/api/state', { headers: { cookie: rotated } })).status, 200);
});

test('cadastro inicial exige código local e rejeita proxy e repetição', async (t) => {
  const f = await fixture(t, true);
  const input = {
    name: 'Responsável',
    email: 'responsavel@example.test',
    password: f.password,
    storeName: 'Loja A',
  };
  assert.equal((await f.post('/api/setup', input)).status, 403);
  const code = (await readFile(join(f.dataDir, 'setup-code.txt'), 'utf8')).trim();
  input.setupCode = code;
  assert.equal((await f.post('/api/setup', input, '', { forwarded: 'for=192.0.2.1' })).status, 403);
  assert.equal((await f.post('/api/setup', input)).status, 200);
  assert.equal((await f.post('/api/setup', input)).status, 403);
  assert.equal((await fetch(f.base + '/setup-code.txt')).status, 404);
  assert.equal((await fetch(f.base + '/data/state.json')).status, 404);
});

test('origem externa é bloqueada e tentativas de login têm limite', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.post('/api/login', {}, '', { origin: 'https://externo.example.test' })).status,
    403
  );
  for (let i = 0; i < 12; i++)
    assert.equal(
      (await f.post('/api/login', { email: 'inexistente@example.test', password: 'incorreta' }))
        .status,
      401
    );
  assert.equal(
    (await f.post('/api/login', { email: 'operador@example.test', password: f.password })).status,
    429
  );
});
