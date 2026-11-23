import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute, join as joinPath, win32 } from 'node:path';
import { parsePriceFile } from './catalog.mjs';
import { publish } from './state.mjs';

const LIMIT = 2 * 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Store names are exact, so one source cannot accidentally update another store.
export function validateAutoImportConfig(config) {
  if (!config || !Array.isArray(config.sources) || config.sources.length > 100)
    throw new Error('Configuração automática inválida.');
  const intervalSeconds = config.intervalSeconds ?? 30;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 86400)
    throw new Error('Intervalo automático inválido.');
  const names = new Set();
  const sources = config.sources.map((source) => {
    const key = source?.storeId || source?.store;
    if (
      !source ||
      typeof key !== 'string' ||
      !key.trim() ||
      names.has(key) ||
      typeof source.path !== 'string' ||
      !(isAbsolute(source.path) || win32.isAbsolute(source.path))
    ) {
      throw new Error('Informe uma loja única e um caminho absoluto para cada arquivo.');
    }
    names.add(key);
    return {
      ...(source.storeId ? { storeId: source.storeId } : { store: source.store }),
      path: source.path,
    };
  });
  return { intervalSeconds, sources };
}

// Resolve legacy name-based bindings once, and persist IDs atomically before
// the importer starts. An ambiguous or missing name is never guessed.
export function loadAutoImportConfig(dataDir, overridePath, stores) {
  const path = overridePath || joinPath(dataDir, 'auto-import.json');
  if (!existsSync(path)) {
    if (overridePath) throw new Error('Arquivo de configuração automática não encontrado.');
    return null;
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const validated = validateAutoImportConfig(raw);
  let changed = false;
  const sources = validated.sources.map((source) => {
    const matches = stores.filter((store) =>
      source.storeId ? store.id === source.storeId : store.name === source.store
    );
    if (matches.length !== 1)
      throw new Error('Loja da configuração automática ausente ou ambígua.');
    if (!source.storeId) changed = true;
    return { storeId: matches[0].id, path: source.path };
  });
  if (new Set(sources.map((s) => s.storeId)).size !== sources.length)
    throw new Error('Loja duplicada na configuração automática.');
  if (changed) {
    const migrated = {
      ...raw,
      sources: raw.sources.map((source, i) => {
        const { store, ...rest } = source;
        return { ...rest, storeId: sources[i].storeId };
      }),
    };
    const pending = path + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(pending, JSON.stringify(migrated, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(pending, path);
    } finally {
      if (existsSync(pending)) unlinkSync(pending);
    }
  }
  return { intervalSeconds: validated.intervalSeconds, sources };
}

// A file must be identical in two successive polls and must not shrink by more
// than half. Errors leave the last published catalog untouched.
export function createAutoImporter(
  state,
  config,
  { onError = console.error, fileStat = stat, fileRead = readFile, now = Date.now } = {}
) {
  const settings = validateAutoImportConfig(config);
  const seen = new Map();
  const statuses = new Map();
  const running = new Map();
  const pendingBySource = new Map();
  let pendingTotal = 0;
  let pollOffset = 0;
  const staleMs = settings.intervalSeconds * 3000;
  const timestamp = () => new Date(now()).toISOString();
  async function poll() {
    // Rotate admission order so sources beyond the global limit also get a turn.
    const sources = settings.sources
      .slice(pollOffset)
      .concat(settings.sources.slice(0, pollOffset));
    pollOffset = settings.sources.length ? (pollOffset + 1) % settings.sources.length : 0;
    await Promise.all(
      sources.map(async (source) => {
        const sourceKey = source.storeId || source.store;
        const oldRun = running.get(sourceKey);
        if (oldRun && now() - oldRun.started <= staleMs) return;
        const pending = pendingBySource.get(sourceKey) || 0;
        const atLimit = pending >= 2 || pendingTotal >= 3;
        if (oldRun || atLimit) {
          seen.delete(sourceKey);
          statuses.set(sourceKey, {
            state: 'error',
            checkedAt: timestamp(),
            lastSuccess: statuses.get(sourceKey)?.lastSuccess || null,
          });
        }
        // A deadline cannot cancel a filesystem operation stuck in the kernel.
        // Count it until it really settles; leave a default libuv worker available.
        if (atLimit) return;
        const started = now();
        const run = { started };
        pendingBySource.set(sourceKey, pending + 1);
        pendingTotal++;
        running.set(sourceKey, run);
        try {
          const candidates = state
            .read()
            .stores.filter((store) =>
              source.storeId ? store.id === source.storeId : store.name === source.store
            );
          if (candidates.length !== 1)
            throw new Error('Loja não encontrada ou nome duplicado: ' + sourceKey);
          const before = await fileStat(source.path);
          if (running.get(sourceKey) !== run) return;
          if (!before.isFile() || before.size === 0 || before.size > LIMIT)
            throw new Error('Arquivo vazio ou acima do limite.');
          const bytes = await fileRead(source.path);
          if (running.get(sourceKey) !== run) return;
          const after = await fileStat(source.path);
          if (running.get(sourceKey) !== run) return;
          if (now() - started > staleMs)
            throw new Error('Leitura demorou demais; aguardando nova verificação.');
          if (
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            bytes.length !== after.size
          ) {
            seen.delete(sourceKey);
            throw new Error('Arquivo em atualização; aguardando próxima verificação.');
          }
          if (bytes.at(-1) !== 10 && bytes.at(-1) !== 13) {
            seen.delete(sourceKey);
            throw new Error('Arquivo sem quebra de linha final; aguardando conclusão.');
          }
          // A parameter change changes the interpretation even when the file
          // bytes are identical. Require stability of both before publishing.
          const parameters = JSON.stringify(candidates[0].parameters);
          const hash = digest(bytes) + ':' + parameters;
          const previous = seen.get(sourceKey);
          seen.set(sourceKey, {
            hash,
            applied: previous?.hash === hash && previous.applied,
            catalogHash: previous?.hash === hash ? previous.catalogHash : null,
          });
          if (!previous || previous.hash !== hash) {
            statuses.set(sourceKey, {
              state: 'waiting',
              checkedAt: timestamp(),
              lastSuccess: statuses.get(sourceKey)?.lastSuccess || null,
            });
            return;
          }
          if (previous.applied) {
            const current = state
              .read()
              .stores.find((store) =>
                source.storeId ? store.id === source.storeId : store.name === source.store
              );
            if (!current) throw new Error('Loja não encontrada.');
            const currentHash = digest(Buffer.from(JSON.stringify(current.catalog)));
            const differs = previous.catalogHash !== currentHash;
            statuses.set(sourceKey, {
              state: differs ? 'override' : 'ok',
              checkedAt: timestamp(),
              lastSuccess: differs ? statuses.get(sourceKey)?.lastSuccess || null : timestamp(),
            });
            return;
          }
          let catalogHash;
          let overridden = false;
          state.write((db) => {
            const matches = db.stores.filter((store) =>
              source.storeId ? store.id === source.storeId : store.name === source.store
            );
            if (matches.length !== 1) throw new Error('Loja alterada durante importação.');
            const store = matches[0];
            if (JSON.stringify(store.parameters) !== parameters)
              throw new Error(
                'Parâmetros alterados durante importação; aguardando nova verificação.'
              );
            const items = parsePriceFile(bytes, store.parameters);
            if (store.catalog.length && items.length < store.catalog.length / 2)
              throw new Error(
                'Arquivo contém menos da metade dos produtos atuais; importação suspensa.'
              );
            catalogHash = digest(Buffer.from(JSON.stringify(items)));
            // Preserve a manual restoration when the source and parser settings
            // are unchanged, including after a process restart. A new source
            // fingerprint is applied normally on the next stable observation.
            overridden =
              store.autoImportMarker === hash &&
              digest(Buffer.from(JSON.stringify(store.catalog))) !== catalogHash;
            if (!overridden && JSON.stringify(store.catalog) !== JSON.stringify(items))
              publish(
                store,
                items,
                'Atualização automática · ' + (win32.basename(source.path) || basename(source.path))
              );
            store.autoImportMarker = hash;
          });
          seen.set(sourceKey, { hash, applied: true, catalogHash });
          statuses.set(sourceKey, {
            state: overridden ? 'override' : 'ok',
            checkedAt: timestamp(),
            lastSuccess: overridden ? statuses.get(sourceKey)?.lastSuccess || null : timestamp(),
          });
        } catch (error) {
          if (running.get(sourceKey) !== run) return;
          // A missing or unreadable file breaks the sequence of successful
          // observations; wait for two fresh reads after connectivity returns.
          seen.delete(sourceKey);
          statuses.set(sourceKey, {
            state: 'error',
            checkedAt: timestamp(),
            lastSuccess: statuses.get(sourceKey)?.lastSuccess || null,
          });
          onError('Atualização automática (' + sourceKey + '): ' + error.message);
        } finally {
          const remaining = pendingBySource.get(sourceKey) - 1;
          if (remaining) pendingBySource.set(sourceKey, remaining);
          else pendingBySource.delete(sourceKey);
          pendingTotal--;
          if (running.get(sourceKey) === run) running.delete(sourceKey);
        }
      })
    );
  }
  function start() {
    void poll();
    const timer = setInterval(() => void poll(), settings.intervalSeconds * 1000);
    timer.unref();
    return () => clearInterval(timer);
  }
  function status(store) {
    const source = settings.sources.find((item) =>
      item.storeId ? item.storeId === store.id : item.store === store.name
    );
    if (!source) return { state: 'unconfigured', checkedAt: null, lastSuccess: null };
    const key = source.storeId || source.store;
    const result = statuses.get(key) || { state: 'waiting', checkedAt: null, lastSuccess: null };
    const started = running.get(key);
    if (
      (started != null && now() - started.started > staleMs) ||
      (result.checkedAt && now() - Date.parse(result.checkedAt) > staleMs)
    ) {
      return { ...result, state: 'error' };
    }
    return result;
  }
  return { poll, start, status };
}
