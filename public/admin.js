import {
  el,
  button,
  link,
  noticeBox,
  showNotice,
  input,
  field,
  select,
  check,
  numeric,
  panel,
  heading,
  empty,
  actions,
  table,
  brand,
  brandLogo,
} from './admin-ui.js';
import {
  str,
  money,
  priceInput,
  parsePrice,
  dateLabel,
  formatCount,
  searchKey,
} from './admin-format.js';
import { createRequest } from './admin-client.js';
import { createAppearanceEditor } from './admin-appearance.js';

const app = document.querySelector('#app');
const pageSize = 30;
const routes = {
  painel: ['Painel', '⌂', dashboard],
  telas: ['Telas', '▣', screensPage],
  listas: ['Listas', '☷', listsPage],
  produtos: ['Produtos', '▤', productsPage],
  importacao: ['Importação', '⇧', importPage],
  historico: ['Histórico', '◷', historyPage],
  imagens: ['Imagens', '▧', imagesPage],
  configuracoes: ['Configurações', '⚙', settingsPage],
  parametros: ['Parâmetros do arquivo', '≡', parametersPage],
  acessos: ['Lojas e acessos', '♙', accessPage],
  senha: ['Alterar senha', '⚿', passwordPage],
};

let session;
let state;
let busy = false;
let notice;
let importDraft = null;
let sessionGeneration = 0;
const sessionEvents =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel('tabela.admin.session') : null;

const request = createRequest({
  getGeneration: () => sessionGeneration,
  getStoreId: () => state?.store.id,
  hasUser: () => Boolean(session?.user),
  onUnauthorized: () => closePrivateView('Sua sessão terminou. Entre novamente.'),
});
const editAppearance = createAppearanceEditor({ editor, saveEditor, getImages: images });

function closePrivateView(message) {
  sessionGeneration++;
  state = null;
  importDraft = null;
  session = { user: null, setup: false, demo: session?.demo === true };
  for (const dialog of document.querySelectorAll('dialog')) dialog.remove();
  history.replaceState(null, '', '/login');
  render(message);
  document.querySelector('#login-title')?.focus();
}

sessionEvents?.addEventListener('message', (event) => {
  if (event.data === 'signed-out' && session?.user) closePrivateView('Sessão encerrada.');
});

function discardLegacyTVCache() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('arapongas.tv.')) localStorage.removeItem(key);
    }
  } catch {
    /* Storage can be disabled on managed browsers. */
  }
}

function routeUrl(route) {
  return `/cliente/#${route}`;
}

function currentRoute() {
  const route = location.hash.slice(1);
  return Object.hasOwn(routes, route) ? route : 'painel';
}

async function run(control, box, task) {
  if (busy) return;
  busy = true;
  const region = control.closest('form') || control;
  region.setAttribute('aria-busy', 'true');
  control.disabled = true;
  showNotice(box, 'Aguarde…', 'pending');
  try {
    await task();
  } catch (error) {
    showNotice(box, error, 'error');
  } finally {
    busy = false;
    control.disabled = false;
    region.removeAttribute('aria-busy');
  }
}

function update(next, message) {
  if (state?.store.id === next.store.id && !next.priceSource) next.priceSource = state.priceSource;
  if (state?.store.id !== next.store.id) importDraft = null;
  else if (importDraft?.result) importDraft = { file: importDraft.file };
  state = next;
  session.user = next.user;
  render(message);
  if (message) notice.focus();
}

function action(control, name, data, message) {
  return run(control, notice, async () => {
    const next = await request('/api/action', { action: name, ...data });
    update(next, message);
  });
}

function form(label, submit, fields, { box = notice, extra = [], variant = 'primary' } = {}) {
  const send = el('button', { type: 'submit', class: `button ${variant}` }, label);
  return el(
    'form',
    {
      class: 'form',
      onsubmit(event) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(send, box, () => submit(data));
      },
    },
    fields,
    el('div', { class: 'actions form-actions' }, send, extra)
  );
}

function screenUrl(screen) {
  return `/tv/${encodeURIComponent(screen.token)}`;
}

function screenLink(screen, label = 'Abrir tela') {
  return link(label, screenUrl(screen), 'secondary small', {
    target: '_blank',
    rel: 'noopener',
    'aria-label': `${label} de ${screen.name} em nova aba`,
  });
}

async function copyLink(screen) {
  const url = new URL(screenUrl(screen), location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    showNotice(notice, 'Link copiado.');
  } catch {
    const box = el('dialog', { class: 'dialog', 'aria-label': 'Link da tela' });
    const address = input('link', { readonly: true, value: url });
    box.append(
      el('div', { class: 'dialog-head' }, el('h2', {}, 'Link da tela')),
      el(
        'div',
        { class: 'dialog-body' },
        field('Selecione e copie o endereço', address),
        actions(button('Fechar', () => box.close(), 'secondary'))
      )
    );
    box.addEventListener('close', () => box.remove());
    document.body.append(box);
    box.showModal();
    address.select();
  }
}

function copyButton(screen) {
  return button('Copiar link', () => copyLink(screen), 'secondary small', {
    'aria-label': `Copiar link de ${screen.name}`,
  });
}

