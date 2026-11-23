import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  DEFAULT_PARAMETERS,
  changesBetween,
  productCode,
  validateParameters,
} from './catalog.mjs';

export const id = () => randomBytes(12).toString('hex');
export const token = () => randomBytes(24).toString('hex');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const clean = (value, length) =>
  typeof value === 'string' ? value.trim().slice(0, length) : '';
export function required(value, length, field) {
  const result = clean(value, length);
  if (!result) throw new AppError(400, 'Preencha ' + field + '.');
  return result;
}

function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError(400, label + ' deve estar entre ' + min + ' e ' + max + '.');
  }
  return value;
}

export const emailOf = (value) => clean(value, 254).toLowerCase();
function passwordHash(password, { imported = false } = {}) {
  if (
    typeof password !== 'string' ||
    password.length < (imported ? 1 : 10) ||
    password.length > 128
  ) {
    throw new AppError(400, 'A senha deve ter entre 10 e 128 caracteres.');
  }
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function matchesPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 128) return false;
  if (typeof hash !== 'string' || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)) return false;
  const [salt, expected] = hash.split(':');
  return timingSafeEqual(Buffer.from(expected, 'hex'), scryptSync(password, salt, 64));
}

export function addUser(db, input, role, options) {
  const email = emailOf(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AppError(400, 'Informe um e-mail válido.');
  if (db.users.some((user) => user.email === email))
    throw new AppError(409, 'Este e-mail já tem uma conta.');
  find(db.stores, input.storeId, 'Loja');
  const user = {
    id: id(),
    name: required(input.name, 100, 'o nome'),
    email,
    storeId: input.storeId,
    role,
    hash: passwordHash(input.password, options),
  };
  db.users.push(user);
  return user;
}

export function addStore(db, name) {
  name = required(name, 100, 'o nome da loja');
  if (db.stores.some((store) => store.name.toLowerCase() === name.toLowerCase())) {
    throw new AppError(409, 'Já existe uma loja com esse nome.');
  }
  const store = {
    id: id(),
    name,
    displayName: '',
    city: '',
    state: '',
    website: '',
    text: '',
    message: 'SEJA BEM-VINDO(A) AO ARAPONGAS SUPERMERCADOS',
    rotationSeconds: 12,
    refreshSeconds: 600,
    manualImport: true,
    parameters: structuredClone(DEFAULT_PARAMETERS),
    catalog: [],
    manual: [],
    lists: [],
    screens: [],
    media: [],
    imports: [],
    createdAt: new Date().toISOString(),
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  db.stores.push(store);
  return store;
}

function seedDemo(db) {
  const demo = [
    ['Margarida · demonstração', 'Açougue TV 1', 'Carnes de primeira'],
    ['Santa Fé · demonstração', 'TV-1', 'Angus'],
  ];
  for (const [index, [name, screenName, listName]] of demo.entries()) {
    const store = addStore(db, name);
    store.city = 'Campo Grande';
    store.refreshSeconds = 10;
    store.rotationSeconds = 6;
    store.catalog = [
      ['4260', 'ANGUS ENTRECOT', 6990],
      ['4261', 'ANGUS ANCHO', 7990],
      ['4262', 'ANGUS T-BONE', 6990],
      ['4263', 'ANGUS CHORIZO', 6990],
      ['4267', 'ANGUS PICANHA', 14990],
      ['4268', 'ANGUS FILÉ MIGNON', 14990],
      ['4269', 'ANGUS ALCATRA', 7490],
      ['4270', 'ANGUS COXÃO DURO', 5490],
      ['4271', 'ANGUS COXÃO MOLE', 5990],
      ['4272', 'ANGUS PATINHO', 5990],
      ['4273', 'ANGUS PONTA DE COSTELA', 7490],
      ['4280', 'ANGUS PRIME RIB', 6490],
    ].map(([code, name, price]) => ({ code, name: name + ' kg', price, promo: null }));
    store.lists.push({ id: id(), name: listName, codes: store.catalog.map((p) => p.code) });
    store.screens.push({
      id: id(),
      name: screenName,
      token: token(),
      listIds: [store.lists[0].id],
      mediaIds: [],
      theme: 'red',
      rotationSeconds: null,
      rows: 8,
    });
    addUser(
      db,
      {
        name: index === 0 ? 'Equipe Arapongas' : 'Operador Santa Fé',
        email: index === 0 ? 'demo@arapongas.local' : 'santafe@arapongas.local',
        password: 'demo-arapongas-2026',
        storeId: store.id,
      },
      index === 0 ? 'owner' : 'operator'
    );
  }
}

export function openState(dataDir, demo) {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, 'state.json');
  let db = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { schema: 1, users: [], stores: [] };
  if (db.schema !== 1) throw new Error('Versão do banco não suportada.');
  function persist(next) {
    const pending = path + '.' + randomBytes(8).toString('hex') + '.tmp';
    let descriptor;
    try {
      descriptor = openSync(pending, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify(next));
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(pending, path);
      db = next;
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {}
      }
      try {
        unlinkSync(pending);
      } catch {}
      throw error;
    }
  }
  if (demo && !db.users.length) {
    seedDemo(db);
    persist(db);
  }
  return {
    read: () => db,
    write(fn) {
      const next = structuredClone(db);
      const result = fn(next);
      persist(next);
      return result;
    },
  };
}

