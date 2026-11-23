import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { productCode, validateParameters } from './catalog.mjs';
import { addStore, addUser, applyAction, id, openState, publish } from './state.mjs';

export function copyReference({ dataDir, assetsDir, snapshots, credentials }) {
  if (!snapshots.length || snapshots.length !== credentials.length) {
    throw new Error('Cada conta precisa de uma configuração e de uma credencial.');
  }
  const state = openState(dataDir, false);
  const imageDir = join(dataDir, 'images');
  const written = [];
  try {
    return state.write((db) => {
      if (db.stores.length || db.users.length) {
        throw new Error('Esta instalação já contém contas ou lojas. Use uma pasta de dados vazia.');
      }
      mkdirSync(imageDir, { recursive: true });
      return snapshots.map((snapshot, index) => {
        const store = addStore(db, snapshot.name);
        const user = addUser(
          db,
          { ...credentials[index], name: snapshot.name, storeId: store.id },
          'operator',
          { imported: true }
        );
        applyAction(db, user, store, {
          ...snapshot,
          action: 'save-settings',
          refreshSeconds: 600,
          manualImport: snapshot.manualImport !== false,
        });
        if (snapshot.parameters) store.parameters = validateParameters(snapshot.parameters);
        if (snapshot.createdAt) store.createdAt = snapshot.createdAt;
        const products = snapshot.products.map((product) => ({
          code: productCode(product.code),
          name: product.name,
          price: product.price,
          promo: product.promo,
        }));
        if (products.length) {
          publish(store, products, 'Catálogo de origem · Tabela Digital');
          if (snapshot.originalImportAt) store.imports[0].date = snapshot.originalImportAt;
        }
        const lists = new Map();
        for (const item of snapshot.lists) {
          applyAction(db, user, store, { action: 'save-list', name: item.name, codes: item.codes });
          lists.set(item.key, store.lists.at(-1).id);
        }
        const images = new Map();
        for (const item of snapshot.media) {
          if (!/^[\w.-]+\.(?:jpe?g|png|webp)$/i.test(item.file))
            throw new Error('Nome de imagem inválido.');
          const buffer = readFileSync(join(assetsDir, item.file));
          const mime =
            buffer.subarray(0, 3).toString('hex') === 'ffd8ff'
              ? 'image/jpeg'
              : buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
                ? 'image/png'
                : buffer.toString('ascii', 0, 4) === 'RIFF' &&
                    buffer.toString('ascii', 8, 12) === 'WEBP'
                  ? 'image/webp'
                  : null;
          const extension = item.file.split('.').pop().toLowerCase();
          if (
            buffer.length < 24 ||
            buffer.length > 8 * 1024 * 1024 ||
            !mime ||
            !(
              { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[
                extension
              ] === mime
            )
          ) {
            throw new Error('Imagem inválida ou formato incompatível com o nome do arquivo.');
          }
          const key = id();
          const destination = join(imageDir, key);
          writeFileSync(destination, buffer, { flag: 'wx', mode: 0o600 });
          written.push(destination);
          store.media.push({ id: key, name: item.name, mime, active: item.active });
          images.set(item.key, key);
        }
        for (const screen of snapshot.screens) {
          const listIds = screen.listKeys.map((key) => lists.get(key));
          const mediaIds = snapshot.media
            .filter((image) => image.screenKeys.includes(screen.key))
            .map((image) => images.get(image.key));
          applyAction(db, user, store, {
            action: 'save-screen',
            name: screen.name,
            listIds,
            mediaIds,
            theme: 'red',
            rotationSeconds: null,
            rows: screen.rows || 8,
            appearance: screen.appearance,
          });
        }
        return {
          name: store.name,
          screens: store.screens.length,
          lists: store.lists.length,
          images: store.media.length,
          products: store.catalog.length,
        };
      });
    });
  } catch (error) {
    for (const file of written) {
      try {
        unlinkSync(file);
      } catch {}
    }
    throw error;
  }
}