function loginPage() {
  const setup = session.setup;
  const password = input('password', {
    id: 'login-password',
    type: 'password',
    required: true,
    maxlength: 128,
    autocomplete: setup ? 'new-password' : 'current-password',
    ...(setup ? { minlength: 10 } : {}),
  });
  const reveal = button(
    'Mostrar',
    (event) => {
      const visible = password.type === 'password';
      password.type = visible ? 'text' : 'password';
      event.currentTarget.textContent = visible ? 'Ocultar' : 'Mostrar';
      event.currentTarget.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
    },
    'reveal',
    { 'aria-controls': password.id, 'aria-label': 'Mostrar senha' }
  );
  const fields = [
    setup &&
      field(
        'Código de instalação',
        input('setupCode', { type: 'password', required: true, autocomplete: 'off' }),
        'Use o código fornecido pelo responsável pela instalação.'
      ),
    setup &&
      field('Seu nome', input('name', { required: true, autocomplete: 'name', maxlength: 100 })),
    setup &&
      field('Nome da loja', input('storeName', { required: true, autocomplete: 'organization' })),
    field(
      'E-mail',
      input('email', {
        type: 'email',
        required: true,
        autocomplete: 'username',
        autocapitalize: 'none',
        spellcheck: 'false',
      })
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: password.id, class: 'field-label' }, 'Senha'),
      el('div', { class: 'password-entry' }, password, reveal),
      setup && el('small', { class: 'hint' }, 'Use entre 10 e 128 caracteres.')
    ),
  ];
  const login = form(
    setup ? 'Criar conta e loja' : 'Entrar',
    async (data) => {
      session = await request(setup ? '/api/setup' : '/api/login', {
        ...(setup
          ? {
              name: str(data, 'name'),
              storeName: str(data, 'storeName'),
              setupCode: str(data, 'setupCode'),
            }
          : {}),
        email: str(data, 'email'),
        password: data.get('password'),
      });
      history.replaceState(null, '', '/telas');
      try {
        update(await request('/api/state'));
        document.querySelector('#page-title')?.focus();
      } catch (error) {
        startupError(error);
      }
    },
    fields
  );

  return el(
    'main',
    { id: 'conteudo', tabindex: '-1', class: 'auth-page' },
    el('header', { class: 'auth-mast' }, brand()),
    el(
      'div',
      { class: 'auth-spread' },
      el('div', { class: 'auth-art', 'aria-hidden': 'true' }, brandLogo()),
      el(
        'section',
        { class: 'auth-form', 'aria-labelledby': 'login-title' },
        el(
          'h1',
          { id: 'login-title', tabindex: '-1' },
          setup ? 'Primeiro acesso' : 'Entrar no painel'
        ),
        setup &&
          el(
            'p',
            { class: 'login-description' },
            'Cadastre a primeira loja e a conta responsável.'
          ),
        notice,
        login
      )
    )
  );
}

function logout(control) {
  return run(control, notice, async () => {
    await request('/api/logout', {});
    sessionEvents?.postMessage('signed-out');
    closePrivateView('Sessão encerrada.');
  });
}

function storeControl() {
  if (state.stores.length < 2) return el('strong', { class: 'store-name' }, state.store.name);
  const choose = select(
    'store',
    state.stores.map((store) => [store.id, store.name]),
    state.store.id,
    { 'aria-label': 'Loja ativa' }
  );
  const switchButton = button(
    'Trocar loja',
    (event) => {
      if (choose.value !== state.store.id) {
        action(event.currentTarget, 'switch-store', { id: choose.value }, 'Loja alterada.');
      }
    },
    'secondary small',
    { disabled: true }
  );
  choose.addEventListener('change', () => {
    switchButton.disabled = choose.value === state.store.id;
  });
  return el('div', { class: 'store-switch' }, choose, switchButton);
}

function userControls() {
  return el(
    'div',
    { class: 'user-controls' },
    storeControl(),
    el('span', { class: 'user-name', title: state.user.email }, state.user.name),
    button('Sair', (event) => logout(event.currentTarget), 'secondary small')
  );
}

function pickerPage() {
  return el(
    'div',
    { class: 'picker-page' },
    el('header', { class: 'picker-bar' }, brand(), userControls()),
    el(
      'main',
      { id: 'conteudo', tabindex: '-1', class: 'picker-content' },
      heading(
        'Escolha uma tela',
        'Abra a tela que deseja exibir na TV.',
        link('Configurações da tabela', routeUrl('painel'), 'primary')
      ),
      notice,
      state.screens.length
        ? el(
            'ul',
            { class: 'screen-cards' },
            state.screens.map((screen) =>
              el(
                'li',
                { class: 'screen-card' },
                el('span', { class: 'screen-mark', 'aria-hidden': 'true' }, '▣'),
                el(
                  'div',
                  {},
                  el('h2', {}, screen.name),
                  el(
                    'p',
                    {},
                    screen.listIds.length
                      ? formatCount(screen.listIds.length, 'lista vinculada', 'listas vinculadas')
                      : 'Sem lista de produtos vinculada'
                  ),
                  actions(screenLink(screen), copyButton(screen))
                )
              )
            )
          )
        : panel('Telas da loja', [
            empty('Nenhuma tela cadastrada.'),
            link('Cadastrar tela', routeUrl('telas'), 'primary'),
          ])
    )
  );
}

function adminPage() {
  const route = currentRoute();
  const navigation = el(
    'nav',
    { id: 'menu', 'aria-label': 'Menu da administração' },
    Object.entries(routes).map(([id, [label, icon]]) =>
      el(
        'a',
        { href: routeUrl(id), 'aria-current': id === route ? 'page' : null },
        el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon),
        label
      )
    )
  );
  const menu = button(
    '☰ Menu',
    (event) => {
      const expanded = navigation.classList.toggle('expanded');
      event.currentTarget.setAttribute('aria-expanded', expanded);
    },
    'menu-toggle',
    { 'aria-controls': 'menu', 'aria-expanded': 'false' }
  );

  return el(
    'div',
    { class: 'admin-layout' },
    el(
      'aside',
      { class: 'sidebar' },
      el('div', { class: 'sidebar-brand' }, el('a', { href: routeUrl('painel') }, brand()), menu),
      navigation
    ),
    el(
      'div',
      { class: 'admin-body' },
      el(
        'header',
        { class: 'topbar' },
        link('Escolher uma tela', '/telas', 'secondary small'),
        userControls()
      ),
      el(
        'main',
        { id: 'conteudo', tabindex: '-1', class: 'admin-content' },
        notice,
        routes[route][2]()
      )
    )
  );
}

function render(message) {
  notice = noticeBox();
  const picker = location.pathname.replace(/\/$/, '') === '/telas';
  app.replaceChildren(!session.user ? loginPage() : picker ? pickerPage() : adminPage());
  document.title = `${!session.user ? 'Área do Cliente' : picker ? 'Escolha uma tela' : routes[currentRoute()][0]} · Tabela Digital Arapongas`;
  if (message) showNotice(notice, message);
}

function goToContent(event) {
  event.preventDefault();
  document.querySelector('#conteudo')?.focus();
}

function startupError(error) {
  notice = noticeBox();
  app.replaceChildren(
    el(
      'main',
      { id: 'conteudo', tabindex: '-1', class: 'center-page' },
      el(
        'div',
        { class: 'login-card' },
        brand(),
        el('h1', {}, 'Área do Cliente'),
        notice,
        button('Tentar novamente', (event) => run(event.currentTarget, notice, start), 'primary')
      )
    )
  );
  showNotice(notice, error, 'error');
}

async function start() {
  try {
    session = await request('/api/session');
    if (session.user) {
      state = await request('/api/state');
      if (!location.pathname.startsWith('/cliente') && !/^\/telas\/?$/.test(location.pathname)) {
        history.replaceState(null, '', '/telas');
      }
    }
    render();
  } catch (error) {
    if (!document.querySelector('#login-title')) startupError(error);
  }
}

