/* Offline layer for the revers-remont.ru replica. Loaded first on every page.
 * 1. Tilda CDN URLs that Tilda's own scripts add at runtime are rewritten to the local /tilda/ mirror.
 * 2. Requests to Tilda's servers never leave the browser: the store API is answered from /data/store/*.json
 *    (the saved 177-product API responses), statistics, error reporting and discounts get empty answers.
 * 3. The order form (cart, block t706) cannot reach Tilda's form server any more. A click on its submit button opens a
 *    pre-filled e-mail in the visitor's mail program and says so; nothing is reported as sent.
 */
(function () {
  'use strict';
  var CFG = window.REPLICA || {};
  var MAIL = CFG.email || 'sibflot.servis@yandex.ru';
  var BASE = CFG.base || '';   // path prefix when served from a subfolder (GitHub Pages project site)

  function loc(u) {
    if (typeof u !== 'string') return u;
    return u.replace(/^(https?:)?\/\/neo\.tildacdn\.[a-z]+\//, BASE + '/tilda/neo/')
            .replace(/^(https?:)?\/\/static\d?\.tildacdn\.[a-z]+\//, BASE + '/tilda/');
  }
  [[window.HTMLScriptElement, 'src'], [window.HTMLLinkElement, 'href'], [window.HTMLImageElement, 'src']].forEach(function (p) {
    var d = Object.getOwnPropertyDescriptor(p[0].prototype, p[1]);
    Object.defineProperty(p[0].prototype, p[1], { configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { d.set.call(this, loc(v)); } });
  });
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) {
    return setAttr.call(this, n, (n === 'src' || n === 'href') ? loc(v) : v);
  };

  // ---------------------------------------------------------------- Tilda servers
  var stores = {};
  function store(part) {
    if (!stores[part]) stores[part] = window.fetch(BASE + '/data/store/' + part + '.json').then(function (r) {
      if (!r.ok) throw new Error('no local data for store part ' + part); return r.json();
    }).then(function (d) {   // product links must stay absolute (Tilda parses "://") but point at this host
      d.products.forEach(function (p) { if (p.url) p.url = here(p.url); });
      return d;
    });
    return stores[part];
  }
  function here(u) { return location.origin + BASE + u.replace(/^https?:\/\/[^\/]+/, '').replace(BASE + '/', '/'); }
  window.REPLICA_HERE = here;
  function params(u) {
    var q = {}, s = u.split('?')[1] || '';
    s.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    return q;
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[‐-―−]/g, '-'); }

  // ponytail: substring search over title/SKU/text; Tilda's server search is fuzzier (Elasticsearch).
  function productsList(u) {
    var q = params(u);
    return store(q.storepartuid).then(function (d) {
      var list = d.products.slice(), terms = [], parts = [];
      Object.keys(q).forEach(function (k) {
        if (/^filters\[storepartuid\]/.test(k)) {   // category tab: the value is the category title (path)
          (d.parts || []).forEach(function (p) { if ((p.path || [p.title]).join('/') === q[k] || p.title === q[k]) parts.push(String(p.uid)); });
          return;
        }
        var m = /^filters\[(.+)\]$/.exec(k);
        if (m && m[1] !== 'quantity' && q[k]) terms.push(norm(q[k]));
        var s = /^sort\[(.+)\]$/.exec(k);
        if (s) {
          var f = s[1], dir = q[k] === 'desc' ? -1 : 1;
          list.sort(function (a, b) {
            var x = f === 'price' ? parseFloat(a.price) || 0 : norm(a[f]), y = f === 'price' ? parseFloat(b.price) || 0 : norm(b[f]);
            return x > y ? dir : x < y ? -dir : 0;
          });
        }
      });
      if (parts.length) list = list.filter(function (p) {
        return JSON.parse(p.partuids || '[]').some(function (u) { return parts.indexOf(String(u)) !== -1; });
      });
      if (terms.length) list = list.filter(function (p) {
        var h = norm(p.title + ' ' + p.sku + ' ' + p.descr + ' ' + p.text);
        return terms.every(function (t) { return h.indexOf(t) !== -1; });
      });
      var size = parseInt(q.size, 10) || 36, slice = parseInt(q.slice, 10) || 1, from = (slice - 1) * size;
      var out = {}; Object.keys(d).forEach(function (k) { out[k] = d[k]; });
      out.products = list.slice(from, from + size);
      out.total = list.length; out.slice = slice;
      if (from + size < list.length) out.nextslice = slice + 1; else delete out.nextslice;
      return out;
    });
  }
  function oneProduct(u) {
    var q = params(u);
    return store(q.storepartuid).then(function (d) {
      return d.products.filter(function (p) { return String(p.uid) === String(q.productuid); })[0] || {};
    });
  }
  function answer(u) {
    if (/tildaapi\.[a-z]+\/api\/getproductslist/.test(u)) return productsList(u);
    if (/tildaapi\.[a-z]+\/api\/getproduct\//.test(u)) return oneProduct(u);
    if (/\/api\/getfilters/.test(u)) return Promise.resolve({ sort: true, search: true, filters: [] });
    if (/\/discounts\//.test(u)) return Promise.resolve([]);
    return Promise.resolve({});
  }
  var remote = /^(https?:)?\/\/[a-z0-9.-]*tilda(api|cdn)\.[a-z]+\//;

  var X = window.XMLHttpRequest.prototype, open = X.open, send = X.send;
  X.open = function (m, u) { this._replicaUrl = remote.test(u) && !/\.(js|css|json)(\?|$)/.test(u) ? u : null; return open.apply(this, arguments); };
  X.send = function () {
    var x = this, u = x._replicaUrl;
    if (!u) return send.apply(this, arguments);
    answer(u).then(function (data) {
      var body = JSON.stringify(data);
      [['readyState', 4], ['status', 200], ['statusText', 'OK'], ['responseText', body], ['response', body], ['responseURL', u]].forEach(function (p) {
        Object.defineProperty(x, p[0], { configurable: true, value: p[1] });
      });
      // dispatchEvent also runs the onload/onreadystatechange properties
      ['readystatechange', 'load', 'loadend'].forEach(function (t) { x.dispatchEvent(new Event(t)); });
    }, function (e) { console.error('[replica]', e.message); });
  };
  var origFetch = window.fetch.bind(window);
  window.fetch = function (u, o) {
    var s = typeof u === 'string' ? u : u && u.url;
    if (s && remote.test(s) && !/\.(js|css|json)(\?|$)/.test(s)) {
      return answer(s).then(function (d) { return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }); });
    }
    return origFetch(typeof u === 'string' ? loc(u) : u, o);
  };
  navigator.sendBeacon = function () { return true; };

  // ---------------------------------------------------------------- start position and home hero
  // Every page opens at the top unless the link names a section (#...): no restored or load-time jump. A visitor who
  // starts scrolling while the page loads is left where they are.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  var moved = false;
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (t) { addEventListener(t, function () { moved = true; }, { passive: true, once: true }); });
  function toTop() { if (!location.hash && !moved && window.scrollY) window.scrollTo(0, 0); }
  addEventListener('DOMContentLoaded', toTop); addEventListener('load', function () { toTop(); setTimeout(toTop, 300); });
  addEventListener('pageshow', function (e) { if (e.persisted) toTop(); });

  // Home hero photo blurs as the page scrolls over it (css/replica-fixes.css keeps it in place); off for reduced motion.
  addEventListener('DOMContentLoaded', function () {
    var hero = document.querySelector('#rec867248668 .t-cover'), photo = hero && hero.querySelector('.t-cover__carrier');
    if (!photo || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    var busy = false;
    function blur() { busy = false; var k = Math.min(Math.max(window.scrollY / (hero.offsetHeight || 1), 0), 1); photo.style.filter = k ? 'blur(' + (k * 10).toFixed(1) + 'px)' : '';
      photo.style.transform = k ? 'scale(' + (1 + k * 0.06).toFixed(3) + ')' : ''; }   // hides the blur's soft edge; the top screen stays as in the original
    addEventListener('scroll', function () { if (!busy) { busy = true; requestAnimationFrame(blur); } }, { passive: true });
    blur();
  });

  // ---------------------------------------------------------------- order form (t706 cart)
  // Only a real click on the cart form's own submit button (Enter in a field becomes such a click), and only once
  // Tilda's own check of the fields passes. Tilda's handler (and its server send, which would report a fake
  // success) never runs for that click.
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[type="submit"]');
    var f = btn && btn.closest('.t706 .js-form-proccess');
    if (!f || !e.isTrusted || !window.tildaForm) return;
    e.preventDefault(); e.stopImmediatePropagation();
    window.tildaForm.hideErrors(f);
    if (window.tildaForm.showErrors(f, window.tildaForm.validate(f))) return;
    var cart = window.tcart && window.tcart.products || [];
    if (!cart.length) return;
    var val = function (n) { var el = f.querySelector('[name="' + n + '"]'); return el ? el.value.trim() : ''; };
    var lines = ['Здравствуйте! Хочу оформить заказ.', ''];
    cart.forEach(function (p, i) { lines.push((i + 1) + '. ' + (p.name || '') + (p.sku ? ' (' + p.sku + ')' : '') + ' x ' + (p.quantity || 1)); });
    lines.push('', 'Имя: ' + val('Name'), 'E-mail: ' + val('Email'), 'Телефон: ' + val('Phone'), 'Город: ' + val('Input_2'), 'Комментарий: ' + val('Input'));
    var href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent('Заказ с сайта revers-remont.ru') + '&body=' + encodeURIComponent(lines.join('\n'));
    var msg = f.querySelector('.replica-note');
    if (!msg) { msg = document.createElement('p'); msg.className = 'replica-note t-text t-text_xs'; msg.setAttribute('role', 'status'); f.appendChild(msg); }
    msg.textContent = 'Сайт не отправляет заявки сам. Открыто письмо в вашей почтовой программе: проверьте его и отправьте на ' + MAIL + '.';
    (window.REPLICA_OPEN_MAIL || function (h) { window.location.href = h; })(href);   // tests/e2e.js replaces this, so test runs never open the mail program
  }, true);
})();
