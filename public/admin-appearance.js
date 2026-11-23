import { el, button, input, field, numeric, check, select } from './admin-ui.js';
import { str } from './admin-format.js';

function appearanceGroup(title, ...controls) {
  return el(
    'fieldset',
    { class: 'parameter-fields' },
    el('legend', {}, title),
    el('div', { class: 'form-grid' }, controls)
  );
}

const appearanceColors = {
  nameColor: ['Cor do nome', '#fff8ed'],
  priceColor: ['Cor do preço', '#f9e2ab'],
  promoColor: ['Cor do preço promocional', '#ffe0a1'],
  oddColor: ['Cor das linhas ímpares', '#641f23'],
  evenColor: ['Cor das linhas pares', '#78292c'],
  tickerBg: ['Fundo da faixa', '#211b16'],
  tickerColor: ['Cor do texto da faixa', '#e4c48d'],
  borderColor: ['Cor da borda', '#dcc18a'],
};

function appearanceColor(key, value, theme, slider) {
  const [label, defaultColor] = appearanceColors[key];
  const rows = theme === 'dark' ? ['#202725', '#2e3733'] : ['#641f23', '#78292c'];
  const slideRows = theme === 'dark' ? ['#202725', '#2e3733'] : ['#4a171b', '#641f23'];
  const rowColors = slider ? slideRows : rows;
  const fallback =
    key === 'oddColor' ? rowColors[0] : key === 'evenColor' ? rowColors[1] : defaultColor;
  const hex = input(key, {
    value,
    placeholder: 'Padrão',
    pattern: '#[0-9a-fA-F]{6}',
    maxlength: 7,
    spellcheck: 'false',
    title: 'Cor hexadecimal com seis dígitos, como #B71C1C',
  });
  const swatch = input(`${key}Picker`, {
    type: 'color',
    value: value || fallback,
    'aria-label': `Selecionar ${label.toLocaleLowerCase('pt-BR')}`,
  });
  swatch.addEventListener('input', () => {
    hex.value = swatch.value;
  });
  hex.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(hex.value) || !hex.value) swatch.value = hex.value || fallback;
  });
  return el(
    'div',
    { class: 'color-field' },
    field(label, hex),
    swatch,
    button(
      'Padrão',
      () => {
        hex.value = '';
        swatch.value = fallback;
        hex.focus();
      },
      'secondary small',
      { 'aria-label': `Restaurar padrão de ${label.toLocaleLowerCase('pt-BR')}` }
    )
  );
}