document.querySelector('.skip-link').addEventListener('click', goToContent);
window.addEventListener('hashchange', () => {
  if (!state) return;
  render();
  document.querySelector('#page-title')?.focus();
});

function editor(title, saveLabel, submit, build) {
  if (busy) return;
  const box = el('dialog', { class: 'dialog', 'aria-labelledby': 'editor-title' });
  const errors = noticeBox();
  const cancel = button(
    'Cancelar',
    () => {
      if (!busy) box.close();
    },
    'secondary'
  );
  box.append(
    el('div', { class: 'dialog-head' }, el('h2', { id: 'editor-title' }, title)),
    el(
      'div',
      { class: 'dialog-body' },
      errors,
      form(saveLabel, submit(box), build(), {
        box: errors,
        extra: [cancel],
      })
    )
  );
  box.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  box.addEventListener('close', () => box.remove());
  document.body.append(box);
  box.showModal();
}

function saveEditor(box, name, payload, message) {
  return async (data) => {
    const next = await request('/api/action', { action: name, ...payload(data) });
    box.close();
    update(next, message);
  };
}

function confirmAction(label, name, payload, question, message, variant = 'danger') {
  return button(
    label,
    (event) => {
      if (!busy && window.confirm(question)) action(event.currentTarget, name, payload, message);
    },
    `${variant} small`
  );
}

function searchResults({ items, label, terms, draw, emptyText, size = pageSize }) {
  const indexed = items.map((item) => [item, searchKey(terms(item))]);
  const output = el('div');
  const summary = el('p', { class: 'hint results-summary', 'aria-live': 'polite' });
  const search = input('busca', {
    type: 'search',
    placeholder: 'Digite para buscar',
    autocomplete: 'off',
  });
  const previous = button(
    'Anterior',
    () => {
      page--;
      refresh();
    },
    'secondary small'
  );
  const next = button(
    'Próxima',
    () => {
      page++;
      refresh();
    },
    'secondary small'
  );
  let page = 0;

  function refresh() {
    const query = searchKey(search.value.trim());
    const matches = indexed.filter(([, term]) => term.includes(query));
    const start = page * size;
    const end = Math.min(start + size, matches.length);
    previous.disabled = page === 0;
    next.disabled = end === matches.length;
    summary.textContent = matches.length
      ? `${start + 1}–${end} de ${matches.length}`
      : '0 resultados';
    output.replaceChildren(
      matches.length ? draw(matches.slice(start, end).map(([item]) => item)) : empty(emptyText)
    );
  }

  search.addEventListener('input', () => {
    page = 0;
    refresh();
  });
  refresh();
  return el(
    'div',
    { class: 'search-results' },
    field(label, search),
    output,
    el('div', { class: 'pagination' }, summary, actions(previous, next))
  );
}

function orderedPicker({ title, selected, available, id, label, search = false }) {
  const known = new Map(available.map((item) => [id(item), item]));
  const chosen = el('ol', {
    class: 'ordered-items',
    tabindex: '-1',
    'aria-label': `Ordem de ${title}`,
  });
  const feedback = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const addButtons = new Map();

  function refresh(focusIndex, operation) {
    for (const [key, control] of addButtons) {
      if (control.isConnected) control.disabled = selected.includes(key);
      else addButtons.delete(key);
    }
    chosen.replaceChildren(
      ...selected.map((key, index) => {
        const item = known.get(key);
        const title = item ? label(item) : `${key} · indisponível`;
        function move(offset, name) {
          const destination = index + offset;
          [selected[index], selected[destination]] = [selected[destination], selected[index]];
          refresh(destination, name);
          feedback.textContent = `${title} movido para a posição ${destination + 1}.`;
        }
        return el(
          'li',
          {},
          el('span', { class: 'ordered-label' }, title),
          actions(
            button('↑', () => move(-1, 'up'), 'secondary small', {
              disabled: index === 0,
              'aria-label': `Subir ${title}`,
              'data-operation': 'up',
            }),
            button('↓', () => move(1, 'down'), 'secondary small', {
              disabled: index === selected.length - 1,
              'aria-label': `Descer ${title}`,
              'data-operation': 'down',
            }),
            button(
              'Remover',
              () => {
                selected.splice(index, 1);
                refresh(Math.min(index, selected.length - 1), 'remove');
                feedback.textContent = `${title} removido.`;
              },
              'danger small',
              { 'aria-label': `Remover ${title}`, 'data-operation': 'remove' }
            )
          )
        );
      })
    );
    if (focusIndex != null) {
      const row = chosen.children[focusIndex];
      (
        row?.querySelector(`[data-operation="${operation}"]:not(:disabled)`) ||
        row?.querySelector('button:not(:disabled)') ||
        chosen
      ).focus();
    }
  }

  function choices(items) {
    addButtons.clear();
    return el(
      'ul',
      { class: 'choices' },
      items.map((item) => {
        const key = id(item);
        const text = label(item);
        const control = button(
          'Adicionar',
          () => {
            if (selected.includes(key)) return;
            selected.push(key);
            refresh(selected.length - 1, 'remove');
            feedback.textContent = `${text} adicionado à posição ${selected.length}.`;
          },
          'secondary small',
          { disabled: selected.includes(key), 'aria-label': `Adicionar ${text}` }
        );
        addButtons.set(key, control);
        return el('li', {}, el('span', {}, text), control);
      })
    );
  }

  refresh();
  return el(
    'fieldset',
    { class: 'ordered-picker' },
    el('legend', {}, title),
    el('p', { class: 'hint' }, 'Use as setas para alterar a ordem de exibição.'),
    chosen,
    feedback,
    !available.length
      ? empty('Nenhum item disponível para adicionar.')
      : search
        ? searchResults({
            items: available,
            label: 'Buscar por nome ou código',
            terms: label,
            draw: choices,
            emptyText: 'Nenhum produto encontrado.',
            size: 10,
          })
        : choices(available)
  );
}

