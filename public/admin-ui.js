export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

export function button(label, handler, variant = '', attrs = {}) {
  return el(
    'button',
    { type: 'button', class: `button ${variant}`, onclick: handler, ...attrs },
    label
  );
}

export function link(label, href, variant = '', attrs = {}) {
  return el('a', { href, class: `button ${variant}`, ...attrs }, label);
}

export function noticeBox() {
  return el('div', {
    class: 'notice',
    'aria-live': 'polite',
    'aria-atomic': 'true',
    tabindex: '-1',
  });
}

export function showNotice(box, message, kind = 'success') {
  if (!box?.isConnected) return;
  box.className = `notice ${kind}`;
  box.replaceChildren();
  if (!message) return;
  if (message instanceof Error) {
    box.append(el('p', {}, message.message));
    if (message.issues?.length) {
      box.append(
        el(
          'ul',
          {},
          message.issues.map((issue) => el('li', {}, issue))
        )
      );
    }
    box.focus();
  } else {
    box.append(el('p', {}, message));
  }
}

export function input(name, attrs = {}) {
  return el('input', { name, ...attrs });
}

export function field(label, control, hint) {
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'field-label' }, label),
    control,
    hint && el('small', { class: 'hint' }, hint)
  );
}

export function select(name, choices, value, attrs = {}) {
  const control = el(
    'select',
    { name, ...attrs },
    choices.map(([id, label]) => el('option', { value: id }, label))
  );
  if (value != null) control.value = value;
  return control;
}

export function check(name, label, checked) {
  return el(
    'label',
    { class: 'check' },
    input(name, { type: 'checkbox', checked }),
    el('span', {}, label)
  );
}

export function numeric(name, value, min = 1, attrs = {}) {
  return input(name, { type: 'number', step: 1, min, value, required: true, ...attrs });
}

export function panel(title, content, tools) {
  return el(
    'section',
    { class: 'panel' },
    el('header', { class: 'panel-head' }, el('h2', {}, title), tools),
    el('div', { class: 'panel-body' }, content)
  );
}

export function heading(title, description, tools) {
  return el(
    'header',
    { class: 'page-head' },
    el(
      'div',
      {},
      el('h1', { id: 'page-title', tabindex: '-1' }, title),
      description && el('p', {}, description)
    ),
    tools
  );
}

export function empty(message) {
  return el('p', { class: 'empty' }, message);
}

export function actions(...children) {
  return el('div', { class: 'actions' }, children);
}

export function table(title, columns, rows) {
  return el(
    'div',
    { class: 'table-wrap', role: 'region', 'aria-label': title, tabindex: '0' },
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          columns.map((column) => el('th', { scope: 'col' }, column))
        )
      ),
      el(
        'tbody',
        {},
        rows.map((row) =>
          el(
            'tr',
            {},
            row.map((cell) => el('td', {}, cell))
          )
        )
      )
    )
  );
}

export function brand() {
  return el('div', { class: 'brand' }, brandLogo(), el('span', {}, 'Tabela Digital'));
}

export function brandLogo() {
  const ns = 'http://www.w3.org/2000/svg';
  const logo = document.createElementNS(ns, 'svg');
  // Show the artwork within the supplied PNG's transparent canvas, without stretching.
  logo.setAttribute('viewBox', '125 780 845 340');
  logo.setAttribute('role', 'img');
  logo.setAttribute('aria-label', 'Arapongas Supermercados');
  const image = document.createElementNS(ns, 'image');
  image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '/arapongas-logo.png');
  for (const [name, value] of Object.entries({
    href: '/arapongas-logo.png',
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
  })) {
    image.setAttribute(name, value);
  }
  logo.append(image);
  return el('span', { class: 'brand-logo' }, logo);
}
