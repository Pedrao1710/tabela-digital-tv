const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function str(data, name) {
  return String(data.get(name) ?? '').trim();
}

export function money(cents) {
  return cents == null ? '—' : brl.format(cents / 100);
}

export function priceInput(cents) {
  return cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

export function parsePrice(value, label) {
  const valid = /^(?:\d+(?:[.,]\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)$/;
  if (valid.test(value)) {
    const decimal = value.includes(',')
      ? value.replaceAll('.', '').replace(',', '.')
      : /\.\d{3}$/.test(value)
        ? value.replaceAll('.', '')
        : value;
    const [whole, fraction = ''] = decimal.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (Number.isSafeInteger(cents)) return cents;
  }
  throw new Error(`Informe ${label} em reais, como 12,50.`);
}

export function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? '—') : dateFormat.format(date);
}

export function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function searchKey(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}
