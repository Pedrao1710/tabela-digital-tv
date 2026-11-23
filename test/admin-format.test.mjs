import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dateLabel,
  formatCount,
  money,
  parsePrice,
  priceInput,
  searchKey,
  str,
} from '../public/admin-format.js';

test('preços brasileiros e decimais viram centavos inteiros sem arredondamento inesperado', () => {
  for (const [value, expected] of [
    ['0', 0],
    ['0,01', 1],
    ['12', 1200],
    ['12,5', 1250],
    ['12.50', 1250],
    ['1.299,90', 129990],
    ['1.299', 129900],
    ['12.345.678,90', 1234567890],
    ['00,01', 1],
  ]) {
    assert.equal(parsePrice(value, 'o preço'), expected, value);
  }
});

test('preços malformados, negativos e fora da faixa inteira segura são rejeitados', () => {
  for (const value of [
    '',
    '-1,00',
    '1e3',
    'NaN',
    '12,345',
    '12.34.56',
    '1.23,45',
    ' 12,50 ',
    'R$ 12,50',
    '9007199254740992',
  ]) {
    assert.throws(
      () => parsePrice(value, 'o preço promocional'),
      /Informe o preço promocional em reais, como 12,50\./,
      value
    );
  }
});

test('moeda e campos de edição preservam zeros e ausência de preço', () => {
  assert.equal(money(null), '—');
  assert.equal(money(undefined), '—');
  assert.equal(money(0).replace(/\s/g, ' '), 'R$ 0,00');
  assert.equal(money(129990).replace(/\s/g, ' '), 'R$ 1.299,90');
  assert.equal(priceInput(null), '');
  assert.equal(priceInput(undefined), '');
  assert.equal(priceInput(0), '0,00');
  assert.equal(priceInput(1), '0,01');
  assert.equal(priceInput(129990), '1299,90');
});

test('leitura de formulário, busca e contagens mantêm o texto esperado', () => {
  const data = new FormData();
  data.set('name', '  Açougue da loja  ');
  assert.equal(str(data, 'name'), 'Açougue da loja');
  assert.equal(str(data, 'missing'), '');
  assert.equal(searchKey('AÇOUGUE · PICANHÃ'), 'acougue · picanha');
  assert.equal(formatCount(1, 'lista vinculada', 'listas vinculadas'), '1 lista vinculada');
  assert.equal(formatCount(0, 'lista vinculada', 'listas vinculadas'), '0 listas vinculadas');
  assert.equal(formatCount(2, 'lista vinculada', 'listas vinculadas'), '2 listas vinculadas');
});

test('data inválida conserva o texto de origem em vez de quebrar a tela', () => {
  assert.equal(dateLabel('data inválida'), 'data inválida');
  assert.equal(dateLabel(''), '');
});
