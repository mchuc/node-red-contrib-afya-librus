'use strict';
/**
 * Klient Librus Synergia: logowanie (konto rodzica / ucznia) i odczyt ocen.
 *
 * Niezależna implementacja w JavaScript – komunikuje się bezpośrednio
 * z synergia.librus.pl, bez Home Assistanta i bez Pythona.
 */

const crypto = require('crypto');
const cheerio = require('cheerio');

const SYNERGIA = 'https://synergia.librus.pl';
const API = 'https://api.librus.pl';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const TIMEOUT_MS = 30000;
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

const DOMYSLNY_SZABLON = '%uczen%: %zapis% z %przedmiot% (%kategoria%) %komentarz%';
const DOMYSLNY_SZABLON_UWAGI = '%uczen%: uwaga %rodzaj% – %tresc% (%nauczyciel%)';

// ------------------------------------------------------------------ sesja HTTP

/** Minimalna sesja HTTP: ciasteczka per domena + ręczne śledzenie przekierowań. */
class Sesja {
  constructor(fetchFn = globalThis.fetch) {
    this.fetch = fetchFn;
    this.ciasteczka = []; // { nazwa, wartosc, domena, tylkoHost }
  }

  cookieDla(url) {
    const host = new URL(url).hostname;
    return this.ciasteczka
      .filter((c) => host === c.domena || (!c.tylkoHost && host.endsWith('.' + c.domena)))
      .map((c) => `${c.nazwa}=${c.wartosc}`)
      .join('; ');
  }

  zapamietaj(url, res) {
    const host = new URL(url).hostname;
    const linie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const linia of linie) {
      const [para, ...atrybuty] = linia.split(';');
      const i = para.indexOf('=');
      if (i < 1) continue;
      const nazwa = para.slice(0, i).trim();
      const wartosc = para.slice(i + 1).trim();
      let domena = host;
      let tylkoHost = true;
      let wygaslo = false;
      for (const atr of atrybuty) {
        const j = atr.indexOf('=');
        const klucz = (j < 0 ? atr : atr.slice(0, j)).trim().toLowerCase();
        const wart = j < 0 ? '' : atr.slice(j + 1).trim();
        if (klucz === 'domain' && wart) {
          domena = wart.replace(/^\./, '').toLowerCase();
          tylkoHost = false;
        } else if (klucz === 'max-age' && Number(wart) <= 0) {
          wygaslo = true;
        } else if (klucz === 'expires' && Date.parse(wart) < Date.now()) {
          wygaslo = true;
        }
      }
      this.ciasteczka = this.ciasteczka.filter((c) => !(c.nazwa === nazwa && c.domena === domena));
      if (!wygaslo) this.ciasteczka.push({ nazwa, wartosc, domena, tylkoHost });
    }
  }

  ma(nazwa) {
    return this.ciasteczka.some((c) => c.nazwa === nazwa && c.wartosc);
  }

  /** Żądanie z ręcznym śledzeniem przekierowań – zbiera ciasteczka z każdego kroku. */
  async zadanie(url, { method = 'GET', body, headers = {} } = {}) {
    for (let skok = 0; skok < 10; skok++) {
      const cookie = this.cookieDla(url);
      let res;
      try {
        res = await this.fetch(url, {
          method,
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}), ...headers },
        });
      } catch (err) {
        const powod = err.name === 'TimeoutError' ? 'przekroczony czas' : (err.cause && err.cause.code) || err.message;
        throw new Error(`Librus: brak połączenia z ${new URL(url).hostname} (${powod})`);
      }
      this.zapamietaj(url, res);
      const dokad = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !dokad) return res;
      await res.arrayBuffer().catch(() => {});
      url = new URL(dokad, url).href;
      method = 'GET';
      body = undefined;
      headers = {};
    }
    throw new Error('Librus: za dużo przekierowań');
  }

  async html(url, opcje) {
    const res = await this.zadanie(url, opcje);
    const tekst = await res.text();
    if (!res.ok) throw new Error(`Librus: HTTP ${res.status} (${new URL(url).pathname})`);
    return tekst;
  }
}

