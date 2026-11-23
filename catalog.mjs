export class AppError extends Error {
  constructor(status, message, issues) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

export const DEFAULT_PARAMETERS = {
  code: { start: 5, length: 6 },
  name: { start: 20, length: 50 },
  price: { start: 12, length: 5 },
  promo: null,
  encoding: 'auto',
};

export function validateParameters(parameters) {
  if (!parameters || !['auto', 'utf8', 'windows1252'].includes(parameters.encoding)) {
    throw new AppError(400, 'Selecione a codificação do arquivo.');
  }
  const field = (key, label, limit) => {
    const value = parameters[key];
    if (
      !value ||
      !Number.isInteger(value.start) ||
      value.start < 0 ||
      value.start > 512 ||
      !Number.isInteger(value.length) ||
      value.length < 1 ||
      value.length > limit
    ) {
      throw new AppError(400, 'Posição ou tamanho inválido para ' + label + '.');
    }
    return { start: value.start, length: value.length };
  };
  return {
    code: field('code', 'código', 24),
    name: field('name', 'nome', 160),
    price: field('price', 'preço de', 9),
    promo: parameters.promo == null ? null : field('promo', 'preço por', 9),
    encoding: parameters.encoding,
  };
}

export function productCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{1,24}$/.test(code)) throw new AppError(400, 'Código de produto inválido.');
  return /^\d+$/.test(code) ? code.replace(/^0+(?=\d)/, '') : code;
}

function decode(bytes, encoding) {
  if (encoding !== 'windows1252') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      if (encoding === 'utf8') throw new AppError(422, 'O arquivo não está em UTF-8.');
    }
  }
  return new TextDecoder('windows-1252').decode(bytes);
}

export function parsePriceFile(bytes, parameters) {
  const rows = decode(bytes, parameters.encoding).split(/\r\n|\n|\r/);
  const items = new Map();
  const issues = [];
  const amount = (value) => (/^\d{1,9}$/.test(value) ? Number(value) : NaN);
  const end = Math.max(
    ...[parameters.code, parameters.name, parameters.price, parameters.promo]
      .filter(Boolean)
      .map((field) => field.start + field.length)
  );
  for (const [index, row] of rows.entries()) {
    if (!row.trim()) continue;
    try {
      if (items.size >= 10000) throw new Error('Limite de 10.000 produtos por arquivo.');
      if (row.length < end || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(row)) {
        throw new Error('Registro incompatível com as posições configuradas.');
      }
      const read = (field) => row.slice(field.start, field.start + field.length).trim();
      const code = productCode(read(parameters.code));
      const name = read(parameters.name);
      const price = amount(read(parameters.price));
      const promoText = parameters.promo ? read(parameters.promo) : '';
      const promo = promoText && !/^0+$/.test(promoText) ? amount(promoText) : null;
      if (!name) throw new Error('Nome de produto vazio.');
      if (
        !Number.isFinite(price) ||
        (promo !== null && (!Number.isFinite(promo) || promo > price))
      ) {
        throw new Error('Preço inválido. Confira as posições e use valores em centavos.');
      }
      if (items.has(code)) throw new Error('Código duplicado: ' + code + '.');
      items.set(code, { code, name, price, promo });
    } catch (error) {
      issues.push('Linha ' + (index + 1) + ': ' + error.message);
      if (issues.length >= 20) break;
    }
  }
  if (issues.length) throw new AppError(422, issues[0], issues);
  if (!items.size) throw new AppError(422, 'O arquivo não contém produtos.');
  return [...items.values()];
}

export function changesBetween(previous, next) {
  const old = new Map(previous.map((p) => [p.code, p]));
  let added = 0;
  let changed = 0;
  for (const item of next) {
    const before = old.get(item.code);
    if (!before) added++;
    else if (
      before.name !== item.name ||
      before.price !== item.price ||
      before.promo !== item.promo
    )
      changed++;
    old.delete(item.code);
  }
  return { added, changed, removed: old.size };
}
