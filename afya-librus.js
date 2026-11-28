/**
 * AFYA Librus – new grades and teacher notes from Librus Synergia, ready-made SMS text.
 * (C) 2026 Marcin Chuć · MIT
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pobierzOceny, tekstSms, DOMYSLNY_SZABLON, DOMYSLNY_SZABLON_UWAGI } = require('./lib/librus');
const { zarejestrujStrone, normalizujSciezke } = require('./lib/strona');

/** Najnowszy element wg daty (do msg.test – sprawdzenie SMS bez czekania na nowość). */
function najnowszy(lista) {
  return lista.reduce((a, b) => (b.data >= a.data ? b : a));
}

function wczytajStan(plik) {
  try {
    return JSON.parse(fs.readFileSync(plik, 'utf8'));
  } catch (_) {
    return null;
  }
}

function zapiszStan(plik, stan) {
  fs.mkdirSync(path.dirname(plik), { recursive: true });
  fs.writeFileSync(plik, JSON.stringify(stan));
}

module.exports = function (RED) {
  function AfyaLibrusNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const bezPl = !!config.bezPl;
    // „Send info about a new grade” – starsze węzły nie mają tego pola, więc domyślnie włączone
    const wysylajOceny = config.oceny !== false;
    // „Send info about a new note” – uwagi czytamy tylko wtedy, gdy trzeba o nich informować
    const czytajUwagi = !!config.uwagi;
    // „dopisz oceny z przedmiotu” → do każdej linii SMS: „| oceny: 5(3), 3-(2), 4[1](2)”
    const szablon = (config.szablon || DOMYSLNY_SZABLON) + (config.zTablica ? ' | oceny: %tablica%' : '');
    const szablonUwagi = config.szablonUwagi || DOMYSLNY_SZABLON_UWAGI;
    // Lista już widzianych ocen – przetrwa restart Node-RED, więc nie będzie duplikatów SMS
    const plikStanu = path.join(RED.settings.userDir || process.cwd(), 'afya-librus', `${node.id}.json`);
    // Opcjonalnie: ostatni wynik także w zmiennej kontekstu (global/flow) – do odczytu z innych flow
    const zakres = config.scope === 'flow' ? 'flow' : 'global';
    const { key: zmienna, store: magazyn } = RED.util.parseContextStore(String(config.variableName || '').trim());
    let trwa = false;

    // Strona z ocenami (np. /librus/jas) – ostatni udany odczyt + ewentualny błąd
    const stronaWlaczona = !!config.strona;
    const ostatni = { dane: null, czas: null, blad: null, czasBledu: null };
    let zamknijStrone = null;
    if (stronaWlaczona) {
      const zapisany = (wczytajStan(plikStanu) || {}).ostatni;
      if (zapisany && zapisany.dane) Object.assign(ostatni, { dane: zapisany.dane, czas: zapisany.czas });
      const sciezka = normalizujSciezke(config.sciezka || 'librus');
      try {
        if (!sciezka) throw new Error(`invalid page path "${config.sciezka}"`);
        const { hasloStrony = '', tokenStrony = '' } = node.credentials || {};
        zamknijStrone = zarejestrujStrone(RED, node, {
          sciezka,
          haslo: hasloStrony,
          token: String(tokenStrony).trim(),
          tytul: String(config.tytulStrony || '').trim(),
          nazwa: config.name || '',
          stan: () => ostatni,
        });
        node.status({ fill: 'grey', shape: 'ring', text: `page ${sciezka}` });
        if (!hasloStrony && !tokenStrony) node.warn(`Page ${sciezka} is off until a page password or token is set`);
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: `page: ${err.message}`.slice(0, 60) });
        node.error(`Librus page: ${err.message}`);
      }
    }

    node.on('close', (removed, done) => {
      if (zamknijStrone) zamknijStrone();
      done();
    });

    node.on('input', async (msg, send, done) => {
      if (trwa) {
        node.warn('Previous Librus check is still running – skipped');
        return done();
      }
      trwa = true;
      node.status({ fill: 'blue', shape: 'dot', text: 'checking…' });
      const czas = new Date().toISOString();

      try {
        const { login, haslo } = node.credentials || {};
        if (!login || !haslo) throw new Error('Uzupełnij login i hasło w konfiguracji węzła');

        const dane = await pobierzOceny(login, haslo, { uwagi: czytajUwagi });

        const stan = wczytajStan(plikStanu) || {};
        const pierwszyOdczyt = !stan.widziane;
        // Pierwszy odczyt tylko zapamiętuje stan – bez zasypania SMS-ami całym rokiem ocen
        const widziane = new Set(stan.widziane || dane.oceny.map((o) => o.id));
        // ocena już zastąpiona poprawą nie idzie osobno – widać ją w nawiasie nowej, np. 5[2](2)
        let nowe = dane.oceny.filter((o) => !widziane.has(o.id) && !o.zastapiona);
        const biezace = dane.oceny.filter((o) => o.typ === 'biezaca' && !o.zastapiona);
        if (msg.test && wysylajOceny && !nowe.length && biezace.length) nowe = [najnowszy(biezace)];
        dane.oceny.forEach((o) => widziane.add(o.id));

        // Uwagi – osobna pamięć; włączenie opcji później też zaczyna od cichego odczytu
        let noweUwagi = [];
        let widzianeUwagi = stan.widzianeUwagi;
        if (dane.uwagi) {
          const znane = new Set(widzianeUwagi || dane.uwagi.map((u) => u.id));
          noweUwagi = dane.uwagi.filter((u) => !znane.has(u.id));
          if (msg.test && !noweUwagi.length && dane.uwagi.length) noweUwagi = [najnowszy(dane.uwagi)];
          dane.uwagi.forEach((u) => znane.add(u.id));
          widzianeUwagi = [...znane];
        }

        const doZapisu = { widziane: [...widziane], widzianeUwagi, aktualizacja: czas };
        if (stronaWlaczona) {
          ostatni.dane = {
            uczen: dane.uczen,
            klasa: dane.klasa,
            oceny: dane.oceny,
            srednie: dane.srednie,
            srednieLibrus: dane.srednieLibrus,
          };
          ostatni.czas = czas;
          doZapisu.ostatni = { dane: ostatni.dane, czas };
        }
        zapiszStan(plikStanu, doZapisu);

        nowe = nowe.map((o) => {
          const sr = dane.srednie[o.przedmiot] && dane.srednie[o.przedmiot][o.semestr];
          const tab = dane.tablica[o.przedmiot] && dane.tablica[o.przedmiot][o.semestr];
          return { ...o, srednia: sr === undefined ? null : sr, tablica: tab || '' };
        });

        // osobny tekst ocen i osobny tekst uwag (inny szablon) + oba razem w „tekst”
        const tekstOceny = wysylajOceny ? nowe.map((o) => tekstSms(szablon, o, dane.uczen, bezPl)).join('\n') : '';
        const tekstUwagi = noweUwagi.map((u) => tekstSms(szablonUwagi, u, dane.uczen, bezPl)).join('\n');

        msg.payload = {
          ok: true,
          czas,
          uczen: dane.uczen,
          klasa: dane.klasa,
          nowe,
          tekst: [tekstOceny, tekstUwagi].filter(Boolean).join('\n'),
          tekstOceny,
          tekstUwagi,
          pierwszyOdczyt,
          oceny: dane.oceny,
          srednie: dane.srednie,
          srednieLibrus: dane.srednieLibrus,
          tablica: dane.tablica,
        };
        if (dane.uwagi) {
          msg.payload.noweUwagi = noweUwagi;
          msg.payload.uwagi = dane.uwagi;
        }

        const godz = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        const ile = nowe.length + noweUwagi.length;
        node.status(
          ile
            ? {
                fill: 'yellow',
                shape: 'dot',
                text: `new grades: ${nowe.length}${czytajUwagi ? `, notes: ${noweUwagi.length}` : ''} · ${godz}`,
              }
            : { fill: 'green', shape: 'dot', text: `ok, nothing new · ${godz}` },
        );
      } catch (err) {
        msg.payload = { ok: false, czas, blad: err.message };
        ostatni.blad = err.message;
        ostatni.czasBledu = czas;
        node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 60) });
        node.warn(err.message);
      } finally {
        trwa = false;
      }

      if (zmienna) {
        try {
          node.context()[zakres].set(zmienna, RED.util.cloneMessage(msg.payload), magazyn);
        } catch (err) {
          node.warn(`Cannot store ${zakres}.${zmienna}: ${err.message}`);
        }
      }

      send(msg);
      done();
    });
  }

  RED.nodes.registerType('afya-librus', AfyaLibrusNode, {
    credentials: {
      login: { type: 'text' },
      haslo: { type: 'password' },
      hasloStrony: { type: 'password' },
      tokenStrony: { type: 'text' },
    },
  });
};
