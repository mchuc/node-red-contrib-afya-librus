'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { HTML_OCENY, HTML_UWAGI, atrapaLibrusa } = require('./fixtures/atrapa');

/** Minimalny „RED” wystarczający do uruchomienia węzła bez Node-RED. */
function uruchomWezel({ login = 'rodzic', haslo = 'tajne', config = {} } = {}) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afya-librus-'));
  let Konstruktor;
  const kontekst = { global: new Map(), flow: new Map() };
  const sklep = (m) => ({
    get: (k, s) => m.get(`${s || 'default'}::${k}`),
    set: (k, v, s) => m.set(`${s || 'default'}::${k}`, v),
  });
  const RED = {
    settings: { userDir },
    kontekst,
    util: {
      parseContextStore(key) {
        const m = /^#:\((\S+?)\)::(.*)$/.exec(key);
        return m ? { store: m[1], key: m[2] } : { key };
      },
      cloneMessage: (v) => (v === undefined ? v : structuredClone(v)),
    },
    nodes: {
      createNode(node, cfg) {
        node.id = cfg.id;
        node.credentials = { login, haslo };
        node.handlers = {};
        node.statusy = [];
        node.ostrzezenia = [];
        node.on = (zdarzenie, fn) => (node.handlers[zdarzenie] = fn);
        node.status = (s) => node.statusy.push(s);
        node.warn = (w) => node.ostrzezenia.push(w);
        node.context = () => ({ global: sklep(kontekst.global), flow: sklep(kontekst.flow) });
      },
      registerType(nazwa, ctor) {
        assert.equal(nazwa, 'afya-librus');
        Konstruktor = ctor;
      },
    },
  };
  require('../afya-librus.js')(RED);
  const node = new Konstruktor({ id: 'n1', ...config });
  node.wyslij = (msg) =>
    new Promise((resolve, reject) => node.handlers.input(msg, resolve, (err) => err && reject(err)));
  return { node, userDir, RED };
}

test('węzeł: pierwszy odczyt cichy, potem tylko nowe oceny; msg.test; zapis stanu', async (t) => {
  const prawdziwyFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = prawdziwyFetch));
  globalThis.fetch = atrapaLibrusa().fetch;

  const { node, userDir } = uruchomWezel({ config: { bezPl: true } });

  // 1) pierwszy odczyt – tylko zapamiętanie
  let msg = await node.wyslij({ topic: 'x' });
  assert.equal(msg.topic, 'x');
  assert.equal(msg.payload.ok, true);
  assert.equal(msg.payload.pierwszyOdczyt, true);
  assert.deepEqual(msg.payload.nowe, []);
  assert.equal(msg.payload.tekst, '');
  assert.equal(msg.payload.oceny.length, 8);
  assert.ok(fs.existsSync(path.join(userDir, 'afya-librus', 'n1.json')));

  // 2) bez zmian – nic nowego
  msg = await node.wyslij({});
  assert.equal(msg.payload.pierwszyOdczyt, false);
  assert.equal(msg.payload.nowe.length, 0);

  // 3) msg.test – najnowsza ocena udaje nową
  msg = await node.wyslij({ test: true });
  assert.equal(msg.payload.nowe.length, 1);
  assert.equal(msg.payload.tekst, 'Librus Kowalski Jas: 6(2) z Jezyk polski (Wypracowanie) Rozprawka: „Lalka” – bardzo dobra argumentacja');

  // 4) w Librusie pojawia się nowa ocena
  const nowaOcena =
    '<span class="grade-box"><a class="ocena" href="/przegladaj_oceny/szczegoly/5200" title="Kategoria: Kartkówka&lt;br&gt;Data: 2027-03-10 (śr.)&lt;br&gt;Nauczyciel: Testowa Anna&lt;br&gt;Licz do średniej: tak&lt;br&gt;Waga: 2&lt;br&gt;Dodał: Testowa Anna&lt;br/&gt;&lt;br/&gt;Komentarz: Ułamki">2</a></span>';
  const html = HTML_OCENY.replace('<span class="grade-box"><a class="ocena" href="/przegladaj_oceny/szczegoly/5007"', nowaOcena + '<span class="grade-box"><a class="ocena" href="/przegladaj_oceny/szczegoly/5007"');
  const atrapa = atrapaLibrusa().fetch;
  globalThis.fetch = async (url, o) =>
    new URL(url).pathname === '/przegladaj_oceny/uczen' ? new Response(html) : atrapa(url, o);

  msg = await node.wyslij({});
  assert.equal(msg.payload.nowe.length, 1);
  const nowa = msg.payload.nowe[0];
  assert.equal(nowa.ocena, '2');
  assert.equal(nowa.semestr, 2);
  assert.equal(nowa.srednia, 2.83); // (4.5*1 + 2*2) / 3
  assert.equal(msg.payload.tekst, 'Librus Kowalski Jas: 2(2) z Matematyka (Kartkowka) Ulamki');
  assert.equal(node.statusy.at(-1).fill, 'yellow');

  // 5) to samo jeszcze raz – już nie jest nowe
  msg = await node.wyslij({});
  assert.equal(msg.payload.nowe.length, 0);
});