function find(items, key, label, field = 'id') {
  const item = items.find((item) => item[field] === key);
  if (!item) throw new AppError(404, label + ' não encontrado(a).');
  return item;
}

function upsert(items, key, values, label) {
  if (key) {
    const item = find(items, key, label);
    Object.assign(item, values);
  } else {
    items.push({ id: id(), ...values });
  }
}

function deleteOne(items, key, label, field = 'id') {
  const item = find(items, key, label, field);
  items.splice(items.indexOf(item), 1);
}

function ids(value, allowed, label) {
  if (!Array.isArray(value) || value.length > 100) throw new AppError(400, 'Seleção inválida.');
  const selected = [...new Set(value)];
  for (const key of selected) find(allowed, key, label);
  return selected;
}

function appearanceFor(input, images) {
  const look = input && typeof input === 'object' ? input : {};
  const bounded = (key, min, max, fallback) =>
    look[key] == null || look[key] === '' ? fallback : integer(look[key], min, max, key);
  const color = (key) => {
    if (look[key] == null || look[key] === '') return null;
    if (!/^#[0-9a-f]{6}$/i.test(look[key])) throw new AppError(400, 'Cor inválida.');
    return look[key];
  };
  const slideBackgroundId = look.slideBackgroundId || null;
  if (slideBackgroundId) find(images, slideBackgroundId, 'Imagem de fundo');
  return {
    nameSize: bounded('nameSize', 12, 150, null),
    nameLimit: bounded('nameLimit', 12, 150, 50),
    nameColor: color('nameColor'),
    priceSize: bounded('priceSize', 12, 150, null),
    priceColor: color('priceColor'),
    hideOldPrice: look.hideOldPrice === true,
    promoSize: bounded('promoSize', 12, 150, null),
    promoColor: color('promoColor'),
    oddColor: color('oddColor'),
    evenColor: color('evenColor'),
    tickerBg: color('tickerBg'),
    tickerColor: color('tickerColor'),
    tickerSeconds: bounded('tickerSeconds', 1, 100, 30),
    showImages: look.showImages !== false,
    layout: look.layout === 'bottom' ? 'bottom' : 'side',
    topPercent: bounded('topPercent', 20, 100, 75),
    bottomPercent: bounded('bottomPercent', 20, 100, 25),
    showHeader: look.showHeader !== false,
    showTicker: look.showTicker !== false,
    slider: [1, 2, 4].includes(look.slider) ? look.slider : 0,
    slideBackgroundId,
    border: look.border === true,
    borderColor: color('borderColor'),
    photoWidth: bounded('photoWidth', 1, 100, 100),
    photoHeight: bounded('photoHeight', 1, 100, 100),
    photoX: ['left', 'right'].includes(look.photoX) ? look.photoX : 'center',
    photoY: ['top', 'bottom'].includes(look.photoY) ? look.photoY : 'center',
  };
}

export function assignImage(store, imageId, screenIds) {
  const selection = ids(screenIds, store.screens, 'Tela');
  for (const screen of store.screens) {
    if (selection.includes(screen.id)) {
      if (!screen.mediaIds.includes(imageId)) screen.mediaIds.push(imageId);
    } else {
      screen.mediaIds = screen.mediaIds.filter((key) => key !== imageId);
    }
  }
}

export function screenShowsImage(store, screen, key) {
  const listed =
    screen.mediaIds.includes(key) ||
    screen.appearance?.slideBackgroundId === key ||
    (store.productImages || []).some(
      (product) =>
        product.imageId === key &&
        store.lists.some(
          (list) => screen.listIds.includes(list.id) && list.codes.includes(product.code)
        )
    );
  return listed && store.media.some((image) => image.id === key && image.active !== false);
}

export function assignProductImage(store, code, imageId) {
  code = productCode(code);
  if (![...store.catalog, ...store.manual].some((product) => product.code === code)) {
    throw new AppError(404, 'Produto não encontrado.');
  }
  if (imageId) find(store.media, imageId, 'Imagem de produto');
  store.productImages = (store.productImages || []).filter((item) => item.code !== code);
  if (imageId) store.productImages.push({ code, imageId });
}

export function touch(store) {
  store.version++;
  store.updatedAt = new Date().toISOString();
}

export function catalogFor(store) {
  const byCode = new Map(
    store.catalog.map((product) => [product.code, { ...product, manual: false }])
  );
  for (const product of store.manual) byCode.set(product.code, { ...product, manual: true });
  for (const photo of store.productImages || []) {
    if (byCode.has(photo.code)) byCode.get(photo.code).imageId = photo.imageId;
  }
  return [...byCode.values()];
}

export function userView(user, store) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    storeId: store.id,
    storeName: store.name,
  };
}

