import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { addStore, addUser, openState } from './state.mjs';

export const STORES = Object.freeze([
  {
    name: 'Margarida',
    email: 'arapongas@gmail.com',
    path: String.raw`\\172.16.104.2\rpdv\Toledo\001\txitens.txt`,
  },
  {
    name: 'Santa Fé',
    email: 'ara2@gmail.com',
    path: String.raw`\\172.16.104.2\rpdv\Toledo\002\txitens.txt`,
  },
]);

// Only a genuinely new installation can be initialized by this helper.
export function bootstrapStores({ dataDir, configPath, passwords }) {
  dataDir = resolve(dataDir);
  configPath = resolve(configPath);
  if (
    !Array.isArray(passwords) ||
    passwords.length !== STORES.length ||
    passwords.some((p) => typeof p !== 'string' || !p || p.length > 128)
  ) {
    throw new Error('Informe uma senha válida para cada loja.');
  }
  if (existsSync(join(dataDir, 'state.json')) || existsSync(configPath)) {
    throw new Error('A instalação ou configuração já existe; nenhum dado foi alterado.');
  }
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(dirname(configPath), { recursive: true });
  const state = openState(dataDir, false);
  const config = {
    intervalSeconds: 30,
    sources: STORES.map(({ name, path }) => ({ store: name, path })),
  };
  let createdConfig = false;
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    createdConfig = true;
    return state.write((db) => {
      if (db.stores.length || db.users.length || existsSync(join(dataDir, 'state.json')))
        throw new Error('A instalação já contém dados.');
      STORES.forEach(({ name, email }, i) => {
        const store = addStore(db, name);
        addUser(db, { name, email, password: passwords[i], storeId: store.id }, 'operator');
      });
      return { stores: STORES.map((s) => s.name), configPath };
    });
  } catch (error) {
    if (createdConfig) unlinkSync(configPath);
    throw error;
  }
}

async function main() {
  if (!process.stdin.isTTY)
    throw new Error('Execute em um terminal interativo para digitar as senhas sem exibição.');
  const dataDir = resolve(process.env.TABELA_DATA || 'data');
  const configPath = resolve(
    process.env.TABELA_AUTO_IMPORT_CONFIG || join(dataDir, 'auto-import.json')
  );
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  const passwords = [];
  try {
    for (const { name } of STORES) {
      process.stderr.write(`Senha da conta ${name} (não será exibida): `);
      passwords.push(await rl.question(''));
      process.stderr.write('\n');
    }
  } finally {
    rl.close();
  }
  const result = bootstrapStores({ dataDir, configPath, passwords });
  console.log('Lojas criadas: ' + result.stores.join(', '));
  console.log('Configuração automática: ' + result.configPath);
  console.log(
    'O servidor usa o arquivo da pasta de dados por padrão. Para outro caminho, defina TABELA_AUTO_IMPORT_CONFIG.'
  );
  console.log('As listas, telas, imagens e preços ainda devem ser migrados e conferidos.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