// ------------------------------------------------------------------ logowanie

async function zaloguj(sesja, login, haslo) {
  const stan = await sesja.zadanie(API);
  if (stan.status === 503) {
    const j = await stan.json().catch(() => null);
    const opis = j && Array.isArray(j.Message) && j.Message[0] ? j.Message[0].description : '';
    throw new Error('Librus: przerwa techniczna' + (opis ? ` – ${opis}` : ''));
  }
  await stan.arrayBuffer().catch(() => {});

  // Start logowania przez portal rodzinny (ustawia ciasteczka na api.librus.pl)
  const start = await sesja.zadanie(`${SYNERGIA}/loguj/portalRodzina?v=${Math.floor(Date.now() / 1000)}`);
  await start.arrayBuffer().catch(() => {});

  const res = await sesja.zadanie(`${API}/OAuth/Authorization?client_id=46`, {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({ action: 'login', login, pass: haslo }).toString(),
  });
  const odp = await res.json().catch(() => null);
  if (!odp || odp.status === 'error') {
    const powod = odp && odp.errors && odp.errors[0] ? odp.errors[0].message : `HTTP ${res.status}`;
    throw new Error(`Librus: logowanie nieudane – ${powod}`);
  }

  // Dokończenie autoryzacji – przekierowanie do Synergii ustawia ciasteczka sesji dziennika
  const koniec = await sesja.zadanie(new URL(odp.goTo || '/OAuth/Authorization/2FA?client_id=46', API).href);
  await koniec.arrayBuffer().catch(() => {});

  if (!sesja.ma('DZIENNIKSID') || !sesja.ma('SDZIENNIKSID')) {
    throw new Error('Librus: brak sesji dziennika po zalogowaniu (Librus zmienił logowanie?)');
  }
}

// ------------------------------------------------------------------ parsowanie

const tekstKomorki = ($el) => $el.text().replace(/\s+/g, ' ').trim();

function sprawdzDostep($) {
  if (tekstKomorki($('h2.inside')).includes('Brak dostępu')) {
    throw new Error('Librus: brak dostępu – sesja wygasła lub konto nie ma wglądu w oceny');
  }
}

/** '5' → 5, '4+' → 4.5, '3-' → 2.75; '+', 'np', 'bz' itp. → null */
function wartoscOceny(ocena) {
  const m = /^([0-6])([+-])?$/.exec(String(ocena).trim());
  if (!m) return null;
  return Number(m[1]) + (m[2] === '+' ? 0.5 : m[2] === '-' ? -0.25 : 0);
}

/** Gdy strona nie ma nagłówka okresów: wrzesień–styczeń = 1, luty–sierpień = 2. */
function semestrZDaty(data) {
  const miesiac = Number(String(data).slice(5, 7));
  if (!miesiac) return null;
  return miesiac >= 9 || miesiac === 1 ? 1 : 2;
}

/**
 * Mapa kolumn tabeli ocen z dwuwierszowego nagłówka:
 *   wiersz 1: „Okres 1” / „Okres 2” / „Koniec roku” (colspan),
 *   wiersz 2: „Oceny bieżące”, „Śr.I”, „(I)”, „I”, …
 * Dzięki temu działa niezależnie od tego, czy szkoła pokazuje średnie
 * i oceny przewidywane (zmienna liczba kolumn).
 */
