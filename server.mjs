import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, changesBetween, parsePriceFile } from './catalog.mjs';
import { createWeather } from './weather.mjs';
import { createAutoImporter, loadAutoImportConfig } from './auto-import.mjs';
import { lockDataDirectory } from './instance-lock.mjs';
import { openSessions, SESSION_SECONDS } from './sessions.mjs';
import { createLoginClientAddress } from './login-client.mjs';
import { closeServer } from './shutdown.mjs';
import {
  addStore,
  addUser,
  applyAction,
  assignImage,
  assignProductImage,
  clean,
  emailOf,
  getScreen,
  getState,
  id,
  matchesPassword,
  openState,
  publish,
  required,
  screenShowsImage,
  sha256,
  token,
  touch,
  tvState,
  userView,
} from './state.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const TXT_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 8 * 1024 * 1024;
const mime = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ttf: 'font/ttf',
};
const webAssets = new Set([
  'admin.js',
  'admin-ui.js',
  'admin-format.js',
  'admin-client.js',
  'admin-appearance.js',
  'admin.css',
  'tv.js',
  'tv.css',
  'tv-entry.css',
  'tv-entry.js',
  'tv-type.ttf',
  'acougue-photo.jpg',
  'acougue.svg',
  'arapongas-logo.png',
]);
const ownerActions = new Set(['add-store', 'switch-store', 'add-user']);

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

const htmlText = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );

function tvEntry(res, ctx, demo, error = '') {
  // Native form POSTs need a same-origin referrer policy so their Origin
  // is preserved for the server's cross-site request validation.
  res.setHeader('referrer-policy', 'same-origin');
  const title = ctx ? 'Escolha uma tela' : 'Entrar na TV';
  let content;
  if (ctx) {
    const links = ctx.store.screens
      .map(
        (screen) =>
          '<li><a class="screen-link" href="/tv/' +
          screen.token +
          '">' +
          htmlText(screen.name) +
          '<span aria-hidden="true">Abrir tela →</span></a></li>'
      )
      .join('');
    content =
      '<p class="entry-description">' +
      htmlText(ctx.store.name) +
      '</p>' +
      (links
        ? '<ul class="remote-screens">' + links + '</ul>'
        : '<p>Nenhuma tela cadastrada para esta loja.</p>') +
      '<form method="post" action="/tv/sair"><button type="submit" class="button secondary">Sair</button></form>';
  } else {
    content =
      '<p class="entry-description">Entre com a conta da loja para exibir seus preços.</p>' +
      (error ? '<p class="entry-error" role="alert">' + htmlText(error) + '</p>' : '') +
      '<form method="post" action="/tv"><p><label for="email">E-mail</label><br>' +
      '<input id="email" name="email" type="email" maxlength="254" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></p>' +
      '<p><label for="password">Senha</label><br><input id="password" name="password" type="password" ' +
      'maxlength="128" autocomplete="current-password" required></p><button type="submit" class="button primary">Entrar</button></form>' +
      '<p class="session-note">A sessão permanece ativa por 14 dias.</p>';
  }
  res.writeHead(error ? 401 : 200, { 'content-type': mime.html });
  res.end(
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" ' +
      'content="width=device-width, initial-scale=1"><title>' +
      title +
      ' · Tabela Digital</title>' +
      '<link rel="stylesheet" href="/tv-entry.css"><script src="/tv-entry.js" defer></script></head><body>' +
      '<main class="entry"><div class="entry-brand"><svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="125 780 845 340" role="img" aria-label="Arapongas Supermercados">' +
      '<image href="/arapongas-logo.png" xlink:href="/arapongas-logo.png" width="1080" height="1920"/></svg></div>' +
      '<section class="entry-content" aria-labelledby="entry-title"><h1 id="entry-title">' +
      title +
      '</h1>' +
      content +
      '</section></main></body></html>'
  );
}

function serveFile(req, res, path, type, cache = 'no-store') {
  if (!existsSync(path)) throw new AppError(404, 'Arquivo indisponível.');
  const size = statSync(path).size;
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'cache-control': cache });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(path);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