test('węzeł: błąd logowania → ok:false z opisem, bez wyjątku', async (t) => {
  const prawdziwyFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = prawdziwyFetch));
  globalThis.fetch = atrapaLibrusa().fetch;

  const { node } = uruchomWezel({ haslo: 'zle' });
  const msg = await node.wyslij({});
  assert.equal(msg.payload.ok, false);
  assert.match(msg.payload.blad, /Nieprawidłowy login lub hasło/);
  assert.equal(node.statusy.at(-1).fill, 'red');

  const bezHasla = uruchomWezel({ haslo: '' }).node;
  assert.match((await bezHasla.wyslij({})).payload.blad, /Uzupełnij login i hasło/);
});

test('węzeł: zestawienie ocen przedmiotu i uwagi nauczyciela', async (t) => {
  const prawdziwyFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = prawdziwyFetch));
  globalThis.fetch = atrapaLibrusa().fetch;

  const { node } = uruchomWezel({ config: { zTablica: true, uwagi: true } });

  let msg = await node.wyslij({});
  assert.equal(msg.payload.tablica.Matematyka[1], '5(3), 3-(2), +, 4[1](2)');
  assert.equal(msg.payload.uwagi.length, 2);
  assert.deepEqual(msg.payload.noweUwagi, []); // pierwszy odczyt uwag – cicho

  // nowa uwaga i poprawa oceny z matematyki (2 → 5) w drugim semestrze
  const html = HTML_OCENY.replace(
    '<span class="grade-box"><a class="ocena" href="/przegladaj_oceny/szczegoly/5007"',
    '<span>[ <span class="grade-box"><a class="ocena" href="/przegladaj_oceny/szczegoly/5300" title="Kategoria: Kartkówka&lt;br&gt;Data: 2027-03-01 (pon.)&lt;br&gt;Nauczyciel: Testowa Anna&lt;br&gt;Dodał: Testowa Anna&lt;br/&gt;">2</a></span>' +
      '<span class="grade-box"><a class="ocena" href="/przegladaj_oceny/szczegoly/5301" title="Kategoria: Kartkówka&lt;br&gt;Data: 2027-03-08 (pon.)&lt;br&gt;Nauczyciel: Testowa Anna&lt;br&gt;Licz do średniej: tak&lt;br&gt;Waga: 2&lt;br&gt;Dodał: Testowa Anna&lt;br/&gt;">5</a></span> ]</span>' +
      '<span class="grade-box"><a class="ocena" href="/przegladaj_oceny/szczegoly/5007"',
  );
  const uwagi = HTML_UWAGI.replace(
    '</tbody>',
    '<tr class="line1"><td>Brak zadania domowego</td><td class="small">2027-03-09</td><td>Testowa Anna</td><td>negatywna</td><td>Obowiązki</td></tr></tbody>',
  );
  const atrapa = atrapaLibrusa().fetch;
  globalThis.fetch = async (url, o) => {
    const sciezka = new URL(url).pathname;
    if (sciezka === '/przegladaj_oceny/uczen') return new Response(html);
    if (sciezka === '/uwagi') return new Response(uwagi);
    return atrapa(url, o);
  };

  msg = await node.wyslij({});
  // „2” i jej poprawa pojawiły się między sprawdzeniami – SMS tylko o „5[2](2)”
  assert.deepEqual(
    msg.payload.nowe.map((o) => o.zapis),
    ['5[2](2)'],
  );
  assert.equal(msg.payload.noweUwagi.length, 1);
  assert.equal(
    msg.payload.tekst.split('\n').at(-2),
    'Librus Kowalski Jaś: 5[2](2) z Matematyka (Kartkówka) | oceny: 5[2](2), 4+(1)',
  );
  assert.equal(msg.payload.tekst.split('\n').at(-1), 'Librus Kowalski Jaś: uwaga negatywna – Brak zadania domowego (Testowa Anna)');
});

test('węzeł: ostatni wynik w zmiennej kontekstu (global / flow / magazyn)', async (t) => {
  const prawdziwyFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = prawdziwyFetch));
  globalThis.fetch = atrapaLibrusa().fetch;

  // domyślnie global
  let { node, RED } = uruchomWezel({ config: { variableName: 'librus_jas' } });
  let msg = await node.wyslij({});
  const zapisane = RED.kontekst.global.get('default::librus_jas');
  assert.equal(zapisane.ok, true);
  assert.equal(zapisane.oceny.length, msg.payload.oceny.length);
  assert.notEqual(zapisane, msg.payload); // kopia, nie ta sama referencja

  // flow + wybrany magazyn kontekstu
  ({ node, RED } = uruchomWezel({ config: { variableName: '#:(plik)::librus', scope: 'flow' } }));
  await node.wyslij({});
  assert.equal(RED.kontekst.flow.get('plik::librus').ok, true);

  // błąd też trafia do zmiennej (ok:false)
  ({ node, RED } = uruchomWezel({ haslo: 'zle', config: { variableName: 'librus_blad' } }));
  await node.wyslij({});
  assert.equal(RED.kontekst.global.get('default::librus_blad').ok, false);

  // bez nazwy zmiennej nic nie jest zapisywane
  ({ node, RED } = uruchomWezel());
  await node.wyslij({});
  assert.equal(RED.kontekst.global.size + RED.kontekst.flow.size, 0);
});
