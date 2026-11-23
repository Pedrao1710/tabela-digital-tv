const storeBoundPaths = new Set([
  '/api/action',
  '/api/import/preview',
  '/api/import',
  '/api/media',
]);

// The page owns session state. The transport reads it at request/response time
// so an old response cannot restore data after logout or session replacement.
export function createRequest({
  getGeneration,
  getStoreId,
  hasUser,
  onUnauthorized,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
}) {
  return async function request(path, body) {
    const generation = getGeneration();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const options = {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    };
    try {
      if (body !== undefined) {
        options.method = 'POST';
        const storeId = getStoreId();
        if (storeId && storeBoundPaths.has(path)) options.headers['X-Store-Id'] = storeId;
        if (body instanceof FormData) {
          options.body = body;
        } else {
          options.headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify(body);
        }
      }
      let response;
      try {
        response = await fetchImpl(path, options);
      } catch {
        if (controller.signal.aborted) {
          throw new Error('O servidor demorou para responder. Tente novamente.');
        }
        throw new Error('Falha de conexão com a Tabela Digital. Tente novamente.');
      }
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted) {
        throw new Error('O servidor demorou para responder. Tente novamente.');
      }
      if (generation !== getGeneration()) throw new Error('A sessão mudou. Entre novamente.');
      if (response.status === 401 && hasUser() && path !== '/api/login') {
        onUnauthorized();
        throw new Error('Sua sessão terminou.');
      }
      if (!response.ok || !data || data.error) {
        const error = new Error(data?.error || 'O servidor não retornou uma resposta válida.');
        error.issues = Array.isArray(data?.issues) ? data.issues : [];
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  };
}