function dashboard() {
  const counts = [
    ['Produtos', state.catalog.length, 'produtos'],
    ['Listas', state.lists.length, 'listas'],
    ['Telas', state.screens.length, 'telas'],
    ['Imagens', images().length, 'imagens'],
  ];
  return [
    heading('Painel', `Visão geral de ${state.store.name}.`),
    el(
      'div',
      { class: 'stat-grid' },
      counts.map(([label, count, route]) =>
        el(
          'a',
          { class: 'stat', href: routeUrl(route) },
          el('span', {}, label),
          el('strong', {}, count),
          el('span', { 'aria-hidden': 'true' }, '›')
        )
      )
    ),
    panel(
      'Telas da loja',
      state.screens.length
        ? table(
            'Telas da loja',
            ['Tela', 'Listas', 'Ações'],
            state.screens.map((screen) => [
              screen.name,
              screen.listIds.length,
              actions(screenLink(screen, 'Visualizar'), copyButton(screen)),
            ])
          )
        : empty('Cadastre uma tela e vincule as listas de produtos que deseja exibir.'),
      link('Gerenciar telas', routeUrl('telas'), 'secondary small')
    ),
    panel('Importação de preços', [
      sourceStatusView(state.priceSource),
      state.imports.length
        ? el('p', {}, 'Registros no histórico: ', el('strong', {}, state.imports.length))
        : empty('Nenhum arquivo importado.'),
      actions(
        link('Importar arquivo', routeUrl('importacao'), 'primary small'),
        link('Ver histórico', routeUrl('historico'), 'secondary small')
      ),
    ]),
  ];
}

function sourceStatusView(source) {
  const status =
    source?.state === 'ok'
      ? 'Arquivo de preços conferido com sucesso.'
      : source?.state === 'error'
        ? 'Atenção: não foi possível atualizar o arquivo de preços. A última tabela válida foi mantida.'
        : source?.state === 'override'
          ? 'Atenção: o catálogo foi alterado manualmente e pode estar diferente do arquivo de preços.'
          : source?.state === 'waiting'
            ? 'Aguardando a conferência do arquivo de preços.'
            : source?.state === 'unconfigured'
              ? 'Atualização automática não configurada.'
              : 'Estado da atualização indisponível.';
  const tone =
    source?.state === 'ok'
      ? 'ok'
      : source?.state === 'error' || source?.state === 'override'
        ? 'warning'
        : 'pending';
  return el(
    'div',
    {
      id: 'price-source-status',
      class: `source-status source-status--${tone}`,
      role: 'status',
      'aria-live': 'polite',
    },
    el('p', {}, status),
    source?.lastSuccess
      ? el(
          'p',
          {},
          'Última conferência bem-sucedida: ',
          new Date(source.lastSuccess).toLocaleString('pt-BR')
        )
      : null
  );
}

async function refreshSourceStatus() {
  const target = document.querySelector('#price-source-status');
  if (!target || !state?.store?.id || document.hidden) return;
  const storeId = state.store.id;
  try {
    const latest = await request('/api/state');
    if (state?.store?.id !== storeId || latest.store.id !== storeId || !target.isConnected) return;
    state.priceSource = latest.priceSource;
    target.replaceWith(sourceStatusView(latest.priceSource));
  } catch {
    if (state?.store?.id === storeId && target.isConnected)
      target.replaceWith(sourceStatusView(null));
  }
}

let sessionCheckPending = false;
async function refreshAccess() {
  if (!session?.user || document.hidden || sessionCheckPending) return;
  const generation = sessionGeneration;
  const previousUser = session.user.id;
  const previousStore = session.user.storeId;
  sessionCheckPending = true;
  try {
    const latest = await request('/api/session');
    if (generation !== sessionGeneration || session?.user?.storeId !== previousStore) return;
    if (!latest.user || latest.user.id !== previousUser) {
      closePrivateView('Sua sessão terminou. Entre novamente.');
      return;
    }
    if (latest.user.storeId !== session.user.storeId) {
      location.reload();
      return;
    }
    await refreshSourceStatus();
  } catch {
    // A network failure does not prove revocation; the server still gates every action.
  } finally {
    sessionCheckPending = false;
  }
}
window.setInterval(refreshAccess, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshAccess();
});

function listsPage() {
  return [
    heading(
      'Listas',
      'Organize os produtos na ordem em que devem aparecer nas telas.',
      button('Nova lista', () => editList(), 'primary')
    ),
    panel(
      'Listas cadastradas',
      state.lists.length
        ? table(
            'Listas cadastradas',
            ['Nome', 'Produtos', 'Ações'],
            state.lists.map((list) => [
              list.name,
              list.codes.length,
              actions(
                button('Editar', () => editList(list), 'secondary small'),
                confirmAction(
                  'Excluir',
                  'delete-list',
                  { id: list.id },
                  `Excluir a lista “${list.name}”?`,
                  'Lista excluída.'
                )
              ),
            ])
          )
        : empty('Nenhuma lista cadastrada. Crie uma lista para organizar os produtos.')
    ),
  ];
}

function editList(list) {
  const codes = [...(list?.codes || [])];
  editor(
    list ? 'Editar lista' : 'Nova lista',
    'Salvar lista',
    (box) =>
      saveEditor(
        box,
        'save-list',
        (data) => ({
          id: list?.id,
          name: str(data, 'name'),
          codes,
        }),
        'Lista salva.'
      ),
    () => [
      field('Nome da lista', input('name', { required: true, value: list?.name, autofocus: true })),
      orderedPicker({
        title: 'Produtos da lista',
        selected: codes,
        available: state.catalog,
        id: (item) => item.code,
        label: (item) => `${item.code} · ${item.name}`,
        search: true,
      }),
    ]
  );
}

function images() {
  return state.media.filter((item) => item.type === 'image');
}

function appearanceButton(screen, label = 'Configurações') {
  return button(label, () => editAppearance(screen), 'secondary small', {
    'aria-label': `${label} de ${screen.name}`,
  });
}

function screensPage() {
  const imageIds = new Set(images().map((item) => item.id));
  return [
    heading(
      'Telas',
      'Configure as listas, as imagens e o endereço de cada TV.',
      button('Nova tela', () => editScreen(), 'primary')
    ),
    panel(
      'Telas cadastradas',
      state.screens.length
        ? table(
            'Telas cadastradas',
            ['Nome', 'Tema', 'Listas', 'Imagens', 'Ações'],
            state.screens.map((screen) => [
              screen.name,
              screen.theme === 'dark' ? 'Escuro' : 'Vermelho',
              screen.listIds.length,
              screen.mediaIds.filter((id) => imageIds.has(id)).length,
              actions(
                screenLink(screen, 'Visualizar'),
                copyButton(screen),
                button('Editar', () => editScreen(screen), 'secondary small'),
                appearanceButton(screen),
                confirmAction(
                  'Gerar novo link',
                  'rotate-link',
                  { id: screen.id },
                  `Gerar um novo link para “${screen.name}”? O link anterior deixará de funcionar.`,
                  'Novo link gerado. Use Copiar link para enviar o endereço atualizado.',
                  'secondary'
                ),
                confirmAction(
                  'Excluir',
                  'delete-screen',
                  { id: screen.id },
                  `Excluir a tela “${screen.name}”? O endereço da TV deixará de funcionar.`,
                  'Tela excluída.'
                )
              ),
            ])
          )
        : empty('Nenhuma tela cadastrada. Crie uma tela para obter o link da TV.')
    ),
  ];
}