export function getState(db, user, store) {
  return {
    user: userView(user, store),
    store: {
      id: store.id,
      name: store.name,
      displayName: store.displayName ?? '',
      city: store.city,
      state: store.state,
      website: store.website,
      createdAt: store.createdAt,
      text: store.text,
      message: store.message,
      rotationSeconds: store.rotationSeconds,
      refreshSeconds: store.refreshSeconds,
      manualImport: store.manualImport,
    },
    parameters: store.parameters,
    catalog: catalogFor(store),
    lists: store.lists,
    screens: store.screens,
    media: store.media.map(({ id, name, active }) => ({
      id,
      name,
      active,
      type: 'image',
      mode: 'upload',
      url: '/api/media/' + id,
    })),
    imports: store.imports.map(({ products, ...info }) => info),
    stores: user.role === 'owner' ? db.stores.map(({ id, name }) => ({ id, name })) : [],
    users: user.role === 'owner' ? db.users.map(({ hash, ...account }) => account) : [],
  };
}

export function getScreen(db, screenToken) {
  for (const store of db.stores) {
    const screen = store.screens.find((screen) => screen.token === screenToken);
    if (screen) return { store, screen };
  }
  throw new AppError(404, 'O endereço desta tela está indisponível.');
}

export function tvState(store, screen) {
  const imageUrl = (key) => '/media/' + screen.token + '/' + key;
  const lists = new Map(store.lists.map((list) => [list.id, list]));
  const images = new Map(
    store.media.filter((image) => image.active !== false).map((image) => [image.id, image])
  );
  const byCode = new Map(
    catalogFor(store).map(({ manual, imageId, ...product }) => [
      product.code,
      {
        ...product,
        ...(images.has(imageId) ? { imageUrl: imageUrl(imageId) } : {}),
      },
    ])
  );
  return {
    version: store.version,
    store: {
      name: store.displayName || store.name,
      city: store.city,
      text: store.text,
      message: store.message,
      rotationSeconds: store.rotationSeconds,
      refreshSeconds: store.refreshSeconds,
    },
    screen: {
      name: screen.name,
      theme: screen.theme,
      rotationSeconds: screen.rotationSeconds,
      rows: screen.rows,
      appearance: screen.appearance && {
        ...screen.appearance,
        slideBackgroundUrl: images.has(screen.appearance.slideBackgroundId)
          ? imageUrl(screen.appearance.slideBackgroundId)
          : null,
      },
    },
    groups: screen.listIds
      .map((key) => lists.get(key))
      .filter(Boolean)
      .map((list) => ({
        name: list.name,
        products: list.codes.map((code) => byCode.get(code)).filter(Boolean),
      })),
    media: screen.mediaIds
      .filter((key) => images.has(key))
      .map((key) => ({
        id: key,
        name: images.get(key).name,
        type: 'image',
        mode: 'upload',
        url: imageUrl(key),
      })),
    updatedAt: store.updatedAt,
  };
}

export function publish(store, products, name) {
  store.imports.unshift({
    id: id(),
    name,
    date: new Date().toISOString(),
    count: products.length,
    ...changesBetween(store.catalog, products),
    products,
  });
  store.imports.length = Math.min(store.imports.length, 12);
  store.catalog = products;
  touch(store);
}