export function createAppearanceEditor({ editor, saveEditor, getImages }) {
  return function editAppearance(screen) {
    const look = screen.appearance ?? {};
    const color = (key) => appearanceColor(key, look[key], screen.theme, look.slider);
    const number = (key, label, fallback, min = 1, attrs) =>
      field(label, numeric(key, look[key] ?? fallback, min, attrs));
    const toggle = (key, label, fallback = false) => check(key, label, look[key] ?? fallback);
    const choice = (key, label, values, fallback) =>
      field(label, select(key, values, look[key] ?? fallback));
    const size = { max: 150 };
    const fontSize = (key, label) =>
      field(
        label,
        input(key, {
          type: 'number',
          min: 12,
          max: 150,
          value: look[key] ?? '',
          placeholder: 'Automático',
        })
      );
    const percent = { max: 100 };
    const imageOptions = [
      ['', 'Sem imagem de fundo'],
      ...getImages().map((item) => [item.id, item.name]),
    ];

    editor(
      `Configurações de ${screen.name}`,
      'Salvar aparência',
      (box) =>
        saveEditor(
          box,
          'save-screen',
          (data) => {
            const appearance = {};
            for (const key of Object.keys(appearanceColors))
              appearance[key] = str(data, key) || null;
            for (const key of [
              'nameSize',
              'nameLimit',
              'priceSize',
              'promoSize',
              'tickerSeconds',
              'topPercent',
              'bottomPercent',
              'slider',
              'photoWidth',
              'photoHeight',
            ]) {
              if (str(data, key)) appearance[key] = Number(data.get(key));
            }
            for (const key of [
              'hideOldPrice',
              'showImages',
              'showHeader',
              'showTicker',
              'border',
            ]) {
              appearance[key] = data.has(key);
            }
            appearance.layout = 'side';
            appearance.topPercent = look.topPercent ?? 75;
            appearance.bottomPercent = look.bottomPercent ?? 25;
            for (const key of ['photoX', 'photoY']) appearance[key] = str(data, key);
            appearance.slideBackgroundId = str(data, 'slideBackgroundId') || null;
            return {
              id: screen.id,
              name: screen.name,
              listIds: screen.listIds,
              mediaIds: screen.mediaIds,
              theme: screen.theme,
              rotationSeconds: screen.rotationSeconds,
              rows: screen.rows,
              appearance,
            };
          },
          'Aparência salva.'
        ),
      () => [
        el(
          'p',
          { class: 'hint' },
          'Deixe o tamanho em branco para ajustar automaticamente à TV. Tamanhos manuais usam uma TV de 1920 pixels de largura como referência. Deixe a cor em branco para usar o padrão do tema.'
        ),
        appearanceGroup(
          'Nome e preços dos produtos',
          fontSize('nameSize', 'Tamanho do nome'),
          color('nameColor'),
          number('nameLimit', 'Limite de caracteres do nome', 50, 12, size),
          fontSize('priceSize', 'Tamanho do preço'),
          color('priceColor'),
          fontSize('promoSize', 'Tamanho do preço promocional'),
          color('promoColor'),
          toggle('hideOldPrice', 'Ocultar preço anterior em promoções')
        ),
        appearanceGroup('Linhas da tabela', color('oddColor'), color('evenColor')),
        appearanceGroup(
          'Cabeçalho e faixa de mensagens',
          toggle('showHeader', 'Exibir cabeçalho', true),
          toggle('showTicker', 'Exibir faixa de mensagens', true),
          color('tickerBg'),
          color('tickerColor'),
          number('tickerSeconds', 'Tempo de rolagem da faixa (segundos)', 30, 1, percent)
        ),
        appearanceGroup(
          'Foto da loja',
          el(
            'p',
            { class: 'hint' },
            'A foto preenche sempre a coluna vertical, sem deformar. Ajuste a posição para escolher a parte da imagem que aparece.'
          ),
          choice(
            'photoX',
            'Posição horizontal do recorte',
            [
              ['left', 'Esquerda'],
              ['center', 'Centro'],
              ['right', 'Direita'],
            ],
            'center'
          ),
          choice(
            'photoY',
            'Posição vertical do recorte',
            [
              ['top', 'Topo'],
              ['center', 'Centro'],
              ['bottom', 'Base'],
            ],
            'center'
          ),
          toggle('showImages', 'Exibir imagens', true)
        ),
        appearanceGroup(
          'Carrossel',
          choice(
            'slider',
            'Modo do carrossel',
            [
              [0, 'Tabela de preços'],
              [1, '1 produto por página'],
              [2, '2 produtos por página'],
              [4, '4 produtos por página'],
            ],
            0
          ),
          choice('slideBackgroundId', 'Imagem de fundo', imageOptions, ''),
          toggle('border', 'Exibir borda dos produtos'),
          color('borderColor')
        ),
        appearanceGroup(
          'Fotos dos produtos no carrossel',
          el(
            'p',
            { class: 'hint' },
            'Estes tamanhos afetam as fotos dos produtos nos modos de 1, 2 e 4 produtos. A foto da coluna lateral sempre preenche o espaço.'
          ),
          number('photoWidth', 'Largura da foto (%)', 100, 1, percent),
          number('photoHeight', 'Altura da foto (%)', 100, 1, percent)
        ),
      ]
    );
  };
}