function editScreen(screen) {
  const listIds = [...(screen?.listIds || [])];
  const availableImages = images();
  const imageIds = new Set(availableImages.map((image) => image.id));
  const mediaIds = (screen?.mediaIds || []).filter((id) => imageIds.has(id));
  editor(
    screen ? 'Editar tela' : 'Nova tela',
    'Salvar tela',
    (box) =>
      saveEditor(
        box,
        'save-screen',
        (data) => ({
          id: screen?.id,
          name: str(data, 'name'),
          listIds,
          mediaIds,
          theme: str(data, 'theme'),
          rows: Number(data.get('rows')),
          rotationSeconds: str(data, 'rotationSeconds')
            ? Number(data.get('rotationSeconds'))
            : null,
          appearance: screen?.appearance ?? {},
        }),
        'Tela salva.'
      ),
    () => [
      field(
        'Nome da tela',
        input('name', { required: true, value: screen?.name, autofocus: true })
      ),
      el(
        'div',
        { class: 'form-grid' },
        field(
          'Tema',
          select(
            'theme',
            [
              ['red', 'Vermelho'],
              ['dark', 'Escuro'],
            ],
            screen?.theme
          )
        ),
        field('Linhas por página', numeric('rows', screen?.rows ?? 8, 1, { max: 12 })),
        field(
          'Intervalo de rotação (segundos)',
          numeric('rotationSeconds', screen?.rotationSeconds, 3, {
            max: 120,
            required: false,
            placeholder: String(state.store.rotationSeconds),
          }),
          'Deixe em branco para usar o intervalo da loja.'
        )
      ),
      orderedPicker({
        title: 'Listas exibidas',
        selected: listIds,
        available: state.lists,
        id: (list) => list.id,
        label: (list) => list.name,
      }),
      orderedPicker({
        title: 'Imagens do carrossel',
        selected: mediaIds,
        available: availableImages,
        id: (item) => item.id,
        label: (item) => item.name,
      }),
    ]
  );
}

function productsPage() {
  return [
    heading(
      'Produtos',
      'Consulte o catálogo ou cadastre um produto manualmente.',
      button('Novo produto', () => editProduct(), 'primary')
    ),
    panel(
      'Catálogo',
      state.catalog.length
        ? searchResults({
            items: state.catalog,
            label: 'Buscar por nome ou código',
            terms: (item) => `${item.code} ${item.name}`,
            emptyText: 'Nenhum produto encontrado.',
            draw: (items) =>
              table(
                'Catálogo de produtos',
                ['Código', 'Nome', 'Preço', 'Promoção', 'Origem', 'Ações'],
                items.map((item) => [
                  el('span', { class: 'code' }, item.code),
                  item.name,
                  money(item.price),
                  money(item.promo),
                  el('span', { class: 'tag' }, item.manual ? 'Manual' : 'Arquivo'),
                  actions(
                    button('Editar', () => editProduct(item), 'secondary small'),
                    button(
                      item.imageId ? 'Alterar foto' : 'Foto',
                      () => editProductImage(item),
                      'secondary small',
                      { 'aria-label': `Foto de ${item.name}` }
                    ),
                    item.manual &&
                      confirmAction(
                        'Excluir',
                        'delete-product',
                        { code: item.code },
                        `Excluir o cadastro manual de “${item.name}”?`,
                        'Cadastro manual excluído.'
                      )
                  ),
                ])
              ),
          })
        : empty('Nenhum produto cadastrado. Importe um arquivo de preços ou adicione um produto.')
    ),
  ];
}

function editProduct(product) {
  editor(
    product ? 'Editar produto' : 'Novo produto',
    'Salvar produto',
    (box) =>
      saveEditor(
        box,
        'save-product',
        (data) => {
          const promo = str(data, 'promo');
          const code = str(data, 'code')
            .toUpperCase()
            .replace(/^0+(?=\d+$)/, '');
          if (!product && state.catalog.some((item) => item.code === code)) {
            throw new Error('Esse código já existe no catálogo. Abra o produto para editar.');
          }
          return {
            code,
            name: str(data, 'name'),
            price: parsePrice(str(data, 'price'), 'o preço'),
            promo: promo ? parsePrice(promo, 'o preço promocional') : null,
          };
        },
        'Produto salvo.'
      ),
    () => [
      field(
        'Código',
        input('code', {
          required: true,
          value: product?.code,
          readonly: Boolean(product),
          autofocus: !product,
          maxlength: 24,
        })
      ),
      field(
        'Nome do produto',
        input('name', { required: true, value: product?.name, autofocus: !!product })
      ),
      el(
        'div',
        { class: 'form-grid' },
        field(
          'Preço (R$)',
          input('price', {
            required: true,
            inputmode: 'decimal',
            placeholder: '0,00',
            value: priceInput(product?.price),
          })
        ),
        field(
          'Preço promocional (R$)',
          input('promo', {
            inputmode: 'decimal',
            placeholder: 'Opcional',
            value: priceInput(product?.promo),
          })
        )
      ),
      product &&
        !product.manual &&
        el('p', { class: 'hint' }, 'Ao salvar, o produto passa a ter cadastro manual.'),
    ]
  );
}

function editProductImage(product) {
  const gallery = images();
  editor(
    `Foto de ${product.name}`,
    'Salvar foto',
    (box) =>
      saveEditor(
        box,
        'set-product-image',
        (data) => ({
          code: product.code,
          imageId: str(data, 'imageId') || null,
        }),
        'Foto do produto atualizada.'
      ),
    () => {
      const choose = select(
        'imageId',
        [['', 'Sem foto'], ...gallery.map((item) => [item.id, item.name])],
        product.imageId ?? ''
      );
      const preview = el('div', { class: 'image-preview photo-preview' });
      function showPhoto() {
        const item = gallery.find((image) => image.id === choose.value);
        const url = item && localImageUrl(item.url);
        preview.replaceChildren(
          url ? el('img', { src: url, alt: item.name }) : el('span', {}, 'Sem prévia')
        );
      }
      choose.addEventListener('change', showPhoto);
      showPhoto();
      return [
        field(
          'Imagem cadastrada',
          choose,
          !gallery.length && 'Envie uma imagem na seção Imagens para selecioná-la aqui.'
        ),
        preview,
      ];
    }
  );
}