export function applyAction(db, user, store, input) {
  switch (input.action) {
    case 'save-list': {
      if (!Array.isArray(input.codes) || input.codes.length > 10000)
        throw new AppError(400, 'Lista de códigos inválida.');
      upsert(
        store.lists,
        input.id,
        {
          name: required(input.name, 100, 'o nome da lista'),
          codes: [...new Set(input.codes.map(productCode))],
        },
        'Lista'
      );
      break;
    }
    case 'delete-list':
      deleteOne(store.lists, input.id, 'Lista');
      for (const screen of store.screens)
        screen.listIds = screen.listIds.filter((id) => id !== input.id);
      break;
    case 'save-screen': {
      const existing = input.id ? find(store.screens, input.id, 'Tela') : null;
      upsert(
        store.screens,
        input.id,
        {
          name: required(input.name, 100, 'o nome da tela'),
          token: existing?.token ?? token(),
          listIds: ids(input.listIds, store.lists, 'Lista'),
          mediaIds: ids(input.mediaIds, store.media, 'Imagem'),
          theme: input.theme === 'dark' ? 'dark' : 'red',
          rotationSeconds:
            input.rotationSeconds == null
              ? null
              : integer(input.rotationSeconds, 3, 120, 'Tempo de troca'),
          rows: integer(input.rows, 1, 12, 'Linhas por tela'),
          appearance: appearanceFor(input.appearance ?? existing?.appearance, store.media),
        },
        'Tela'
      );
      break;
    }
    case 'delete-screen':
      deleteOne(store.screens, input.id, 'Tela');
      break;
    case 'rotate-link':
      find(store.screens, input.id, 'Tela').token = token();
      break;
    case 'save-product': {
      const code = productCode(input.code);
      const price = integer(input.price, 0, 999999999, 'Preço em centavos');
      const promo = input.promo == null ? null : integer(input.promo, 0, price, 'Preço por');
      const index = store.manual.findIndex((p) => p.code === code);
      const product = { code, name: required(input.name, 160, 'o nome do produto'), price, promo };
      if (index < 0) store.manual.push(product);
      else store.manual[index] = product;
      break;
    }
    case 'delete-product':
      deleteOne(store.manual, productCode(input.code), 'Produto manual', 'code');
      break;
    case 'save-parameters':
      store.parameters = validateParameters(input.parameters);
      break;
    case 'save-settings':
      store.name = required(input.name, 100, 'o nome da loja');
      if ('displayName' in input) store.displayName = clean(input.displayName, 100);
      store.city = clean(input.city, 100);
      store.message = clean(input.message, 350);
      if ('state' in input) store.state = clean(input.state, 40);
      if ('website' in input) store.website = clean(input.website, 200);
      if ('text' in input) store.text = clean(input.text, 150);
      store.rotationSeconds = integer(input.rotationSeconds, 3, 120, 'Tempo de troca');
      store.refreshSeconds = integer(input.refreshSeconds, 5, 3600, 'Tempo de consulta');
      store.manualImport = input.manualImport === true;
      break;
    case 'restore-import': {
      const entry = find(store.imports, input.id, 'Importação');
      publish(store, entry.products, 'Restauração · ' + entry.name);
      return;
    }
    case 'set-media-active':
      find(store.media, input.id, 'Imagem').active = input.active === true;
      break;
    case 'set-media-screens':
      find(store.media, input.id, 'Imagem');
      assignImage(store, input.id, input.screenIds);
      break;
    case 'set-product-image':
      assignProductImage(store, input.code, input.imageId);
      break;
    case 'delete-media':
      deleteOne(store.media, input.id, 'Imagem');
      for (const screen of store.screens) {
        screen.mediaIds = screen.mediaIds.filter((id) => id !== input.id);
        if (screen.appearance?.slideBackgroundId === input.id)
          screen.appearance.slideBackgroundId = null;
      }
      store.productImages = (store.productImages || []).filter((item) => item.imageId !== input.id);
      break;
    case 'update-profile': {
      const email = emailOf(input.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new AppError(400, 'Informe um e-mail válido.');
      if (db.users.some((account) => account.id !== user.id && account.email === email)) {
        throw new AppError(409, 'Este e-mail já tem uma conta.');
      }
      user.name = required(input.name, 100, 'o nome');
      user.email = email;
      return;
    }
    case 'add-store':
      addStore(db, input.name);
      return;
    case 'add-user':
      addUser(db, input, 'operator');
      return;
    case 'change-password':
      if (!matchesPassword(input.currentPassword, user.hash))
        throw new AppError(400, 'A senha atual está incorreta.');
      user.hash = passwordHash(input.password);
      return;
    default:
      throw new AppError(400, 'Ação inválida.');
  }
  touch(store);
}
