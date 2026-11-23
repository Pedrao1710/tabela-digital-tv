import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

test('administração carrega seus módulos e mantém os dados privados protegidos', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tabela-assets-'));
  const server = createApp({ dataDir, demo: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const html = await (await fetch(base + '/login')).text();
  assert.match(html, /<script[^>]*src="\/admin\.js"[^>]*type="module"/);
  const entry = await (await fetch(base + '/admin.js')).text();
  const imports = [...entry.matchAll(/from ['"]\.\/(admin-[\w-]+\.js)['"]/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(imports.sort(), [
    'admin-appearance.js',
    'admin-client.js',
    'admin-format.js',
    'admin-ui.js',
  ]);
  for (const name of imports) {
    const response = await fetch(base + '/' + name);
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await fetch(base + '/data/state.json')).status, 404);
  const tv = await fetch(base + '/tv');
  assert.match(await tv.text(), /<script src="\/tv-entry\.js" defer>/);
});