function importPage() {
  if (!state.store.manualImport) {
    return [
      heading('Importação', 'Envie um arquivo de preços para atualizar o catálogo.'),
      panel('Importação manual', [
        empty('O envio manual está desativado para esta loja.'),
        link('Abrir configurações', routeUrl('configuracoes'), 'primary'),
      ]),
    ];
  }
  const draftArea = el('div', { class: 'stack' });
  const file = input('file', { type: 'file', accept: '.txt,text/plain', required: !importDraft });
  const preview = form(
    'Gerar prévia',
    async (data) => {
      const picked = data.get('file');
      const selected = picked?.name ? picked : importDraft?.file;
      if (!selected) throw new Error('Selecione o arquivo de preços.');
      const body = new FormData();
      body.append('file', selected);
      file.disabled = true;
      try {
        const result = await request('/api/import/preview', body);
        importDraft = { file: selected, result };
        refreshDraft();
        showNotice(notice, 'Prévia gerada. Confira as alterações antes de salvar.');
      } finally {
        file.disabled = false;
      }
    },
    [field('Arquivo de preços', file, 'Arquivo de largura fixa no formato .txt.')]
  );

  function refreshDraft() {
    const draft = importDraft;
    draftArea.replaceChildren();
    file.required = !draft;
    if (!draft) return;
    draftArea.append(
      el('p', { class: 'hint' }, 'Arquivo selecionado: ', el('strong', {}, draft.file.name))
    );
    if (!draft.result) return;
    const result = draft.result;
    const missing = Array.isArray(result.missingFromLists)
      ? result.missingFromLists.length
      : result.missingFromLists;
    const commit = button(
      'Salvar importação',
      (event) => {
        run(event.currentTarget, notice, async () => {
          const body = new FormData();
          body.append('file', draft.file);
          body.append('ticket', result.ticket);
          file.disabled = true;
          try {
            const next = await request('/api/import', body);
            importDraft = null;
            update(next, 'Importação salva. O catálogo foi atualizado.');
          } finally {
            file.disabled = false;
          }
        });
      },
      'primary'
    );
    draftArea.append(
      panel('Prévia da importação', [
        el('p', { class: 'preview-name' }, result.name),
        importSummary(result),
        Number(missing) > 0 &&
          el(
            'p',
            { class: 'warning' },
            Number(missing) === 1
              ? '1 produto vinculado a listas ficará indisponível após a importação.'
              : `${missing} produtos vinculados a listas ficarão indisponíveis após a importação.`
          ),
        result.sample.length
          ? table(
              'Amostra do arquivo',
              ['Código', 'Produto', 'Preço', 'Promoção'],
              result.sample.map((item) => [
                item.code,
                item.name,
                money(item.price),
                money(item.promo),
              ])
            )
          : empty('O arquivo não tem produtos para mostrar na amostra.'),
        actions(
          commit,
          button(
            'Descartar prévia',
            () => {
              if (busy) return;
              importDraft = null;
              file.value = '';
              refreshDraft();
              showNotice(notice, 'Prévia descartada.');
              file.focus();
            },
            'secondary'
          )
        ),
      ])
    );
  }

  file.addEventListener('change', () => {
    importDraft = file.files[0] ? { file: file.files[0] } : null;
    refreshDraft();
    showNotice(notice, '');
  });
  refreshDraft();
  return [
    heading(
      'Importação',
      'Analise o arquivo de preços e revise o impacto antes de atualizar o catálogo.',
      actions(
        link('Parâmetros do arquivo', routeUrl('parametros'), 'secondary small'),
        link('Histórico', routeUrl('historico'), 'secondary small')
      )
    ),
    panel('Importação manual', preview),
    draftArea,
  ];
}

function importSummary(record) {
  return el(
    'dl',
    { class: 'summary-grid' },
    [
      ['Produtos no arquivo', record.count],
      ['Adicionados', record.added],
      ['Alterados', record.changed],
      ['Removidos', record.removed],
    ].map(([label, value]) => el('div', {}, el('dt', {}, label), el('dd', {}, value)))
  );
}

function historyPage() {
  return [
    heading(
      'Histórico de importações',
      'Consulte os arquivos importados e restaure um catálogo anterior.'
    ),
    panel(
      'Arquivos importados',
      state.imports.length
        ? table(
            'Histórico de importações',
            ['Arquivo', 'Data', 'Produtos', 'Adicionados', 'Alterados', 'Removidos', 'Ações'],
            [...state.imports]
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map((item) => [
                item.name,
                dateLabel(item.date),
                item.count,
                item.added,
                item.changed,
                item.removed,
                confirmAction(
                  'Restaurar',
                  'restore-import',
                  { id: item.id },
                  `Restaurar o catálogo do arquivo “${item.name}”, de ${dateLabel(item.date)}?`,
                  'Importação restaurada.',
                  'secondary'
                ),
              ])
          )
        : empty('Nenhuma importação registrada.'),
      link('Importar arquivo', routeUrl('importacao'), 'secondary small')
    ),
  ];
}

function localImageUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const url = new URL(raw, location.origin);
    if (url.origin === location.origin && ['http:', 'https:'].includes(url.protocol))
      return url.href;
  } catch {
    return null;
  }
  return null;
}

function imageScreens(ids = []) {
  return el(
    'fieldset',
    { class: 'parameter-fields' },
    el('legend', {}, 'Telas do carrossel'),
    state.screens.length
      ? el(
          'div',
          { class: 'check-grid' },
          state.screens.map((screen) =>
            el(
              'label',
              { class: 'check' },
              input('screenIds', {
                type: 'checkbox',
                value: screen.id,
                checked: ids.includes(screen.id),
              }),
              el('span', {}, screen.name)
            )
          )
        )
      : empty('Cadastre uma tela para vincular esta imagem.')
  );
}

function assignedScreens(item) {
  return state.screens
    .filter((screen) => screen.mediaIds.includes(item.id))
    .map((screen) => screen.id);
}

function editImageScreens(item) {
  editor(
    `Telas de ${item.name}`,
    'Salvar telas',
    (box) =>
      saveEditor(
        box,
        'set-media-screens',
        (data) => ({
          id: item.id,
          screenIds: data.getAll('screenIds'),
        }),
        'Telas da imagem atualizadas.'
      ),
    () => [imageScreens(assignedScreens(item))]
  );
}

