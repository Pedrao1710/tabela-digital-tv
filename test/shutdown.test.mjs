import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { closeServer } from '../shutdown.mjs';

test('encerramento espera a resposta em andamento e fecha as conexões ociosas', async () => {
  let respond;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const server = createServer((_req, res) => {
    respond = () => res.end('concluído');
    entered();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const response = fetch('http://127.0.0.1:' + server.address().port);
  await started;
  const stopped = closeServer(server, { timeoutMs: 1000 });
  respond();
  assert.equal(await (await response).text(), 'concluído');
  assert.deepEqual(await stopped, { forced: false });
  assert.equal(server.listening, false);
});

test('encerramento limita uma conexão cuja resposta nunca termina', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.write('início');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = get('http://127.0.0.1:' + server.address().port);
  request.on('error', () => {});
  await once(request, 'response');
  const result = await closeServer(server, { timeoutMs: 20 });
  assert.deepEqual(result, { forced: true });
  assert.equal(server.listening, false);
});
