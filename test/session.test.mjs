import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server.mjs';
import { addStore, addUser, openState } from '../state.mjs';

test('painel exige sessão e encerra o acesso ao sair', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tabela-session-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const email = 'qa@example.test';
  const password = 'teste-sintetico-educativo';
  openState(dataDir, false).write((db) => {
    const store = addStore(db, 'Loja de teste');
    addUser(db, { name: 'Responsável', email, password, storeId: store.id }, 'owner');
  });
  const origin = 'https://painel.example.test';
  const server = createApp({ dataDir, origin });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body, headers = {}) =>
    fetch(base + route, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'manual',
    });

  for (const route of ['/', '/cliente', '/telas/']) {
    const page = await fetch(base + route, { redirect: 'manual' });
    assert.equal(page.status, 302, route);
    assert.equal(page.headers.get('location'), '/login', route);
  }
  const loginPage = await fetch(base + '/login');
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.headers.get('cache-control'), /no-store/);
  const known = await post('/api/login', { email, password: 'incorreta' });
  const unknown = await post('/api/login', { email: 'outra@example.test', password: 'incorreta' });
  assert.equal(known.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(known.headers.has('set-cookie'), false);

  const authenticated = await post('/api/login', { email, password });
  assert.equal(authenticated.status, 200);
  const attributes = authenticated.headers.get('set-cookie');
  assert.match(attributes, /; HttpOnly/i);
  assert.match(attributes, /; SameSite=Strict/i);
  assert.match(attributes, /; Secure/i);
  const cookie = attributes.split(';')[0];
  const state = await fetch(base + '/api/state', { headers: { cookie } });
  assert.equal(state.status, 200);
  assert.match(state.headers.get('cache-control'), /no-store/);
  assert.equal((await post('/api/logout', {}, { cookie })).status, 200);
  const signedOut = await fetch(base + '/api/state', { headers: { cookie } });
  assert.equal(signedOut.status, 401);
});
