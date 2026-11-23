import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSessions, SESSION_SECONDS } from '../sessions.mjs';
import { createApp } from '../server.mjs';
import { openState, addStore, addUser } from '../state.mjs';

test('sessão persiste com token hasheado, expira em 14 dias absolutos e mantém revogação após reinício', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabela-session-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let clock = 1800000000000;
  const user = { id: 'user', storeId: 'store', hash: 'hash-de-senha-para-teste' };
  let sessions = openSessions(dir, () => clock);
  const raw = sessions.create(user, 'display');
  const serialized = readFileSync(join(dir, 'sessions.json'), 'utf8');
  assert.equal(serialized.includes(raw), false);
  assert.equal(serialized.includes(user.hash), false);
  const issued = sessions.get(raw, user);
  assert.equal(issued.scope, 'display');
  assert.equal(issued.expires - issued.createdAt, 14 * 24 * 60 * 60 * 1000);
  clock += SESSION_SECONDS * 1000 - 1;
  sessions = openSessions(dir, () => clock);
  assert.equal(sessions.get(raw, user).expires, issued.expires);
  assert.equal(sessions.get(raw, { ...user, hash: 'senha-alterada' }), null);
  clock++;
  assert.equal(sessions.get(raw, user), null);
  const next = sessions.create(user);
  sessions.remove(next);
  assert.equal(openSessions(dir, () => clock).get(next, user), null);
});

test('falha na persistência da revogação mantém token inválido após troca da senha', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabela-session-failure-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const oldUser = { id: 'user', storeId: 'store', hash: 'senha-antiga' };
  const sessions = openSessions(dir);
  const raw = sessions.create(oldUser);
  unlinkSync(join(dir, 'sessions.json'));
  mkdirSync(join(dir, 'sessions.json'));
  assert.throws(() => sessions.revokeUser(oldUser.id));
  assert.equal(sessions.get(raw, { ...oldUser, hash: 'senha-nova' }), null);
  assert.throws(() => openSessions(dir), /Não foi possível carregar/);
});

test('servidor mantém acesso após reiniciar, sem renovar prazo, e rejeita cookie no vencimento', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabela-session-expiry-'));
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  let clock = 1800000000000;
  openState(dir, false).write((db) => {
    const store = addStore(db, 'Loja teste');
    addUser(
      db,
      {
        name: 'Operador',
        storeId: store.id,
        email: 'session@example.test',
        password: 'senha-teste-sintetica',
      },
      'operator'
    );
  });
  async function start() {
    server = createApp({ dataDir: dir, now: () => clock });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return 'http://127.0.0.1:' + server.address().port;
  }
  let base = await start();
  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'session@example.test', password: 'senha-teste-sintetica' }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /Max-Age=1209600(?:;|$)/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await new Promise((resolve) => server.close(resolve));
  base = await start();
  clock += SESSION_SECONDS * 1000 - 1;
  const active = await fetch(base + '/api/state', { headers: { cookie } });
  assert.equal(active.status, 200);
  assert.equal(active.headers.has('set-cookie'), false);
  clock++;
  assert.equal((await fetch(base + '/api/state', { headers: { cookie } })).status, 401);
  const page = await fetch(base, { headers: { cookie }, redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login');
});
