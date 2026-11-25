'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { czytajTabeleOcen, scalSrednie } = require('../lib/librus');
const { zarejestrujStrone, normalizujSciezke, stronaOcen } = require('../lib/strona');
const { HTML_OCENY, atrapaLibrusa } = require('./fixtures/atrapa');

/** Atrapa serwera HTTP Node-RED (express): trasy w _router.stack. */
function serwer() {
  const stack = [];
  const dodaj = (method) => (sciezka, handle) =>
    stack.push({ route: { path: sciezka, methods: { [method]: true }, stack: [{ handle }] } });
  return { _router: { stack }, get: dodaj('get'), post: dodaj('post') };
}

/** Wywołuje trasę jak przeglądarka; zwraca { status, naglowki, body }. */
function zadanie(app, method, sciezka, { cookie = '', body, query = {} } = {}) {
  const warstwa = app._router.stack.find((w) => w.route.path === sciezka && w.route.methods[method]);
  if (!warstwa) return Promise.resolve({ status: 404, naglowki: {}, body: '' });
  return new Promise((resolve) => {
    const res = {
      kod: 200,
      naglowki: {},
      status(k) { this.kod = k; return this; },
      set(n) { Object.assign(this.naglowki, n); return this; },
      send(b) { resolve({ status: this.kod, naglowki: this.naglowki, body: String(b) }); },
    };
    const req = { headers: { cookie }, query, body, baseUrl: '', path: sciezka, ip: '10.0.0.1', secure: false };
    warstwa.route.stack[0].handle(req, res);
  });
}

function dane() {
  const { oceny, srednieLibrus } = czytajTabeleOcen(HTML_OCENY);
  return { uczen: 'Kowalski Jaś', klasa: '7 b', oceny, srednie: scalSrednie(oceny, srednieLibrus), srednieLibrus };
}

const wezel = (id = 'n1') => ({ id, warn() {} });
const ciastko = (odp) => odp.naglowki['Set-Cookie'].split(';')[0];

test('ścieżka strony: normalizacja i walidacja', () => {
  assert.equal(normalizujSciezke('librus/jas/'), '/librus/jas');
  assert.equal(normalizujSciezke('/Librus-Ola_2'), '/Librus-Ola_2');
  for (const zla of ['', '/', '../x', 'a b', 'a//b', 'oceny?x=1']) assert.equal(normalizujSciezke(zla), null, zla);
});

test('strona: bez hasła wyłączona, z hasłem – logowanie, ciasteczko, wylogowanie', async () => {
  const RED = { httpNode: serwer() };
  const stan = { dane: dane(), czas: '2026-11-25T09:45:00.000Z' };

  let zamknij = zarejestrujStrone(RED, wezel(), { sciezka: '/librus/jas', haslo: '', tytul: 'Jaś', stan: () => stan });
  assert.equal((await zadanie(RED.httpNode, 'get', '/librus/jas')).status, 503);
  zamknij();
  assert.equal(RED.httpNode._router.stack.length, 0);

  zamknij = zarejestrujStrone(RED, wezel(), { sciezka: '/librus/jas', haslo: 'tajne-123', tytul: 'Jaś', stan: () => stan });
  let odp = await zadanie(RED.httpNode, 'get', '/librus/jas');
  assert.equal(odp.status, 200);
  assert.match(odp.body, /type="password"/);
  assert.doesNotMatch(odp.body, /Matematyka/); // bez hasła nie widać ocen
  assert.equal(odp.naglowki['Cache-Control'], 'no-store');

  odp = await zadanie(RED.httpNode, 'post', '/librus/jas', { body: { haslo: 'zle' } });
  assert.equal(odp.status, 401);
  assert.match(odp.body, /Nieprawidłowe hasło/);

  odp = await zadanie(RED.httpNode, 'post', '/librus/jas', { body: { haslo: 'tajne-123' } });
  assert.equal(odp.status, 303);
  assert.equal(odp.naglowki.Location, '/librus/jas');
  assert.match(odp.naglowki['Set-Cookie'], /HttpOnly; SameSite=Strict/);
  const cookie = ciastko(odp);

  odp = await zadanie(RED.httpNode, 'get', '/librus/jas', { cookie: 'inne=1; ' + cookie });
  assert.equal(odp.status, 200);
  assert.match(odp.body, /Kowalski Jaś/);
  assert.match(odp.body, /Klasa 7 b/);

  odp = await zadanie(RED.httpNode, 'get', '/librus/jas', { cookie: cookie.replace(/=.*/, '=podrobione') });
  assert.match(odp.body, /type="password"/);

  odp = await zadanie(RED.httpNode, 'get', '/librus/jas', { cookie, query: { wyloguj: '1' } });
  assert.equal(odp.status, 303);
  assert.match(odp.naglowki['Set-Cookie'], /Max-Age=0/);
  zamknij();
});

