import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const SESSION_SECONDS = 14 * 24 * 60 * 60;
const tokenPattern = /^[a-f0-9]{48}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const credential = (user) => digest(user.hash);

// Raw session tokens exist only in the response cookie. The persisted index
// cannot be replayed as a cookie if it is accidentally disclosed.
export function openSessions(dataDir, now = Date.now) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'sessions.json');
  let entries = {};
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.schema !== 1 || !Array.isArray(saved.sessions))
      throw new Error('Formato de sessões inválido.');
    for (const session of saved.sessions) {
      if (
        !digestPattern.test(session.key) ||
        !digestPattern.test(session.credential) ||
        typeof session.userId !== 'string' ||
        typeof session.storeId !== 'string' ||
        !['admin', 'display'].includes(session.scope) ||
        !Number.isSafeInteger(session.createdAt) ||
        !Number.isSafeInteger(session.expires) ||
        session.expires !== session.createdAt + SESSION_SECONDS * 1000
      ) {
        throw new Error('Registro de sessão inválido.');
      }
      entries[session.key] = session;
    }
    chmodSync(file, 0o600);
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Não foi possível carregar as sessões. Confira sessions.json.', {
        cause: error,
      });
  }

  function persist(next) {
    const pending = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    let descriptor;
    try {
      descriptor = openSync(pending, 'wx', 0o600);
      writeFileSync(
        descriptor,
        JSON.stringify({ schema: 1, sessions: Object.values(next) }) + '\n'
      );
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(pending, file);
      entries = next;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      try {
        unlinkSync(pending);
      } catch {}
      throw error;
    }
  }

  function active() {
    return Object.fromEntries(
      Object.entries(entries).filter(
        ([, session]) => session.createdAt <= now() && session.expires > now()
      )
    );
  }

  return {
    get(raw, user) {
      if (typeof raw !== 'string' || !tokenPattern.test(raw)) return null;
      const session = entries[digest(raw)];
      if (
        !session ||
        session.createdAt > now() ||
        session.expires <= now() ||
        !user ||
        session.userId !== user.id ||
        session.credential !== credential(user)
      )
        return null;
      return { ...session };
    },
    userId(raw) {
      if (typeof raw !== 'string' || !tokenPattern.test(raw)) return null;
      return entries[digest(raw)]?.userId || null;
    },
    create(user, scope = 'admin', storeId = user.storeId, previous = '') {
      if (!['admin', 'display'].includes(scope)) throw new Error('Escopo de sessão inválido.');
      const next = active();
      if (tokenPattern.test(previous)) delete next[digest(previous)];
      if (Object.keys(next).length >= 4096) throw new Error('Limite de sessões atingido.');
      const raw = randomBytes(24).toString('hex');
      const key = digest(raw);
      const createdAt = now();
      next[key] = {
        key,
        userId: user.id,
        storeId,
        scope,
        credential: credential(user),
        createdAt,
        expires: createdAt + SESSION_SECONDS * 1000,
      };
      persist(next);
      return raw;
    },
    remove(raw) {
      if (typeof raw !== 'string' || !tokenPattern.test(raw) || !entries[digest(raw)]) return;
      const next = active();
      delete next[digest(raw)];
      persist(next);
    },
    revokeUser(userId) {
      persist(
        Object.fromEntries(
          Object.entries(active()).filter(([, session]) => session.userId !== userId)
        )
      );
    },
    switchStore(raw, storeId) {
      const key = tokenPattern.test(raw || '') ? digest(raw) : '';
      const next = active();
      if (!next[key]) throw new Error('Sessão expirada.');
      next[key] = { ...next[key], storeId };
      persist(next);
    },
  };
}
