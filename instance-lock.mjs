import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';

// A listening socket is closed by the operating system even if the process
// crashes. Hash the real data path so separate application ports cannot write
// the same data concurrently. A port collision fails closed.
export async function lockDataDirectory(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  let canonical = realpathSync(dataDir);
  if (process.platform === 'win32') canonical = canonical.toLowerCase();
  const hash = createHash('sha256').update(canonical).digest();
  const port = 20000 + (hash.readUInt32BE(0) % 29152);
  const guard = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    guard.once('error', reject);
    guard.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      guard.removeListener('error', reject);
      resolve();
    });
  }).catch((error) => {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      throw new Error(
        'Os dados já estão em uso ou a porta de proteção está ocupada. Feche a outra instância antes de iniciar.'
      );
    }
    throw error;
  });
  let released = false;
  return () => {
    if (!released) {
      released = true;
      guard.close();
    }
  };
}