async function bytes(req, limit) {
  if (Number(req.headers['content-length']) > limit)
    throw new AppError(413, 'Arquivo acima do tamanho permitido.');
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new AppError(413, 'Arquivo acima do tamanho permitido.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new AppError(415, 'Use o formulário do painel.');
  }
  const body = await bytes(req, 512 * 1024);
  try {
    const data = JSON.parse(body.toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new AppError(400, 'Dados do formulário inválidos.');
  }
}

async function readFileForm(req, limit) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data;'))
    throw new AppError(415, 'Selecione um arquivo no formulário.');
  const body = await bytes(req, limit + 32 * 1024);
  let form;
  try {
    form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new AppError(400, 'O envio do arquivo está incompleto.');
  }
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new AppError(400, 'Selecione um arquivo.');
  if (file.size > limit) throw new AppError(413, 'Arquivo acima do tamanho permitido.');
  return {
    form,
    name: clean(file.name.split(/[\\/]/).pop(), 120),
    content: Buffer.from(await file.arrayBuffer()),
  };
}

function imageType(buffer) {
  if (buffer.length < 24) throw new AppError(422, 'A imagem está incompleta.');
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  throw new AppError(422, 'Use uma imagem PNG, JPEG ou WebP.');
}

function loopback(req) {
  return (
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '') &&
    !Object.keys(req.headers).some(
      (name) =>
        name === 'forwarded' ||
        name === 'via' ||
        name === 'x-real-ip' ||
        name.startsWith('x-forwarded-')
    )
  );
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { location });
  res.end();
}