function imagesPage() {
  const upload = form(
    'Enviar imagem',
    async (data) => {
      const file = data.get('file');
      if (!/\.(?:png|jpe?g|webp)$/i.test(file?.name ?? '')) {
        throw new Error('Selecione uma imagem PNG, JPG ou WebP.');
      }
      const body = new FormData();
      body.append('name', str(data, 'name'));
      body.append('file', file);
      for (const id of data.getAll('screenIds')) body.append('screenIds', id);
      update(await request('/api/media', body), 'Imagem enviada.');
    },
    [
      el(
        'div',
        { class: 'form-grid' },
        field('Nome da imagem', input('name', { required: true })),
        field(
          'Arquivo de imagem',
          input('file', {
            type: 'file',
            required: true,
            accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp',
          }),
          'PNG, JPG ou WebP.'
        )
      ),
      imageScreens(),
    ]
  );
  const gallery = images();
  return [
    heading('Imagens', 'Envie imagens para usar no carrossel das telas.'),
    panel('Nova imagem', upload),
    panel(
      'Imagens cadastradas',
      gallery.length
        ? el(
            'ul',
            { class: 'image-grid' },
            gallery.map((item) => {
              const url = localImageUrl(item.url);
              const active = item.active !== false;
              const screenCount = assignedScreens(item).length;
              return el(
                'li',
                { class: 'image-card' },
                el(
                  'div',
                  { class: 'image-preview' },
                  url
                    ? el('img', { src: url, alt: '', loading: 'lazy' })
                    : el('span', {}, 'Prévia indisponível')
                ),
                el(
                  'div',
                  { class: 'image-info' },
                  el('h3', {}, item.name),
                  el(
                    'p',
                    { class: 'image-meta' },
                    el(
                      'span',
                      { class: `tag${active ? ' active' : ''}` },
                      active ? 'Ativa' : 'Inativa'
                    ),
                    formatCount(screenCount, 'tela vinculada', 'telas vinculadas')
                  ),
                  actions(
                    button('Vincular telas', () => editImageScreens(item), 'secondary small', {
                      disabled: !state.screens.length,
                    }),
                    button(
                      active ? 'Desativar' : 'Ativar',
                      (event) =>
                        action(
                          event.currentTarget,
                          'set-media-active',
                          { id: item.id, active: !active },
                          active ? 'Imagem desativada.' : 'Imagem ativada.'
                        ),
                      'secondary small'
                    ),
                    confirmAction(
                      'Excluir',
                      'delete-media',
                      { id: item.id },
                      `Excluir a imagem “${item.name}”? Ela será removida dos locais onde está vinculada.`,
                      'Imagem excluída.'
                    )
                  )
                )
              );
            })
          )
        : empty('Nenhuma imagem cadastrada.')
    ),
  ];
}

function settingsPage() {
  const store = state.store;
  return [
    heading('Configurações', 'Defina as informações da loja e os intervalos usados nas telas.'),
    panel(
      'Dados da loja',
      form(
        'Salvar configurações',
        async (data) => {
          const next = await request('/api/action', {
            action: 'save-settings',
            name: str(data, 'name'),
            displayName: str(data, 'displayName'),
            city: str(data, 'city'),
            state: str(data, 'state'),
            website: str(data, 'website'),
            text: str(data, 'text'),
            message: str(data, 'message'),
            rotationSeconds: Number(data.get('rotationSeconds')),
            refreshSeconds: Number(data.get('refreshSeconds')),
            manualImport: data.has('manualImport'),
          });
          update(next, 'Configurações salvas.');
        },
        [
          el(
            'div',
            { class: 'form-grid' },
            field(
              'Nome da loja',
              input('name', {
                value: store.name,
                required: true,
                autocomplete: 'organization',
                maxlength: 100,
              })
            ),
            field(
              'Nome exibido na TV',
              input('displayName', { value: store.displayName, maxlength: 100 })
            ),
            field(
              'Cidade',
              input('city', { value: store.city, autocomplete: 'address-level2', maxlength: 100 })
            ),
            field(
              'Estado',
              input('state', { value: store.state, autocomplete: 'address-level1', maxlength: 40 })
            ),
            field(
              'Site',
              input('website', {
                value: store.website,
                inputmode: 'url',
                autocomplete: 'url',
                maxlength: 200,
              })
            )
          ),
          field('Texto adicional da loja', input('text', { value: store.text, maxlength: 150 })),
          field(
            'Mensagem nas telas',
            el('textarea', { name: 'message', rows: 3, maxlength: 350 }, store.message)
          ),
          el(
            'div',
            { class: 'form-grid' },
            field(
              'Rotação das páginas (segundos)',
              numeric('rotationSeconds', store.rotationSeconds, 3, { max: 120 })
            ),
            field(
              'Atualização dos dados (segundos)',
              numeric('refreshSeconds', store.refreshSeconds, 5, { max: 3600 })
            )
          ),
          check('manualImport', 'Importação manual', store.manualImport),
        ]
      )
    ),
    panel(
      'Aparência por tela',
      state.screens.length
        ? table(
            'Aparência por tela',
            ['Tela', 'Ações'],
            state.screens.map((screen) => [screen.name, appearanceButton(screen, 'Configurar')])
          )
        : empty('Cadastre uma tela para configurar sua aparência.'),
      link('Gerenciar telas', routeUrl('telas'), 'secondary small')
    ),
  ];
}

function parametersPage() {
  const { parameters } = state;
  const promoFields = el(
    'fieldset',
    { class: 'parameter-fields', disabled: !parameters.promo },
    el('legend', {}, 'Preço promocional'),
    parameterFields('promo', parameters.promo)
  );
  const promoToggle = check(
    'hasPromo',
    'O arquivo inclui preço promocional',
    Boolean(parameters.promo)
  );
  promoToggle.addEventListener('change', (event) => {
    promoFields.disabled = !event.target.checked;
  });

  function read(data, key) {
    return { start: Number(data.get(`${key}Start`)), length: Number(data.get(`${key}Length`)) };
  }

  return [
    heading(
      'Parâmetros do arquivo',
      'Indique a posição inicial e o tamanho de cada campo no arquivo de largura fixa.'
    ),
    panel(
      'Formato do arquivo',
      form(
        'Salvar parâmetros',
        async (data) => {
          const next = await request('/api/action', {
            action: 'save-parameters',
            parameters: {
              code: read(data, 'code'),
              name: read(data, 'name'),
              price: read(data, 'price'),
              promo: data.has('hasPromo') ? read(data, 'promo') : null,
              encoding: str(data, 'encoding'),
            },
          });
          update(next, 'Parâmetros salvos.');
        },
        [
          el(
            'p',
            { class: 'hint' },
            'A primeira posição da linha é 0. O tamanho é a quantidade de caracteres.'
          ),
          el(
            'fieldset',
            { class: 'parameter-fields' },
            el('legend', {}, 'Código'),
            parameterFields('code', parameters.code)
          ),
          el(
            'fieldset',
            { class: 'parameter-fields' },
            el('legend', {}, 'Nome do produto'),
            parameterFields('name', parameters.name)
          ),
          el(
            'fieldset',
            { class: 'parameter-fields' },
            el('legend', {}, 'Preço'),
            parameterFields('price', parameters.price)
          ),
          promoToggle,
          promoFields,
          field(
            'Codificação',
            select(
              'encoding',
              [
                ['auto', 'Detectar automaticamente'],
                ['utf8', 'UTF-8'],
                ['windows1252', 'Windows-1252'],
              ],
              parameters.encoding
            )
          ),
        ],
        { extra: [link('Ir para importação', routeUrl('importacao'), 'secondary')] }
      )
    ),
  ];
}