function mapaKolumn($, $tabela) {
  const wiersze = $tabela.children('thead').children('tr');
  const mapa = {};
  if (wiersze.length < 2) return mapa;

  const zajete = new Set();
  let kol = 0;
  wiersze.eq(0).children('th,td').each((_, c) => {
    const span = Number($(c).attr('colspan')) || 1;
    const tekst = tekstKomorki($(c)).toLowerCase();
    const semestr = /1|\bi\b/.test(tekst) ? 1 : /2|\bii\b|rok/.test(tekst) ? 2 : null;
    for (let k = kol; k < kol + span; k++) {
      mapa[k] = { semestr };
      if ((Number($(c).attr('rowspan')) || 1) > 1) zajete.add(k);
    }
    kol += span;
  });

  kol = 0;
  wiersze.eq(1).children('th,td').each((_, c) => {
    while (zajete.has(kol)) kol++;
    const etykieta = tekstKomorki($(c)).toLowerCase();
    const span = Number($(c).attr('colspan')) || 1;
    const typ = /bie[żz]/.test(etykieta) ? 'biezaca' : /^śr/.test(etykieta) ? 'srednia' : 'koncowa';
    for (let k = kol; k < kol + span; k++) mapa[k] = { ...(mapa[k] || {}), typ, etykieta };
    kol += span;
  });
  return mapa;
}

