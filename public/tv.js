(function () {
  'use strict';

  var clock = document.getElementById('clock');
  var date = document.getElementById('date');
  var masthead = document.getElementById('masthead');
  var storeName = document.getElementById('store-name');
  var storeCity = document.getElementById('store-city');
  var connection = document.getElementById('connection');
  var connectionText = document.getElementById('connection-text');
  var groupTitle = document.getElementById('group');
  var prices = document.getElementById('prices');
  var notice = document.getElementById('board-notice');
  var noticeTitle = document.getElementById('notice-title');
  var noticeDetail = document.getElementById('notice-detail');
  var display = document.getElementById('display');
  var board = document.getElementById('board');
  var media = document.getElementById('media');
  var mediaFrame = document.getElementById('media-frame');
  var slideBackground = document.getElementById('slide-background');
  var tickerBar = document.getElementById('ticker');
  var tickerWindow = document.getElementById('ticker-window');
  var tickerTrack = document.getElementById('ticker-track');
  var ticker = document.getElementById('ticker-message');
  var tickerRepeat = document.getElementById('ticker-repeat');
  var tickerToggle = document.getElementById('ticker-toggle');
  var pageCounter = document.getElementById('page-counter');
  var diagnostics = document.getElementById('diagnostics');
  var diagnosticData = document.getElementById('diagnostic-data');
  var diagnosticEnabled = /(?:^\?|&)diagnostico=1(?:&|$)/.test(window.location.search);
  var wakeSupported = !!(navigator.wakeLock && navigator.wakeLock.request);
  var token = screenToken();
  var offlineLimit = 90000;
  var offlineTimer;
  var data = null;
  var pages = [];
  var images = [];
  var pageIndex = 0;
  var imageIndex = 0;
  var imageKey = '';
  var pendingImage = null;
  var rows = 8;
  var appearance = {};
  var slider = 0;
  var tickerPaused = false;
  var rotationDelay = 8000;
  var refreshDelay = 30000;
  var pollTimer;
  var rotationTimer;
  var request = null;
  var failures = 0;
  var revoked = false;
  var lastSuccess = null;
  var pageActive = true;
  var wakeLock = null;
  var wakePending = false;
  var defaultMessage = 'Confira os preços da loja.';

  function screenToken() {
    var match = /^\/(?:tv|telas)\/([^/]+)\/?$/.exec(window.location.pathname);
    try {
      return match ? encodeURIComponent(decodeURIComponent(match[1])) : '';
    } catch (error) {
      return '';
    }
  }

  function pad(number) {
    return number < 10 ? '0' + number : String(number);
  }

  function localTime(value) {
    return pad(value.getHours()) + ':' + pad(value.getMinutes());
  }

  function localDate(value) {
    return pad(value.getDate()) + '/' + pad(value.getMonth() + 1) + '/' + value.getFullYear();
  }

  function tickClock() {
    var now = new Date();
    clock.textContent = localTime(now);
    clock.setAttribute('datetime', localTime(now));
    date.textContent = localDate(now);
    date.setAttribute(
      'datetime',
      now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
    );
  }

  function updateDiagnostics() {
    if (!diagnosticEnabled) {
      return;
    }
    var link = navigator.connection;
    var linkType = link && (link.effectiveType || link.type);
    var updated = data && data.updatedAt ? new Date(data.updatedAt) : null;
    var secure = window.isSecureContext;
    var wakeState = wakeLock && !wakeLock.released ? 'ativo' : 'inativo';
    diagnosticData.textContent = [
      'Wake Lock: ' + (wakeSupported ? 'suportado, ' + wakeState : 'indisponível'),
      'Contexto seguro: ' +
        (typeof secure === 'boolean' ? (secure ? 'sim' : 'não') : 'não informado'),
      'Conexão: ' + connectionText.textContent + (linkType ? ' (' + linkType + ')' : ''),
      'Última atualização: ' +
        (updated && !isNaN(updated.getTime())
          ? localDate(updated) + ' ' + localTime(updated)
          : '—'),
      'Última consulta bem-sucedida: ' +
        (lastSuccess ? localDate(lastSuccess) + ' ' + localTime(lastSuccess) : '—'),
      'Navegador: ' + navigator.userAgent
    ].join('\n');
  }

  function setConnection(state, text) {
    connection.setAttribute('data-state', state);
    if (connectionText.textContent !== text) {
      connectionText.textContent = text;
    }
    updateDiagnostics();
  }

  function showNotice(title, detail) {
    prices.hidden = true;
    noticeTitle.textContent = title;
    noticeDetail.textContent = detail;
    notice.hidden = false;
    pageCounter.hidden = true;
  }

  function isInteger(number) {
    return typeof number === 'number' && isFinite(number) && Math.floor(number) === number;
  }

  function validPayload(value) {
    return (
      value &&
      (typeof value.version === 'string' || typeof value.version === 'number') &&
      value.store &&
      typeof value.store.name === 'string' &&
      value.screen &&
      typeof value.screen.name === 'string' &&
      Array.isArray(value.media) &&
      Array.isArray(value.groups) &&
      value.groups.every(function (group) {
        return (
          group &&
          typeof group.name === 'string' &&
          Array.isArray(group.products) &&
          group.products.every(function (product) {
            return (
              product &&
              typeof product.name === 'string' &&
              isInteger(product.price) &&
              (product.promo === null || isInteger(product.promo))
            );
          })
        );
      })
    );
  }

  function removeLegacyPrices() {
    try {
      var storage = window.localStorage;
      for (var i = storage.length - 1; i >= 0; i -= 1) {
        var key = storage.key(i);
        if (key && key.indexOf('arapongas.tv.') === 0) storage.removeItem(key);
      }
    } catch (error) {
      // Older TVs may disable Web Storage.
    }
  }

  function delay(seconds, fallback) {
    return typeof seconds === 'number' && isFinite(seconds) && seconds > 0
      ? Math.min(seconds * 1000, 2147483647)
      : fallback;
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (typeof text === 'string') {
      node.textContent = text;
    }
    return node;
  }

  function priceText(cents) {
    var absolute = Math.abs(cents);
    var whole = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (cents < 0 ? '−' : '') + whole + ',' + pad(absolute % 100);
  }

  function color(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '';
  }

  function positive(number, fallback) {
    return isInteger(number) && number > 0 ? number : fallback;
  }

  function displayName(name) {
    var limit = positive(appearance.nameLimit, 50);
    return name.length > limit
      ? name.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '') + '…'
      : name;
  }

  function placePhoto(image, frame) {
    var x =
      appearance.photoX === 'left' ? 'left' : appearance.photoX === 'right' ? 'right' : 'center';
    var y =
      appearance.photoY === 'top' ? 'top' : appearance.photoY === 'bottom' ? 'bottom' : 'center';
    frame.style.justifyContent =
      x === 'left' ? 'flex-start' : x === 'right' ? 'flex-end' : 'center';
    frame.style.alignItems = y === 'top' ? 'flex-start' : y === 'bottom' ? 'flex-end' : 'center';
    // Store photos fill the portrait column; product cards retain their own sizing.
    image.style.width =
      (frame === mediaFrame ? 100 : Math.min(positive(appearance.photoWidth, 100), 100)) + '%';
    image.style.height =
      (frame === mediaFrame ? 100 : Math.min(positive(appearance.photoHeight, 100), 100)) + '%';
    image.style.objectPosition = x + ' ' + y;
  }

  function productRow(product, index) {
    var row = element('li', 'price-row');
    var info = element('div', 'product-info');
    var name = element('span', 'product-name', displayName(product.name));
    var amount = element('div', 'product-price');
    var active = element('span', 'price-current');
    var promo = product.promo !== null && product.promo < product.price;
    var photoUrl = slider && appearance.showImages !== false ? localImageUrl(product.imageUrl) : '';
    row.style.backgroundColor = color(index % 2 ? appearance.evenColor : appearance.oddColor);
    row.style.outlineColor = color(appearance.borderColor);
    name.title = product.name;
    name.setAttribute('aria-label', product.name);
    name.style.color = color(appearance.nameColor);
    amount.style.color = color(appearance.priceColor);
    active.style.color = color(promo ? appearance.promoColor : appearance.priceColor);
    if (photoUrl) {
      var frame = element('div', 'card-media');
      var photo = element('img');
      photo.alt = '';
      photo.onerror = function () {
        frame.hidden = true;
        sizeRows();
      };
      placePhoto(photo, frame);
      photo.src = photoUrl;
      frame.appendChild(photo);
      row.appendChild(frame);
    }
    info.appendChild(name);
    info.appendChild(amount);
    row.appendChild(info);
    if (promo) {
      var before = element('span', 'price-before');
      amount.className += ' price-promo';
      before.appendChild(element('span', 'promo-tag', 'OFERTA'));
      if (appearance.hideOldPrice !== true) {
        before.appendChild(element('del', '', 'R$ ' + priceText(product.price)));
      }
      amount.appendChild(before);
    }
    active.appendChild(element('span', 'currency', 'R$ '));
    active.appendChild(document.createTextNode(priceText(promo ? product.promo : product.price)));
    amount.appendChild(active);
    return row;
  }

  function fittedFont(configured, limit) {
    var pixels =
      isInteger(configured) && configured > 0 ? (configured * window.innerWidth) / 1920 : limit;
    return Math.max(1, Math.min(pixels, limit));
  }

  function sizeRows() {
    if (prices.hidden) {
      return;
    }
    var rowNodes = prices.children;
    var rowCount = rowNodes.length;
    var tableWidth = prices.clientWidth;
    var i;
    // Set all heights before measuring, avoiding one forced layout per row.
    if (!slider) {
      for (i = 0; i < rowCount; i += 1) {
        rowNodes[i].style.height = 100 / rowCount + '%';
      }
    }
    for (i = 0; i < rowCount; i += 1) {
      var row = rowNodes[i];
      var name = row.querySelector('.product-name');
      var amount = row.querySelector('.product-price');
      var promo = amount.className.indexOf('price-promo') !== -1;
      var nameLimit = slider
        ? Math.min(row.clientWidth * 0.095, row.clientHeight * 0.19)
        : Math.min(tableWidth * 0.053, row.clientHeight * 0.62);
      var priceLimit = slider
        ? Math.min(row.clientWidth * 0.16, row.clientHeight * (promo ? 0.22 : 0.28))
        : row.clientHeight * (promo ? 0.6 : 0.79);
      var fontSize = fittedFont(appearance.nameSize, nameLimit);
      name.style.fontSize = fontSize + 'px';
      amount.style.fontSize =
        fittedFont(promo ? appearance.promoSize : appearance.priceSize, priceLimit) + 'px';
      // Reserve space for product names even with a large four-digit price.
      var priceWidth = row.clientWidth * (slider ? 0.85 : 0.38);
      if (amount.scrollWidth > priceWidth) {
        var amountSize = parseFloat(amount.style.fontSize);
        amount.style.fontSize = Math.floor((amountSize * priceWidth) / amount.scrollWidth) + 'px';
      }
      if (!slider && name.clientWidth && name.scrollWidth > name.clientWidth) {
        var fitted = Math.max(fontSize * 0.72, (fontSize * name.clientWidth) / name.scrollWidth);
        name.style.fontSize = Math.floor(fitted) + 'px';
      }
    }
  }

  function showPage() {
    var page = pages[pageIndex];
    if (!page) {
      groupTitle.textContent = data.screen.name || 'Tabela de preços';
      showNotice(
        'Nenhum produto para exibir',
        'Os produtos cadastrados para esta tela aparecem aqui.'
      );
      return;
    }
    var content = document.createDocumentFragment();
    page.products.forEach(function (product, index) {
      content.appendChild(productRow(product, index));
    });
    groupTitle.textContent = page.name;
    prices.textContent = '';
    prices.appendChild(content);
    notice.hidden = true;
    prices.hidden = false;
    pageCounter.textContent = pageIndex + 1 + ' / ' + pages.length;
    pageCounter.setAttribute('aria-label', 'Página ' + (pageIndex + 1) + ' de ' + pages.length);
    pageCounter.hidden = !diagnosticEnabled || pages.length <= 1;
    sizeRows();
    sizeTicker();
  }

  function localImageUrl(value) {
    if (typeof value !== 'string' || !value) {
      return '';
    }
    var link = document.createElement('a');
    link.href = value;
    if (
      (link.protocol === 'http:' || link.protocol === 'https:') &&
      link.protocol === window.location.protocol &&
      link.host === window.location.host
    ) {
      return link.href;
    }
    return '';
  }

  function clearImage() {
    pendingImage = null;
    imageKey = '';
    mediaFrame.hidden = true;
    mediaFrame.textContent = '';
  }

  function showImage() {
    var item = images[imageIndex];
    if (!item) {
      clearImage();
      return;
    }
    var nextKey = item.id + '|' + item.url + '|' + item.name;
    if (nextKey === imageKey) {
      placePhoto(pendingImage || mediaFrame.firstChild, mediaFrame);
      return;
    }
    imageKey = nextKey;
    var image = new Image();
    pendingImage = image;
    image.alt = item.name;
    placePhoto(image, mediaFrame);
    image.onload = function () {
      if (pendingImage === image) {
        mediaFrame.textContent = '';
        mediaFrame.appendChild(image);
        mediaFrame.hidden = false;
        pendingImage = null;
      }
    };
    image.onerror = function () {
      if (pendingImage === image) {
        clearImage();
      }
    };
    image.src = item.url;
  }

  function scheduleRotation() {
    window.clearTimeout(rotationTimer);
    if (pages.length <= 1 && images.length <= 1) {
      return;
    }
    rotationTimer = window.setTimeout(function () {
      if (pages.length > 1) {
        pageIndex = (pageIndex + 1) % pages.length;
        showPage();
      }
      if (images.length > 1) {
        imageIndex = (imageIndex + 1) % images.length;
        showImage();
      }
      scheduleRotation();
    }, rotationDelay);
  }

  function sizeTicker() {
    if (tickerBar.hidden || !tickerWindow.clientWidth) {
      return;
    }
    ticker.style.width = 'auto';
    var slot = Math.max(tickerWindow.clientWidth, ticker.scrollWidth + 40);
    ticker.style.width = slot + 'px';
    tickerRepeat.style.width = slot + 'px';
    tickerTrack.style.width = 2 * slot + 'px';
  }

  function applyAppearance(value) {
    appearance = value || {};
    slider = [1, 2, 4].indexOf(appearance.slider) !== -1 ? appearance.slider : 0;
    // The store's image always occupies a full-height portrait column.
    display.className = 'display';
    media.hidden = appearance.showImages === false;
    board.style.flexGrow = '';
    media.style.flexGrow = '';
    masthead.hidden = appearance.showHeader === false;
    tickerBar.hidden = appearance.showTicker === false;
    tickerBar.style.backgroundColor = color(appearance.tickerBg);
    tickerBar.style.color = color(appearance.tickerColor);
    tickerTrack.style.animationDuration = positive(appearance.tickerSeconds, 30) + 's';
    prices.className = slider
      ? 'prices slider-grid slider-' + slider + (appearance.border === true ? ' slide-border' : '')
      : 'prices';

    var backgroundUrl = slider ? localImageUrl(appearance.slideBackgroundUrl) : '';
    slideBackground.hidden = !backgroundUrl;
    if (backgroundUrl) {
      if (slideBackground.getAttribute('src') !== backgroundUrl) {
        slideBackground.src = backgroundUrl;
      }
    } else {
      slideBackground.removeAttribute('src');
    }
  }

  function setTicker(message) {
    ticker.textContent = message;
    tickerRepeat.textContent = message;
    tickerWindow.title = message;
    tickerBar.className = 'ticker ticker-moving' + (tickerPaused ? ' ticker-paused' : '');
    sizeTicker();
  }

  function showStoreLine(value) {
    var temperature = value.temperatureC;
    var parts = [value.store.city, value.store.text];
    if (typeof temperature === 'number' && isFinite(temperature)) {
      parts.splice(1, 0, String(temperature).replace('.', ',') + ' °C');
    }
    storeCity.textContent = parts
      .filter(function (part) {
        return typeof part === 'string' && part.trim();
      })
      .join(' · ');
  }

  function render(value) {
    data = value;
    applyAppearance(value.screen.appearance);
    rows = slider || positive(value.screen.rows, 8);
    rotationDelay = delay(value.screen.rotationSeconds, delay(value.store.rotationSeconds, 8000));
    // Check source health at least every 30 seconds, even if the display uses a longer refresh interval.
    refreshDelay = Math.min(delay(value.store.refreshSeconds, 30000), 30000);
    document.body.className = value.screen.theme === 'dark' ? 'theme-dark' : '';
    document.title = value.screen.name + ' | Tabela Digital Arapongas';
    storeName.textContent = value.store.name;
    showStoreLine(value);
    setTicker(
      typeof value.store.message === 'string' && value.store.message.trim()
        ? value.store.message
        : defaultMessage
    );

    pages = [];
    value.groups.forEach(function (group) {
      var offset;
      for (offset = 0; offset < group.products.length; offset += rows) {
        pages.push({ name: group.name, products: group.products.slice(offset, offset + rows) });
      }
    });
    images = [];
    if (!media.hidden) {
      value.media.forEach(function (item) {
        if (item && item.type === 'image' && item.mode === 'upload') {
          var url = localImageUrl(item.url);
          if (url) {
            images.push({ id: item.id, name: item.name || 'Imagem da loja', url: url });
          }
        }
      });
    }
    pageIndex = 0;
    imageIndex = 0;
    showPage();
    showImage();
    scheduleRotation();
  }

  function clearBoard() {
    window.clearTimeout(rotationTimer);
    window.clearTimeout(offlineTimer);
    data = null;
    lastSuccess = null;
    pages = [];
    images = [];
    releaseWakeLock();
    applyAppearance(null);
    prices.textContent = '';
    document.body.className = '';
    document.title = 'Tela indisponível | Tabela Digital Arapongas';
    storeName.textContent = 'Tabela de preços';
    storeCity.textContent = '';
    groupTitle.textContent = 'Tabela de preços';
    setTicker(defaultMessage);
    clearImage();
  }

  function showUnavailable() {
    revoked = true;
    clearBoard();
    showNotice('Tela indisponível', 'Peça o link atualizado desta tela ao responsável pela loja.');
    setConnection('unavailable', 'Indisponível');
  }

  function showOffline() {
    if (!data) {
      showNotice('Aguardando conexão', 'A tabela será carregada assim que a conexão voltar.');
    }
    setConnection('offline', 'Sem conexão');
  }

  function schedulePoll(milliseconds) {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(poll, milliseconds);
  }

  function poll() {
    window.clearTimeout(pollTimer);
    if (revoked || request || !token) {
      return;
    }
    var xhr = new XMLHttpRequest();
    request = xhr;

    function finish(status) {
      if (request !== xhr) {
        return;
      }
      request = null;
      if (status === 401 || status === 403) {
        showUnavailable();
        window.location.replace('/tv');
        return;
      }
      if (status === 404 || status === 410) {
        showUnavailable();
        return;
      }
      var value = null;
      if (status === 200) {
        try {
          value = JSON.parse(xhr.responseText);
        } catch (error) {
          // A broken response should leave the last prices visible.
        }
      }
      if (!validPayload(value)) {
        failures += 1;
        showOffline();
        schedulePoll(Math.min(30000, 2000 * Math.pow(2, Math.min(failures - 1, 4))));
        return;
      }
      if (!data || data.version !== value.version) {
        render(value);
      } else {
        if (data.temperatureC !== value.temperatureC) {
          data.temperatureC = value.temperatureC;
          showStoreLine(data);
        }
        if (failures && !imageKey && images.length) {
          showImage();
        }
      }
      failures = 0;
      lastSuccess = new Date();
      window.clearTimeout(offlineTimer);
      offlineTimer = window.setTimeout(function () {
        clearBoard();
        showOffline();
      }, offlineLimit);
      if (navigator.onLine === false) {
        showOffline();
      } else {
        if (value.priceSource && value.priceSource.state === 'error') {
          setConnection('offline', 'Preços sem atualização');
        } else if (value.priceSource && value.priceSource.state === 'override') {
          setConnection('offline', 'Catálogo restaurado manualmente');
        } else if (value.priceSource && value.priceSource.state === 'waiting') {
          setConnection('waiting', 'Verificando preços');
        } else {
          setConnection('live', 'Servidor conectado');
        }
      }
      acquireWakeLock();
      schedulePoll(refreshDelay);
    }

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        finish(xhr.status);
      }
    };
    xhr.onerror =
      xhr.ontimeout =
      xhr.onabort =
        function () {
          finish(0);
        };
    try {
      xhr.open('GET', '/api/tv/' + token, true);
      xhr.timeout = 12000;
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      xhr.send();
    } catch (error) {
      finish(0);
    }
  }

  function visible() {
    return pageActive && !document.hidden && !document.webkitHidden;
  }

  function releaseWakeLock() {
    if (wakeLock) {
      var lock = wakeLock;
      wakeLock = null;
      lock.release().then(updateDiagnostics, updateDiagnostics);
    }
  }

  function acquireWakeLock() {
    if (
      !wakeSupported ||
      revoked ||
      !visible() ||
      wakePending ||
      (wakeLock && !wakeLock.released)
    ) {
      return;
    }
    wakePending = true;
    navigator.wakeLock.request('screen').then(
      function (lock) {
        wakePending = false;
        wakeLock = lock;
        lock.addEventListener('release', function () {
          if (wakeLock === lock) {
            wakeLock = null;
          }
          updateDiagnostics();
        });
        if (revoked || !visible()) {
          releaseWakeLock();
        }
        updateDiagnostics();
      },
      function () {
        wakePending = false;
        updateDiagnostics();
      }
    );
  }

  function onVisibility() {
    if (visible()) {
      tickClock();
      poll();
      acquireWakeLock();
    } else {
      releaseWakeLock();
    }
  }

  diagnostics.hidden = !diagnosticEnabled;
  tickerToggle.hidden = !diagnosticEnabled;
  slideBackground.onerror = function () {
    slideBackground.hidden = true;
    slideBackground.removeAttribute('src');
  };
  tickerToggle.addEventListener('click', function () {
    tickerPaused = !tickerPaused;
    tickerBar.className = 'ticker ticker-moving' + (tickerPaused ? ' ticker-paused' : '');
    tickerToggle.setAttribute('aria-pressed', String(tickerPaused));
    tickerToggle.setAttribute('aria-label', tickerPaused ? 'Retomar mensagem' : 'Pausar mensagem');
    tickerToggle.textContent = tickerPaused ? '▶' : 'Ⅱ';
  });
  document.addEventListener('keydown', function (event) {
    if (event.keyCode === 27 || event.keyCode === 10009) {
      window.location.assign('/tv');
      event.preventDefault();
      return;
    }
    if (!data || revoked) return;
    if (event.keyCode === 37 || event.keyCode === 39) {
      if (pages.length > 1) {
        pageIndex = (pageIndex + (event.keyCode === 39 ? 1 : pages.length - 1)) % pages.length;
        showPage();
        scheduleRotation();
      }
      event.preventDefault();
    } else if (event.keyCode === 13 && document.activeElement !== tickerToggle) {
      tickerToggle.click();
      event.preventDefault();
    }
  });
  setTicker(defaultMessage);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      sizeRows();
      sizeTicker();
    });
  }
  tickClock();
  window.setInterval(tickClock, 1000);
  window.addEventListener('resize', function () {
    sizeRows();
    sizeTicker();
  });
  window.addEventListener('online', poll);
  window.addEventListener('offline', function () {
    if (!revoked) {
      showOffline();
    }
  });
  document.addEventListener(
    typeof document.hidden === 'boolean' ? 'visibilitychange' : 'webkitvisibilitychange',
    onVisibility
  );
  window.addEventListener('pagehide', function () {
    pageActive = false;
    if (request) {
      var activeRequest = request;
      request = null;
      activeRequest.abort();
    }
    window.clearTimeout(pollTimer);
    clearBoard();
    showOffline();
    releaseWakeLock();
  });
  window.addEventListener('pageshow', function (event) {
    pageActive = true;
    if (event.persisted) {
      onVisibility();
    }
  });

  removeLegacyPrices();
  if (token) {
    poll();
  } else {
    showUnavailable();
  }
  acquireWakeLock();
})();
