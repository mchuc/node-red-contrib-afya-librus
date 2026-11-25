'use strict';
const fs = require('fs');
const path = require('path');
const { pobierzOceny, tekstSms, DOMYSLNY_SZABLON, DOMYSLNY_SZABLON_UWAGI } = require('./lib/librus');

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
    const czytajUwagi = !!config.uwagi;
    // „dopisz oceny z przedmiotu” → do każdej linii SMS: „| oceny: 5(3), 3-(2), 4[1](2)”
    const szablon = (config.szablon || DOMYSLNY_SZABLON) + (config.zTablica ? ' | oceny: %tablica%' : '');
    const szablonUwagi = config.szablonUwagi || DOMYSLNY_SZABLON_UWAGI;
    // Lista już widzianych ocen – przetrwa restart Node-RED, więc nie będzie duplikatów SMS
    const plikStanu = path.join(RED.settings.userDir || process.cwd(), 'afya-librus', `${node.id}.json`);
    let trwa = false;

    node.on('input', async (msg, send, done) => {
      if (trwa) {
        node.warn('Poprzednie sprawdzenie Librusa jeszcze trwa – pomijam');
        return done();
      }
      trwa = true;
      node.status({ fill: 'blue', shape: 'dot', text: 'sprawdzam…' });
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
        if (msg.test && !nowe.length && biezace.length) nowe = [najnowszy(biezace)];
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

        zapiszStan(plikStanu, { widziane: [...widziane], widzianeUwagi, aktualizacja: czas });

        nowe = nowe.map((o) => {
          const sr = dane.srednie[o.przedmiot] && dane.srednie[o.przedmiot][o.semestr];
          const tab = dane.tablica[o.przedmiot] && dane.tablica[o.przedmiot][o.semestr];
          return { ...o, srednia: sr === undefined ? null : sr, tablica: tab || '' };
        });

        const linie = [
          ...nowe.map((o) => tekstSms(szablon, o, dane.uczen, bezPl)),
          ...noweUwagi.map((u) => tekstSms(szablonUwagi, u, dane.uczen, bezPl)),
        ];

        msg.payload = {
          ok: true,
          czas,
          uczen: dane.uczen,
          klasa: dane.klasa,
          nowe,
          tekst: linie.join('\n'),
          pierwszyOdczyt,
          oceny: dane.oceny,
          srednie: dane.srednie,
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
                text: `nowe oceny: ${nowe.length}${czytajUwagi ? `, uwagi: ${noweUwagi.length}` : ''} · ${godz}`,
              }
            : { fill: 'green', shape: 'dot', text: `ok, brak nowych · ${godz}` },
        );
      } catch (err) {
        msg.payload = { ok: false, czas, blad: err.message };
        node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 60) });
        node.warn(err.message);
      } finally {
        trwa = false;
      }

      send(msg);
      done();
    });
  }

  RED.nodes.registerType('afya-librus', AfyaLibrusNode, {
    credentials: {
      login: { type: 'text' },
      haslo: { type: 'password' },
    },
  });
};