function ocenaZLinku($a, przedmiot, kolumna) {
  const href = $a.attr('href') || '';
  if (/zachowanie/i.test(href)) return null; // punkty z zachowania pomijamy

  const pola = {};
  for (const linia of ($a.attr('title') || '').split(/<br\s*\/?>/i)) {
    const i = linia.indexOf(':');
    if (i > 0) pola[linia.slice(0, i).trim().toLowerCase()] = linia.slice(i + 1).trim();
  }

  const ocena = $a.text().replace(/\s+/g, '');
  const data = ((pola['data'] || '').match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  const waga = pola['waga'] !== undefined && pola['waga'] !== '' ? Number(pola['waga']) : null;
  const kategoria = pola['kategoria'] || '';
  const nr = (href.match(/(\d+)\/?$/) || [])[1];

  return {
    id: `${nr || [przedmiot, data, kategoria].join('|')}:${ocena}`,
    przedmiot,
    ocena,
    wartosc: wartoscOceny(ocena),
    kategoria,
    komentarz: pola['komentarz'] || pola['opis'] || '',
    data,
    nauczyciel: pola['nauczyciel'] || '',
    waga: Number.isFinite(waga) ? waga : null,
    // Librus pomija to pole przy ocenach, które się nie liczą („+”, „np”, ocena zastąpiona poprawą)
    liczy: /^tak/i.test(pola['licz do średniej'] || ''),
    semestr: kolumna.semestr || semestrZDaty(data),
    typ: kolumna.typ || 'biezaca',
    przed: (pola['poprawa oceny'] || '').split('(')[0].trim(), // ocena sprzed poprawy
    zastapiona: false, // true = stara ocena, którą uczeń poprawił
    link: href ? new URL(href, SYNERGIA).href : '',
  };
}

/** Zapis jak w dzienniku: ocena[przed poprawą](waga), np. „5(3)”, „4[1](2)”, „+”. */
function zapisOceny(o) {
  return `${o.ocena}${o.przed ? `[${o.przed}]` : ''}${o.waga !== null ? `(${o.waga})` : ''}`;
}

/** Klucz średniej z etykiety kolumny: „Śr.I” → 1, „Śr.II” → 2, „Śr.R” → 'R'. */
function kluczSredniej(kolumna) {
  const e = String(kolumna.etykieta || '').replace(/\s+/g, '');
  if (/r$/.test(e)) return 'R';
  if (/ii$/.test(e)) return 2;
  if (/i$/.test(e)) return 1;
  return kolumna.semestr || null;
}

/**
 * HTML strony „Oceny ucznia” → { oceny, srednieLibrus }.
 * srednieLibrus – średnie dokładnie tak, jak pokazuje je Librus (kolumny Śr.I / Śr.II / Śr.R):
 * { "Matematyka": { "1": 4.25, "R": 4.4 } }. Pusto, gdy szkoła wyłączyła podgląd średnich.
 */
function czytajTabeleOcen(html) {
  const $ = cheerio.load(html);
  sprawdzDostep($);

  const oceny = [];
  const srednieLibrus = {};
  let znalezionoTabele = false;

  $('table').each((_, tabela) => {
    const $tabela = $(tabela);
    if ($tabela.parents('tr[id]').length) return; // tabelki w rozwijanych szczegółach przedmiotu
    const wiersze = $tabela
      .children('tbody')
      .children('tr')
      .filter((_, tr) => !$(tr).attr('id') && $(tr).children('td').first().hasClass('screen-only'));
    if (!wiersze.length) return;
    znalezionoTabele = true;

    const kolumny = mapaKolumn($, $tabela);
    wiersze.each((_, tr) => {
      const komorki = $(tr).children('td');
      const przedmiot = tekstKomorki(komorki.eq(1));
      let kol = 0;
      komorki.each((_, td) => {
        const start = kol;
        kol += Number($(td).attr('colspan')) || 1;
        if (start < 2) return; // rozwijanie + nazwa przedmiotu

        const kolumna = kolumny[start] || {};
        if (kolumna.typ === 'srednia' && !$(td).find('span.grade-box').length) {
          const m = /(\d+(?:[.,]\d+)?)/.exec(tekstKomorki($(td)));
          const klucz = kluczSredniej(kolumna);
          if (m && klucz) {
            srednieLibrus[przedmiot] = srednieLibrus[przedmiot] || {};
            srednieLibrus[przedmiot][klucz] = Number(m[1].replace(',', '.'));
          }
          return;
        }

        // Poprawa wygląda tak: <span>[ <grade-box>1</grade-box> <grade-box>4</grade-box> ]</span>
        // – ostatnia ocena w nawiasie jest aktualna, wcześniejsze zostały poprawione.
        const poprawy = new Map();
        $(td)
          .find('span.grade-box > a')
          .each((_, a) => {
            const o = ocenaZLinku($(a), przedmiot, kolumny[start] || {});
            if (!o) return;
            oceny.push(o);
            const $nawias = $(a).parent().parent();
            if ($nawias.is('span') && $nawias.children('span.grade-box').length > 1) {
              const el = $nawias.get(0);
              if (!poprawy.has(el)) poprawy.set(el, []);
              poprawy.get(el).push(o);
            }
          });
        for (const grupa of poprawy.values()) {
          const poprzednie = grupa.slice(0, -1);
          poprzednie.forEach((p) => (p.zastapiona = true));
          grupa[grupa.length - 1].przed = poprzednie.map((p) => p.ocena).join(',');
        }
      });
    });
  });

  if (!znalezionoTabele) {
    throw new Error('Librus: nie znaleziono tabeli ocen (zmienił się wygląd strony?)');
  }
  oceny.forEach((o) => (o.zapis = zapisOceny(o)));
  return { oceny, srednieLibrus };
}

/** HTML strony „Oceny ucznia” → płaska lista ocen. */
function parsujOceny(html) {
  return czytajTabeleOcen(html).oceny;
}

/**
 * Zestawienie ocen bieżących przedmiotu, jak w dzienniku:
 * { "Matematyka": { "1": "5(3), 3-(2), +, 4[1](2)" } }
 * Oceny zastąpione poprawą są widoczne tylko w nawiasie kwadratowym.
 */
function zbudujTablice(oceny) {
  const wynik = {};
  for (const o of oceny) {
    if (o.typ !== 'biezaca' || o.zastapiona || !o.semestr) continue;
    wynik[o.przedmiot] = wynik[o.przedmiot] || {};
    const sem = wynik[o.przedmiot];
    sem[o.semestr] = sem[o.semestr] ? `${sem[o.semestr]}, ${o.zapis}` : o.zapis;
  }
  return wynik;
}

/**
 * HTML strony „Uwagi” → lista { id, tresc, data, nauczyciel, rodzaj, kategoria }.
 * Kolumny rozpoznawane po nagłówku (Uwaga | Data | Kto dodał | Rodzaj uwagi | Kategoria).
 */
function parsujUwagi(html) {
  const $ = cheerio.load(html);
  sprawdzDostep($);
  const uwagi = [];
  const rozpoznaj = (naglowek) => {
    const n = naglowek.toLowerCase();
    if (n.includes('rodzaj')) return 'rodzaj';
    if (n.includes('kategoria')) return 'kategoria';
    if (n.startsWith('data')) return 'data';
    if (/kto|nauczyciel|doda/.test(n)) return 'nauczyciel';
    if (/uwaga|treść|tresc|opis/.test(n)) return 'tresc';
    return null;
  };

  $('table').each((_, tabela) => {
    const naglowek = $(tabela).children('thead').children('tr').first().children('td,th');
    const klucze = naglowek.map((_, c) => rozpoznaj(tekstKomorki($(c)))).get();
    if (!klucze.includes('tresc') || !klucze.includes('data')) return;

    $(tabela)
      .children('tbody')
      .children('tr')
      .each((_, tr) => {
        const komorki = $(tr).children('td');
        if (komorki.length < 3) return; // np. wiersz „Okres 1”
        const u = { tresc: '', data: '', nauczyciel: '', rodzaj: '', kategoria: '' };
        komorki.each((i, td) => {
          if (klucze[i]) u[klucze[i]] = tekstKomorki($(td));
        });
        if (!u.tresc) return;
        const id = crypto.createHash('sha1').update([u.data, u.nauczyciel, u.tresc].join('|')).digest('hex').slice(0, 12);
        uwagi.push({ id, ...u });
      });
  });
  return uwagi;
}

/** HTML strony „Informacja” → { uczen, klasa } */
function parsujInformacje(html) {
  const $ = cheerio.load(html);
  sprawdzDostep($);
  const wynik = { uczen: '', klasa: '' };
  $('table.decorated tr').each((_, tr) => {
    const etykieta = tekstKomorki($(tr).children('th').first()).toLowerCase();
    const wartosc = tekstKomorki($(tr).children('td').first());
    if (!wynik.uczen && etykieta.startsWith('uczeń')) wynik.uczen = wartosc;
    if (!wynik.klasa && etykieta.startsWith('klasa')) wynik.klasa = wartosc;
  });
  return wynik;
}

/** Średnia ważona ocen bieżących liczonych do średniej: { przedmiot: { 1: 4.33, 2: 5 } } */
function policzSrednie(oceny) {
  const sumy = {};
  for (const o of oceny) {
    if (o.typ !== 'biezaca' || !o.liczy || o.wartosc === null || !o.semestr) continue;
    const waga = o.waga === null ? 1 : o.waga;
    if (!waga) continue;
    sumy[o.przedmiot] = sumy[o.przedmiot] || {};
    const s = (sumy[o.przedmiot][o.semestr] = sumy[o.przedmiot][o.semestr] || { suma: 0, wagi: 0 });
    s.suma += o.wartosc * waga;
    s.wagi += waga;
  }
  const wynik = {};
  for (const [przedmiot, semestry] of Object.entries(sumy)) {
    wynik[przedmiot] = {};
    for (const [nr, s] of Object.entries(semestry)) {
      wynik[przedmiot][nr] = Math.round((s.suma / s.wagi) * 100) / 100;
    }
  }
  return wynik;
}

/** Średnia ważona z całego roku (oba okresy): { przedmiot: 4.13 } – gdy Librus jej nie pokazuje. */
function policzSrednieRoczne(oceny) {
  const sumy = {};
  for (const o of oceny) {
    if (o.typ !== 'biezaca' || !o.liczy || o.wartosc === null) continue;
    const waga = o.waga === null ? 1 : o.waga;
    if (!waga) continue;
    const s = (sumy[o.przedmiot] = sumy[o.przedmiot] || { suma: 0, wagi: 0 });
    s.suma += o.wartosc * waga;
    s.wagi += waga;
  }
  const wynik = {};
  for (const [przedmiot, s] of Object.entries(sumy)) wynik[przedmiot] = Math.round((s.suma / s.wagi) * 100) / 100;
  return wynik;
}

/**
 * Średnie do użycia: najpierw te pokazane przez Librusa (jego wagi i ustawienia szkoły),
 * a tam, gdzie Librus średniej nie pokazuje – wyliczona z wag ocen. Klucze: 1, 2, R.
 */
function scalSrednie(oceny, srednieLibrus = {}) {
  const wynik = {};
  for (const [przedmiot, sem] of Object.entries(policzSrednie(oceny))) wynik[przedmiot] = { ...sem };
  for (const [przedmiot, sr] of Object.entries(policzSrednieRoczne(oceny))) {
    wynik[przedmiot] = wynik[przedmiot] || {};
    wynik[przedmiot].R = sr;
  }
  for (const [przedmiot, sem] of Object.entries(srednieLibrus)) {
    wynik[przedmiot] = { ...(wynik[przedmiot] || {}), ...sem };
  }
  return wynik;
}

// ------------------------------------------------------------------ tekst SMS

const POLSKIE = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

function bezPolskichZnakow(tekst) {
  return tekst.replace(/[ąćęłńóśźż]/gi, (z) => {
    const m = POLSKIE[z.toLowerCase()];
    return z === z.toLowerCase() ? m : m.toUpperCase();
  });
}

/** Podstawia %pola% oceny lub uwagi w szablonie (np. %zapis%, %przedmiot%, %tresc%). */
function tekstSms(szablon, ocena, uczen = '', bezPl = false) {
  const pola = { ...ocena, uczen };
  const tekst = (szablon || DOMYSLNY_SZABLON)
    .replace(/%(\w+)%/g, (cale, klucz) =>
      klucz in pola ? (pola[klucz] === null || pola[klucz] === undefined ? '' : String(pola[klucz])) : cale,
    )
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return bezPl ? bezPolskichZnakow(tekst) : tekst;
}

// ------------------------------------------------------------------ całość

/**
 * Zaloguj się i pobierz oceny (opcjonalnie także uwagi).
 * @returns {Promise<{uczen, klasa, oceny, srednie, tablica, uwagi}>} uwagi = null, gdy nie czytano
 */
async function pobierzOceny(login, haslo, { fetch, uwagi = false } = {}) {
  const sesja = new Sesja(fetch);
  await zaloguj(sesja, login, haslo);

  const html = await sesja.html(`${SYNERGIA}/przegladaj_oceny/uczen`, {
    method: 'POST',
    headers: FORM,
    body: 'zmiany_logowanie_wszystkie=1',
  });
  const { oceny, srednieLibrus } = czytajTabeleOcen(html);

  let info = { uczen: '', klasa: '' };
  try {
    info = parsujInformacje(await sesja.html(`${SYNERGIA}/informacja`));
  } catch (_) {
    // dane ucznia są tylko dodatkiem – brak nie blokuje ocen
  }

  return {
    uczen: info.uczen,
    klasa: info.klasa,
    oceny,
    srednie: scalSrednie(oceny, srednieLibrus),
    srednieLibrus,
    tablica: zbudujTablice(oceny),
    uwagi: uwagi ? parsujUwagi(await sesja.html(`${SYNERGIA}/uwagi`)) : null,
  };
}

module.exports = {
  DOMYSLNY_SZABLON,
  DOMYSLNY_SZABLON_UWAGI,
  pobierzOceny,
  parsujOceny,
  czytajTabeleOcen,
  scalSrednie,
  parsujUwagi,
  zbudujTablice,
  parsujInformacje,
  policzSrednie,
  wartoscOceny,
  tekstSms,
  bezPolskichZnakow,
  Sesja,
};