function parameterFields(key, value) {
  const limits = { code: 24, name: 160, price: 9, promo: 9 };
  return el(
    'div',
    { class: 'form-grid' },
    field('Posição inicial', numeric(`${key}Start`, value?.start, 0, { max: 512 })),
    field('Tamanho', numeric(`${key}Length`, value?.length, 1, { max: limits[key] }))
  );
}

function accessPage() {
  const owner = state.user.role === 'owner';
  return [
    heading(
      'Lojas e acessos',
      owner ? 'Gerencie as lojas e os acessos dos operadores.' : 'Consulte o acesso da sua conta.'
    ),
    panel(
      'Minha conta',
      form(
        'Salvar perfil',
        async (data) => {
          const next = await request('/api/action', {
            action: 'update-profile',
            name: str(data, 'name'),
            email: str(data, 'email'),
          });
          update(next, 'Perfil atualizado.');
        },
        [
          el(
            'div',
            { class: 'form-grid' },
            field(
              'Seu nome',
              input('name', {
                value: state.user.name,
                required: true,
                autocomplete: 'name',
                maxlength: 100,
              })
            ),
            field(
              'E-mail',
              input('email', {
                value: state.user.email,
                type: 'email',
                required: true,
                autocomplete: 'email',
              })
            )
          ),
          el(
            'p',
            { class: 'hint' },
            'Perfil: ',
            state.user.role === 'owner' ? 'Responsável' : 'Operador'
          ),
        ],
        {
          extra: [link('Alterar senha', routeUrl('senha'), 'secondary')],
        }
      )
    ),
    !owner && panel('Loja vinculada', el('p', {}, state.store.name)),
    owner &&
      panel(
        'Lojas disponíveis',
        table(
          'Lojas disponíveis',
          ['Loja', 'Situação', 'Ações'],
          state.stores.map((store) => [
            store.name,
            store.id === state.store.id ? el('span', { class: 'tag' }, 'Ativa') : 'Disponível',
            store.id === state.store.id
              ? '—'
              : button(
                  'Usar esta loja',
                  (event) =>
                    action(event.currentTarget, 'switch-store', { id: store.id }, 'Loja alterada.'),
                  'secondary small'
                ),
          ])
        ),
        button('Nova loja', () => editStore(), 'primary small')
      ),
    owner &&
      panel(
        'Contas de acesso',
        state.users.length
          ? table(
              'Contas de acesso',
              ['Nome', 'E-mail', 'Perfil', 'Loja'],
              state.users.map((user) => [
                user.name,
                user.email,
                user.role === 'owner' ? 'Responsável' : 'Operador',
                state.stores.find((store) => store.id === user.storeId)?.name ?? '—',
              ])
            )
          : empty('Nenhuma conta de acesso para exibir.'),
        button('Novo operador', () => editUser(), 'primary small')
      ),
  ];
}

function editStore() {
  editor(
    'Nova loja',
    'Criar loja',
    (box) => saveEditor(box, 'add-store', (data) => ({ name: str(data, 'name') }), 'Loja criada.'),
    () => [field('Nome da loja', input('name', { required: true, autofocus: true }))]
  );
}

function editUser() {
  editor(
    'Novo operador',
    'Criar acesso',
    (box) =>
      saveEditor(
        box,
        'add-user',
        (data) => ({
          name: str(data, 'name'),
          email: str(data, 'email'),
          password: data.get('password'),
          storeId: str(data, 'storeId'),
        }),
        'Acesso criado.'
      ),
    () => [
      field('Nome', input('name', { required: true, autocomplete: 'name', autofocus: true })),
      field('E-mail', input('email', { type: 'email', required: true, autocomplete: 'email' })),
      field(
        'Senha inicial',
        input('password', {
          type: 'password',
          required: true,
          minlength: 10,
          maxlength: 128,
          autocomplete: 'new-password',
        }),
        'Use entre 10 e 128 caracteres.'
      ),
      field(
        'Loja do operador',
        select(
          'storeId',
          state.stores.map((store) => [store.id, store.name]),
          state.store.id
        )
      ),
    ]
  );
}

function passwordPage() {
  return [
    heading('Alterar senha', 'Atualize a senha de acesso à sua conta.'),
    panel(
      'Senha de acesso',
      form(
        'Salvar nova senha',
        async (data) => {
          const password = data.get('password');
          if (password !== data.get('confirmPassword'))
            throw new Error('A confirmação precisa ser igual à nova senha.');
          const next = await request('/api/action', {
            action: 'change-password',
            currentPassword: data.get('currentPassword'),
            password,
          });
          update(next, 'Senha alterada.');
        },
        [
          field(
            'Senha atual',
            input('currentPassword', {
              type: 'password',
              required: true,
              autocomplete: 'current-password',
            })
          ),
          field(
            'Nova senha',
            input('password', {
              type: 'password',
              required: true,
              minlength: 10,
              maxlength: 128,
              autocomplete: 'new-password',
            }),
            'Use entre 10 e 128 caracteres.'
          ),
          field(
            'Confirme a nova senha',
            input('confirmPassword', {
              type: 'password',
              required: true,
              minlength: 10,
              maxlength: 128,
              autocomplete: 'new-password',
            })
          ),
        ]
      )
    ),
  ];
}

window.addEventListener('pagehide', () => {
  if (!session?.user) return;
  // Remove protected markup before a back/forward cache snapshot.
  sessionGeneration++;
  state = null;
  session = null;
  importDraft = null;
  for (const dialog of document.querySelectorAll('dialog')) dialog.remove();
  app.replaceChildren();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
discardLegacyTVCache();
start();
