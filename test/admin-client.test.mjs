import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequest } from '../public/admin-client.js';

function client(fetchImpl, options = {}) {
  return createRequest({
    getGeneration: () => 0,
    getStoreId: () => 'loja-a',
    hasUser: () => true,
    onUnauthorized: () => {},
    fetchImpl,
    ...options,
  });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('cliente vincula a loja somente a mutações protegidas e lê o vínculo atual', async () => {
  const calls = [];
  let storeId = 'loja-a';
  const request = client(
    async (path, options) => {
      calls.push({ path, options });
      return json({ ok: true });
    },
    { getStoreId: () => storeId }
  );

  for (const path of ['/api/action', '/api/import/preview', '/api/import', '/api/media']) {
    await request(path, { action: 'exemplo' });
    const { options } = calls.at(-1);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Store-Id'], storeId);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { action: 'exemplo' });
    assert.equal(options.cache, 'no-store');
  }

  storeId = 'loja-b';
  await request('/api/action', {});
  assert.equal(calls.at(-1).options.headers['X-Store-Id'], 'loja-b');
  for (const path of ['/api/login', '/api/logout', '/api/setup', '/api/session']) {
    await request(path, {});
    assert.equal(calls.at(-1).options.headers['X-Store-Id'], undefined, path);
  }
  await request('/api/state');
  assert.equal(calls.at(-1).options.method, undefined);
  assert.equal(calls.at(-1).options.body, undefined);
  assert.equal(calls.at(-1).options.headers['X-Store-Id'], undefined);
  storeId = null;
  await request('/api/action', {});
  assert.equal(calls.at(-1).options.headers['X-Store-Id'], undefined);
});

test('upload mantém FormData e deixa o navegador definir o multipart', async () => {
  const body = new FormData();
  body.set('name', 'Foto de teste');
  let received;
  const request = client(async (_path, options) => {
    received = options;
    return json({ ok: true });
  });
  await request('/api/media', body);
  assert.equal(received.body, body);
  assert.equal(received.headers['Content-Type'], undefined);
  assert.equal(received.headers['X-Store-Id'], 'loja-a');
});

test('resposta iniciada antes do logout não restaura dados nem dispara outro encerramento', async () => {
  let generation = 1;
  let resolveResponse;
  let ended = 0;
  const response = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const request = client(() => response, {
    getGeneration: () => generation,
    onUnauthorized: () => {
      ended++;
    },
  });
  const pending = request('/api/state');
  generation++;
  resolveResponse(json({ store: { id: 'loja-a' } }));
  await assert.rejects(pending, /A sessão mudou/);
  assert.equal(ended, 0);
});

test('401 encerra sessão ativa, mas credencial inválida e sessão ausente mantêm o fluxo de login', async () => {
  let signedIn = true;
  let ended = 0;
  const request = client(async () => json({ error: 'E-mail ou senha inválidos.' }, 401), {
    hasUser: () => signedIn,
    onUnauthorized: () => {
      ended++;
    },
  });
  await assert.rejects(request('/api/login', {}), /E-mail ou senha inválidos/);
  assert.equal(ended, 0);
  signedIn = false;
  await assert.rejects(request('/api/state'), /E-mail ou senha inválidos/);
  assert.equal(ended, 0);
  signedIn = true;
  await assert.rejects(request('/api/state'), /Sua sessão terminou/);
  assert.equal(ended, 1);
});

test('erros de rede e respostas inválidas produzem mensagens úteis; validações preservam os detalhes', async () => {
  const offline = client(async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(offline('/api/state'), /Falha de conexão com a Tabela Digital/);
  const invalid = client(async () => new Response('<html>erro</html>', { status: 200 }));
  await assert.rejects(invalid('/api/state'), /O servidor não retornou uma resposta válida/);
  const rejected = client(async () =>
    json(
      {
        error: 'Arquivo inválido.',
        issues: ['Linha 2 sem preço.', 'Linha 3 sem código.'],
      },
      400
    )
  );
  await assert.rejects(rejected('/api/import', {}), (error) => {
    assert.equal(error.message, 'Arquivo inválido.');
    assert.deepEqual(error.issues, ['Linha 2 sem preço.', 'Linha 3 sem código.']);
    return true;
  });
});

test('requisição travada é abortada no prazo e a próxima consulta pode recuperar', async () => {
  let count = 0;
  let aborted = false;
  const request = client(
    async (_path, options) => {
      count++;
      if (count > 1) return json({ recovered: true });
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          },
          { once: true }
        );
      });
    },
    { timeoutMs: 15 }
  );
  await assert.rejects(request('/api/session'), /O servidor demorou para responder/);
  assert.equal(aborted, true);
  assert.deepEqual(await request('/api/session'), { recovered: true });
  assert.equal(count, 2);
});

test('corpo JSON travado também respeita o prazo e libera a consulta seguinte', async () => {
  let count = 0;
  let bodyAborted = false;
  const request = client(
    async (_path, options) => {
      count++;
      if (count > 1) return json({ recovered: true });
      return {
        ok: true,
        status: 200,
        json() {
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => {
                bodyAborted = true;
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              },
              { once: true }
            );
          });
        },
      };
    },
    { timeoutMs: 15 }
  );
  await assert.rejects(request('/api/session'), /O servidor demorou para responder/);
  assert.equal(bodyAborted, true);
  assert.deepEqual(await request('/api/session'), { recovered: true });
  assert.equal(count, 2);
});