test('strona: przedmioty alfabetycznie, średnia zaraz po nazwie, data w podpowiedzi', () => {
  const html = stronaOcen({ dane: dane(), czas: '2026-11-25T09:45:00.000Z' }, { tytul: 'Jaś' });
  const okres1 = html.slice(html.indexOf('class="okres k1"'), html.indexOf('class="okres k2"'));
  const okres2 = html.slice(html.indexOf('class="okres k2"'), html.indexOf('class="okres kR"'));
  // alfabetycznie: Język polski przed Matematyką
  assert.ok(okres2.indexOf('Język polski') < okres2.indexOf('Matematyka'));
  // Matematyka okres 1: Librus nie pokazuje średniej → wyliczona z wag (4,07*), zaraz po nazwie
  assert.match(okres1, /<b>Matematyka<\/b><span class="sr v-b" title="[^"]*wyliczona[^"]*">4,07\*<\/span>/);
  // ocena z wagą, poprawa w nawiasie, data w podpowiedzi
  assert.match(okres1, />4<s>\[1\]<\/s><sub>2<\/sub><span class="t"><b>17\.11\.2026<\/b>/);
  // „+” nie liczy się do średniej, ocena przewidywana osobno (pełna ramka)
  assert.match(okres1, /class="g v-x nl"[^>]*>\+/);
  assert.match(okres1, /class="g v-b k"[^>]*>4<span class="t"><b>08\.01\.2027<\/b><br>przewidywana śródroczna/);
  // aktywny jest okres 2 (są już oceny z II okresu)
  assert.match(html, /id="o2" checked/);
});

test('strona: średnia z Librusa ma pierwszeństwo, dane są escapowane', () => {
  const d = dane();
  d.srednieLibrus = { Matematyka: { 1: 4.25 } };
  d.srednie.Matematyka[1] = 4.25;
  d.oceny[0].komentarz = '<script>alert(1)</script>';
  d.uczen = 'Jaś <b>X</b>';
  const html = stronaOcen({ dane: d, czas: '2026-11-25T09:45:00.000Z' }, { tytul: 'Jaś' });
  assert.match(html, /title="średnia ważona z Librusa">4,25<\/span>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Jaś &lt;b&gt;X&lt;\/b&gt;/);
});

test('dwoje dzieci: osobne strony; ta sama ścieżka w dwóch węzłach jest odrzucana', async () => {
  const RED = { httpNode: serwer() };
  const jas = zarejestrujStrone(RED, wezel('a'), { sciezka: '/librus/jas', haslo: 'h1', tytul: 'Jaś', stan: () => ({}) });
  const ola = zarejestrujStrone(RED, wezel('b'), { sciezka: '/librus/ola', haslo: 'h2', tytul: 'Ola', stan: () => ({}) });
  assert.throws(
    () => zarejestrujStrone(RED, wezel('c'), { sciezka: '/librus/jas', haslo: 'h3', tytul: 'X', stan: () => ({}) }),
    /already used/,
  );
  // hasło Oli nie otwiera strony Jasia
  const odp = await zadanie(RED.httpNode, 'post', '/librus/ola', { body: { haslo: 'h2' } });
  const jasZCiastkiemOli = await zadanie(RED.httpNode, 'get', '/librus/jas', { cookie: ciastko(odp) });
  assert.match(jasZCiastkiemOli.body, /type="password"/);
  jas();
  ola();
  assert.equal(RED.httpNode._router.stack.length, 0);
  // po zamknięciu ścieżka znów wolna (redeploy)
  zarejestrujStrone(RED, wezel('c'), { sciezka: '/librus/jas', haslo: 'h3', tytul: 'X', stan: () => ({}) })();
});

test('węzeł: strona pokazuje ostatni odczyt i pamięta go po restarcie', async (t) => {
  const prawdziwyFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = prawdziwyFetch));
  globalThis.fetch = atrapaLibrusa().fetch;

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afya-librus-strona-'));
  const httpNode = serwer();
  const uruchom = () => {
    let Ctor;
    const handlers = {};
    const RED = {
      settings: { userDir },
      httpNode,
      util: { parseContextStore: (key) => ({ key }), cloneMessage: (v) => structuredClone(v) },
      nodes: {
        createNode(node, cfg) {
          node.id = cfg.id;
          node.credentials = { login: 'rodzic', haslo: 'tajne', hasloStrony: 'strona-1' };
          node.on = (e, fn) => (handlers[e] = fn);
          node.status = () => {};
          node.warn = () => {};
          node.error = (e) => assert.fail(String(e));
          node.context = () => ({ global: { set() {} }, flow: { set() {} } });
        },
        registerType(_, c) { Ctor = c; },
      },
    };
    require('../afya-librus.js')(RED);
    new Ctor({ id: 'n1', name: 'Librus – Jaś', strona: true, sciezka: 'librus/jas' });
    return handlers;
  };

  let h = uruchom();
  const zaloguj = async () =>
    ciastko(await zadanie(httpNode, 'post', '/librus/jas', { body: { haslo: 'strona-1' } }));
  let cookie = await zaloguj();
  assert.match((await zadanie(httpNode, 'get', '/librus/jas', { cookie })).body, /pojawią się po pierwszym sprawdzeniu/);

  await new Promise((resolve) => h.input({}, () => {}, resolve));
  let strona = (await zadanie(httpNode, 'get', '/librus/jas', { cookie })).body;
  assert.match(strona, /Kowalski Jaś/);
  assert.match(strona, /<b>Matematyka<\/b>/);

  // restart Node-RED: zamknięcie węzła, nowa instancja – oceny wczytane z pliku stanu
  await new Promise((resolve) => h.close(false, resolve));
  assert.equal(httpNode._router.stack.length, 0);
  h = uruchom();
  cookie = await zaloguj();
  strona = (await zadanie(httpNode, 'get', '/librus/jas', { cookie })).body;
  assert.match(strona, /<b>Matematyka<\/b>/);
  await new Promise((resolve) => h.close(false, resolve));
});