function firstRunCode(file) {
  try {
    writeFileSync(file, token() + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const code = readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{48}$/.test(code))
    throw new Error('Código de instalação inválido. Confira o arquivo setup-code.txt.');
  return code;
}

export function createApp({
  dataDir = join(ROOT, 'data'),
  demo = false,
  origin = '',
  weatherKey = '',
  autoImport = null,
  now = Date.now,
  trustedProxies = [],
} = {}) {
  const loginClientAddress = createLoginClientAddress(trustedProxies);
  const state = openState(dataDir, demo);
  const importer = autoImport && !demo ? createAutoImporter(state, autoImport) : null;
  const mediaDir = join(dataDir, 'images');
  const sessions = openSessions(dataDir, now);
  const attempts = new Map();
  const setupFile = join(dataDir, 'setup-code.txt');
  let setupCode = !demo && !state.read().users.length ? firstRunCode(setupFile) : null;
  const dummyHash = randomBytes(16).toString('hex') + ':' + randomBytes(64).toString('hex');
  const previewSecret = token();
  const temperature = createWeather(demo ? '' : weatherKey);
  const isSecure = origin.startsWith('https://');
  mkdirSync(mediaDir, { recursive: true });

  function sessionId(req) {
    return (req.headers.cookie || '').match(/(?:^|;\s*)td_session=([a-f0-9]{48})(?:;|$)/)?.[1];
  }
  function setSession(req, res, user, scope = 'admin', storeId = user?.storeId) {
    const key = user ? sessions.create(user, scope, storeId, sessionId(req)) : '';
    if (!user) sessions.remove(sessionId(req));
    res.setHeader(
      'Set-Cookie',
      'td_session=' +
        key +
        '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
        (user ? SESSION_SECONDS : 0) +
        (isSecure ? '; Secure' : '')
    );
  }
  function context(req, needed = true, allowDisplay = false) {
    const db = state.read();
    const user = db.users.find((account) => account.id === sessions.userId(sessionId(req)));
    const session = sessions.get(sessionId(req), user);
    if (session) {
      const store =
        user &&
        db.stores.find(
          (store) => store.id === (user.role === 'owner' ? session.storeId : user.storeId)
        );
      if (store && (session.scope === 'admin' || allowDisplay)) return { db, session, user, store };
      if (store && needed)
        throw new AppError(403, 'Esta sessão permite apenas a exibição das telas.');
    }
    if (needed) throw new AppError(401, 'Entre para acessar o painel.');
    return null;
  }
  function sessionView(req) {
    const ctx = context(req, false);
    return {
      user: ctx ? userView(ctx.user, ctx.store) : null,
      setup: Boolean(setupCode) && !state.read().users.length && loopback(req),
      demo,
    };
  }
  function display(req, screenToken) {
    const { store } = context(req, true, true);
    const screen = store.screens.find((item) => item.token === screenToken);
    if (!screen) throw new AppError(404, 'O endereço desta tela está indisponível.');
    return { store, screen };
  }
  function stateView(req, res) {
    const { db, user, store } = context(req);
    return json(res, {
      ...getState(db, user, store),
      priceSource: importer?.status(store) || {
        state: 'unconfigured',
        checkedAt: null,
        lastSuccess: null,
      },
    });
  }
  function checkOrigin(req) {
    const requestOrigin = req.headers.origin;
    const expected = origin || 'http://' + req.headers.host;
    if (
      (requestOrigin && requestOrigin !== expected) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      throw new AppError(403, 'Origem do formulário não permitida.');
    }
  }
  function checkLogin(req) {
    const now = Date.now();
    for (const [key, attempt] of attempts) if (attempt.until < now) attempts.delete(key);
    const key = loginClientAddress(req);
    const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (attempt.count >= 12)
      throw new AppError(429, 'Muitas tentativas. Aguarde antes de tentar novamente.');
    attempt.count++;
    attempts.set(key, attempt);
    return key;
  }
  function authenticate(req, res, input, key, scope = 'admin') {
    const db = state.read();
    const user = db.users.find((account) => account.email === emailOf(input.email));
    const validPassword = matchesPassword(input.password, user?.hash || dummyHash);
    if (!user || !validPassword) throw new AppError(401, 'E-mail ou senha inválidos.');
    attempts.delete(key);
    setSession(req, res, user, scope);
    return userView(
      user,
      db.stores.find((store) => store.id === user.storeId)
    );
  }
  function previewTicket(req, store, upload) {
    return createHmac('sha256', previewSecret)
      .update(
        JSON.stringify([
          sessionId(req),
          store.id,
          store.version,
          upload.name,
          sha256(upload.content),
        ])
      )
      .digest('hex');
  }
  function validateTicket(received, expected) {
    if (
      typeof received !== 'string' ||
      !/^[a-f0-9]{64}$/.test(received) ||
      !timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))
    ) {
      throw new AppError(
        409,
        'A prévia expirou ou o arquivo mudou. Gere outra prévia antes de salvar.'
      );
    }
  }

  async function route(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname;
    const read = ['GET', 'HEAD'].includes(req.method);
    if (demo && !loopback(req))
      throw new AppError(403, 'Demonstração disponível somente na máquina local.');
    if (read) {
      if (path === '/healthz')
        return json(res, { ok: true, service: 'tabela-digital', version: VERSION });
      if (path === '/api/session') return json(res, sessionView(req));
      if (path === '/api/state') return stateView(req, res);
      if (path === '/tv' || path === '/tv/') return tvEntry(res, context(req, false, true), demo);
      const tv = path.match(/^\/api\/tv\/([a-f0-9]{48})$/);
      if (tv) {
        const before = display(req, tv[1]).store;
        const value = await temperature(before);
        const { store, screen } = display(req, tv[1]);
        const temperatureC =
          store.city === before.city && store.state === before.state ? value : null;
        return json(res, {
          ...tvState(store, screen),
          temperatureC,
          priceSource: importer?.status(store) || {
            state: 'unconfigured',
            checkedAt: null,
            lastSuccess: null,
          },
        });
      }
      const publicMedia = path.match(/^\/media\/([a-f0-9]{48})\/([a-f0-9]{24})$/);
      const privateMedia = path.match(/^\/api\/media\/([a-f0-9]{24})$/);
      if (publicMedia || privateMedia) {
        const access = publicMedia ? display(req, publicMedia[1]) : context(req);
        const key = publicMedia ? publicMedia[2] : privateMedia[1];
        const image = access.store.media.find((item) => item.id === key);
        if (!image || (publicMedia && !screenShowsImage(access.store, access.screen, key))) {
          throw new AppError(404, 'Imagem indisponível.');
        }
        return serveFile(req, res, join(mediaDir, key), image.mime);
      }
      const asset = path.slice(1);
      if (path === '/favicon.ico')
        return serveFile(req, res, join(ROOT, 'public', 'acougue.svg'), mime.svg);
      if (webAssets.has(asset))
        return serveFile(req, res, join(ROOT, 'public', asset), mime[asset.split('.').pop()]);
      const screenPage = path.match(/^\/(?:tv|telas)\/([a-f0-9]{48})$/);
      if (screenPage) {
        if (!context(req, false, true)) return redirect(res, '/tv');
        display(req, screenPage[1]);
        return serveFile(req, res, join(ROOT, 'public', 'tv.html'), mime.html);
      }
      if (path === '/login') {
        if (context(req, false)) return redirect(res, '/');
        return serveFile(req, res, join(ROOT, 'public', 'admin.html'), mime.html);
      }
      if (
        path === '/' ||
        path === '/telas' ||
        path === '/telas/' ||
        /^\/cliente(?:\/.*)?$/.test(path)
      ) {
        if (!context(req, false)) return redirect(res, '/login');
        return serveFile(req, res, join(ROOT, 'public', 'admin.html'), mime.html);
      }
      throw new AppError(404, 'Página não encontrada.');
    }
    if (req.method !== 'POST') throw new AppError(405, 'Método não suportado.');
    checkOrigin(req);
    if (path === '/api/setup') {
      if (!setupCode || !loopback(req) || state.read().users.length)
        throw new AppError(403, 'A instalação inicial está indisponível.');
      const input = await readJson(req);
      if (
        typeof input.setupCode !== 'string' ||
        !/^[a-f0-9]{48}$/.test(input.setupCode) ||
        !setupCode ||
        !timingSafeEqual(Buffer.from(input.setupCode), Buffer.from(setupCode))
      ) {
        throw new AppError(403, 'Código de instalação inválido.');
      }
      const user = state.write((db) => {
        if (db.users.length) throw new AppError(409, 'O painel já foi configurado.');
        const store = addStore(db, input.storeName);
        return addUser(db, { ...input, storeId: store.id }, 'owner');
      });
      setupCode = null;
      try {
        unlinkSync(setupFile);
      } catch (error) {
        console.error('Falha ao retirar código de instalação usado:', error.code);
      }
      setSession(req, res, user);
      return json(res, { user: userView(user, state.read().stores[0]), setup: false, demo });
    }
    if (path === '/api/login') {
      const key = checkLogin(req);
      const input = await readJson(req);
      return json(res, { user: authenticate(req, res, input, key), setup: false, demo });
    }
    if (path === '/tv') {
      const key = checkLogin(req);
      if (!(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
        throw new AppError(415, 'Use o formulário de acesso da TV.');
      }
      const input = new URLSearchParams((await bytes(req, 4096)).toString('utf8'));
      try {
        authenticate(
          req,
          res,
          { email: input.get('email'), password: input.get('password') },
          key,
          'display'
        );
      } catch (error) {
        if (error.status === 401) return tvEntry(res, null, demo, error.message);
        throw error;
      }
      res.writeHead(303, { location: '/tv' });
      return res.end();
    }
    if (path === '/tv/sair') {
      setSession(req, res, null);
      res.writeHead(303, { location: '/tv' });
      return res.end();
    }
    if (path === '/api/logout') {
      setSession(req, res, null);
      return json(res, { user: null, setup: false, demo });
    }
    const initial = context(req);
    if (req.headers['x-store-id'] && req.headers['x-store-id'] !== initial.store.id) {
      throw new AppError(409, 'A loja ativa mudou. Reabra este formulário na loja correta.');
    }
    if (path === '/api/action') {
      const input = await readJson(req);
      const { user, store, session, db } = context(req);
      if (store.id !== initial.store.id)
        throw new AppError(409, 'A loja ativa mudou. Atualize a página.');
      if (ownerActions.has(input.action) && user.role !== 'owner')
        throw new AppError(403, 'Apenas a administração pode fazer isso.');
      if (input.action === 'switch-store') {
        if (!db.stores.some((store) => store.id === input.id))
          throw new AppError(404, 'Loja não encontrada.');
        sessions.switchStore(sessionId(req), input.id);
      } else {
        const removed =
          input.action === 'delete-media' && store.media.find((media) => media.id === input.id);
        state.write((next) =>
          applyAction(
            next,
            next.users.find((account) => account.id === user.id),
            next.stores.find((item) => item.id === store.id),
            input
          )
        );
        if (removed) {
          try {
            unlinkSync(join(mediaDir, removed.id));
          } catch (error) {
            if (error.code !== 'ENOENT') console.error(error.code);
          }
        }
        if (input.action === 'change-password') {
          const activeStore = session.storeId;
          const fresh = state.read();
          sessions.revokeUser(user.id);
          setSession(
            req,
            res,
            fresh.users.find((item) => item.id === user.id),
            'admin',
            activeStore
          );
          return json(res, {
            ...getState(
              fresh,
              fresh.users.find((item) => item.id === user.id),
              fresh.stores.find((item) => item.id === activeStore)
            ),
            priceSource: importer?.status(store) || {
              state: 'unconfigured',
              checkedAt: null,
              lastSuccess: null,
            },
          });
        }
      }
      return stateView(req, res);
    }
    if (path === '/api/import/preview' || path === '/api/import') {
      const upload = await readFileForm(req, TXT_LIMIT);
      const { store } = context(req);
      if (store.id !== initial.store.id)
        throw new AppError(409, 'A loja ativa mudou. Atualize a página.');
      if (!store.manualImport) throw new AppError(403, 'Ative o envio manual nas configurações.');
      if (!/\.txt$/i.test(upload.name)) throw new AppError(422, 'Selecione um arquivo .txt.');
      const ticket = previewTicket(req, store, upload);
      if (path === '/api/import') validateTicket(upload.form.get('ticket'), ticket);
      const items = parsePriceFile(upload.content, store.parameters);
      if (path === '/api/import/preview') {
        const oldCodes = new Set(store.catalog.map((product) => product.code));
        const active = new Set([...items, ...store.manual].map((product) => product.code));
        const missingFromLists = new Set(
          store.lists
            .flatMap((list) => list.codes)
            .filter((code) => oldCodes.has(code) && !active.has(code))
        ).size;
        return json(res, {
          name: upload.name,
          count: items.length,
          ...changesBetween(store.catalog, items),
          missingFromLists,
          sample: items.slice(0, 12),
          ticket,
        });
      }
      state.write((next) =>
        publish(
          next.stores.find((item) => item.id === store.id),
          items,
          upload.name
        )
      );
      return stateView(req, res);
    }
    if (path === '/api/media') {
      const upload = await readFileForm(req, IMAGE_LIMIT);
      const { store } = context(req);
      if (store.id !== initial.store.id)
        throw new AppError(409, 'A loja ativa mudou. Atualize a página.');
      if (store.media.length >= 100) throw new AppError(422, 'Limite de 100 imagens por loja.');
      const item = {
        id: id(),
        name: required(upload.form.get('name') || upload.name, 100, 'o nome da imagem'),
        mime: imageType(upload.content),
        active: true,
      };
      const dest = join(mediaDir, item.id);
      writeFileSync(dest, upload.content, { flag: 'wx', mode: 0o600 });
      try {
        state.write((next) => {
          const current = next.stores.find((s) => s.id === store.id);
          current.media.push(item);
          assignImage(current, item.id, upload.form.getAll('screenIds'));
          if (upload.form.get('code'))
            assignProductImage(current, upload.form.get('code'), item.id);
          touch(current);
        });
      } catch (error) {
        try {
          unlinkSync(dest);
        } catch {}
        throw error;
      }
      return stateView(req, res);
    }
    throw new AppError(404, 'Ação indisponível.');
  }

  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    if (isSecure) res.setHeader('strict-transport-security', 'max-age=31536000');
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
    );
    try {
      await route(req, res);
    } catch (error) {
      if (res.headersSent || res.destroyed) return res.end();
      const known = error instanceof AppError;
      if (!known) console.error(error);
      json(
        res,
        { error: known ? error.message : 'Erro inesperado no servidor.', issues: error.issues },
        known ? error.status : 500
      );
    }
  });
  if (importer) {
    let stop;
    server.on('listening', () => {
      stop = importer.start();
    });
    server.on('close', () => stop?.());
  }
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = process.argv.includes('--demo');
  const host = process.env.TABELA_HOST || '127.0.0.1';
  const port = Number(process.env.TABELA_PORT || 8088);
  if (demo && !['127.0.0.1', '::1', 'localhost'].includes(host))
    throw new Error('A demonstração só roda localmente.');
  const dataDir = resolve(
    (demo ? process.env.TABELA_DEMO_DATA : process.env.TABELA_DATA) ||
      join(ROOT, demo ? 'data-demo' : 'data')
  );
  const releaseLock = await lockDataDirectory(dataDir);
  try {
    const configPath = process.env.TABELA_AUTO_IMPORT_CONFIG;
    const autoImport = !demo
      ? loadAutoImportConfig(dataDir, configPath, openState(dataDir, false).read().stores)
      : null;
    const server = createApp({
      dataDir,
      demo,
      origin: process.env.TABELA_ORIGIN || '',
      weatherKey: process.env.TABELA_OPENWEATHER_KEY || '',
      autoImport,
      trustedProxies: process.env.TABELA_TRUSTED_PROXIES || '',
    });
    server.on('close', releaseLock);
    server.on('error', (error) => {
      releaseLock();
      throw error;
    });
    let stopping = false;
    async function shutdown(signal) {
      if (stopping) return;
      stopping = true;
      console.log(JSON.stringify({ event: 'shutdown_started', signal, version: VERSION }));
      try {
        const { forced } = await closeServer(server);
        releaseLock();
        console.log(JSON.stringify({ event: 'shutdown_complete', forced }));
        process.exit(forced ? 1 : 0);
      } catch (error) {
        releaseLock();
        console.error(
          JSON.stringify({ event: 'shutdown_failed', code: error.code || 'unexpected' })
        );
        process.exit(1);
      }
    }
    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });
    server.listen(port, host, () =>
      console.log('Tabela Digital Arapongas · http://' + host + ':' + port)
    );
  } catch (error) {
    releaseLock();
    throw error;
  }
}
