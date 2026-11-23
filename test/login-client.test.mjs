import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createLoginClientAddress } from '../login-client.mjs';
import { createApp } from '../server.mjs';
import { openState } from '../state.mjs';

const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('cabeçalhos encaminhados não alteram o limite sem um proxy explicitamente confiável', () => {
  for (const trusted of [[], '', ['192.0.2.2']]) {
    const address = createLoginClientAddress(trusted);
    assert.equal(
      address(
        req('::ffff:192.0.2.1', { 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '203.0.113.1' })
      ),
      '192.0.2.1'
    );
  }
});

test('proxy confiável aceita somente um IP válido e normaliza IPv4 mapeado e IPv6', () => {
  const address = createLoginClientAddress('192.0.2.1, 2001:0db8:0:0:0:0:0:2');
  assert.equal(
    address(req('::ffff:192.0.2.1', { 'x-real-ip': '::ffff:c633:6407' })),
    '198.51.100.7'
  );
  assert.equal(
    address(req('2001:db8::2', { 'x-real-ip': '2001:0DB8:0:0:0:0:0:7' })),
    '2001:db8::7'
  );
  for (const invalid of [
    undefined,
    '',
    '198.51.100.1, 198.51.100.2',
    ['198.51.100.1'],
    'cliente.example',
    '198.51.100.1:1234',
    'fe80::1%eth0',
    '198.051.100.1',
  ]) {
    assert.equal(address(req('192.0.2.1', { 'x-real-ip': invalid })), '192.0.2.1');
  }
  assert.equal(address(req('192.0.2.1', { 'x-forwarded-for': '198.51.100.1' })), '192.0.2.1');
});

test('configuração de proxies falha fechada para curingas, redes e valores incorretos', () => {
  for (const invalid of [
    '*',
    'true',
    '0.0.0.0/0',
    '::/0',
    '0.0.0.0',
    '::',
    'proxy.local',
    '127.0.0.1,',
    1,
    ['127.0.0.1', 'bad'],
  ]) {
    assert.throws(() => createLoginClientAddress(invalid), /TABELA_TRUSTED_PROXIES/);
  }
  assert.equal(createLoginClientAddress('  ')(req('127.0.0.1')), '127.0.0.1');
});

async function app(t, trustedProxies) {
  const dataDir = await mkdtemp(join(tmpdir(), 'tabela-proxy-'));
  openState(dataDir, true);
  const server = createApp({ dataDir, trustedProxies });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  return (client, valid = false) =>
    fetch(base + '/api/login', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json', 'x-real-ip': client },
      body: JSON.stringify({
        email: valid ? 'santafe@arapongas.local' : 'unknown@example.test',
        password: valid ? 'demo-arapongas-2026' : 'incorrect',
      }),
    });
}

test('duas origens pelo mesmo proxy confiável mantêm limites de login independentes', async (t) => {
  const login = await app(t, ['127.0.0.1']);
  for (let i = 0; i < 12; i++) assert.equal((await login('198.51.100.1')).status, 401);
  assert.equal((await login('198.51.100.1', true)).status, 429);
  assert.equal((await login('198.51.100.2', true)).status, 200);
  assert.equal((await login('198.51.100.1')).status, 429);
});

test('mudar X-Real-IP de um cliente direto não contorna o limite existente', async (t) => {
  const login = await app(t, []);
  for (let i = 0; i < 12; i++) assert.equal((await login('198.51.100.' + (i + 1))).status, 401);
  assert.equal((await login('203.0.113.2', true)).status, 429);
});

test('variável de ambiente inválida impede iniciar o serviço', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tabela-proxy-config-'));
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    const child = spawnSync(process.execPath, ['server.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        TABELA_DATA: dataDir,
        TABELA_HOST: '127.0.0.1',
        TABELA_PORT: '0',
        TABELA_TRUSTED_PROXIES: '*',
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /TABELA_TRUSTED_PROXIES/);
    assert.doesNotMatch(child.stdout, /Tabela Digital Arapongas/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
