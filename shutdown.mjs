// Stop accepting new requests, let in-flight work finish, and enforce a bound
// shorter than Docker's stop_grace_period.
export function closeServer(server, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let forced = false;
    const timer = setTimeout(() => {
      forced = true;
      server.closeAllConnections();
    }, timeoutMs);
    timer.unref();
    // Active keep-alive requests may become idle after close() has started.
    const idleDrain = setInterval(() => server.closeIdleConnections(), 50);
    idleDrain.unref();
    server.close((error) => {
      clearTimeout(timer);
      clearInterval(idleDrain);
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve({ forced });
    });
    server.closeIdleConnections();
  });
}
