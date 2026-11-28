'use strict';
/**
 * Strona z ocenami serwowana przez węzeł (np. http://node-red:1880/librus/jas).
 *
 * Dostęp: hasło (formularz → ciasteczko HttpOnly z HMAC hasła, więc zmiana hasła
 * wylogowuje wszystkich) i/lub osobny token w linku ?token=… (bez logowania, np. na
 * lustrze lub tablecie). Bez hasła i tokenu strona się nie otwiera. Każda ścieżka
 * może należeć tylko do jednego węzła.
 */

const crypto = require('crypto');

const SCIEZKA = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/i;
const DNI_SESJI = 30;
const zajete = new Map(); // ścieżka → id węzła

// ------------------------------------------------------------------ pomocnicze

const esc = (v) =>
  String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z]);

const liczba = (v) => (typeof v === 'number' ? v.toFixed(2).replace('.', ',') : '');

function dataPl(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/** Krótka data pod oceną – miesiąc.dzień, bez roku (rok szkolny wiadomo jaki). */
function dataKrotka(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[1]}.${m[2]}` : '';
}

function czasPl(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Normalizuje ścieżkę z konfiguracji: „/librus/jas/” → „/librus/jas”; null, gdy niepoprawna. */
function normalizujSciezke(tekst) {
  const s = String(tekst || '').trim().replace(/^\/+|\/+$/g, '');
  return SCIEZKA.test(s) ? `/${s}` : null;
}

function tokenSesji(haslo, id) {
  return crypto.createHmac('sha256', String(haslo)).update(`afya-librus:${id}`).digest('base64url');
}

function rowne(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function ciasteczka(req) {
  const wynik = {};
  for (const para of String(req.headers.cookie || '').split(';')) {
    const i = para.indexOf('=');
    if (i > 0) wynik[para.slice(0, i).trim()] = decodeURIComponent(para.slice(i + 1).trim());
  }
  return wynik;
}

function czytajFormularz(req, limit = 4096) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let dane = '';
    req.on('data', (c) => {
      dane += c;
      if (dane.length > limit) req.destroy();
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(dane))));
    req.on('error', () => resolve({}));
  });
}

/** Kolor oceny / średniej: 5–6 zielony, 4 niebieski, 3 żółty, 1–2 czerwony, reszta szara. */
function klasaWartosci(w) {
  if (typeof w !== 'number') return 'x';
  if (w >= 4.5) return 'a';
  if (w >= 3.5) return 'b';
  if (w >= 2.5) return 'c';
  return 'd';
}

// ------------------------------------------------------------------ HTML

const STYL = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--tx:#1d2125;--tx2:#5f6870;--ln:#e3e6ea;--pop:#1d2125;--popt:#fff;
--a:#e3f4ea;--at:#17663a;--b:#e4effb;--bt:#174f86;--c:#fbf1d9;--ct:#7a5300;--d:#fbe5e4;--dt:#9b2420;--x:#eef0f2;--xt:#4b5560;--acc:#3e9c86}
@media (prefers-color-scheme:dark){:root{--bg:#121416;--card:#1b1e21;--tx:#e9ecef;--tx2:#9aa4ad;--ln:#2c3136;--pop:#e9ecef;--popt:#121416;
--a:#163525;--at:#8fdcae;--b:#152c44;--bt:#9cc8f5;--c:#3a2f12;--ct:#f2cf7e;--d:#3d1918;--dt:#f4a19d;--x:#262a2e;--xt:#b8c0c7}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:20px 16px 40px}
.card{background:var(--card);border:1px solid var(--ln);border-radius:14px;padding:18px 20px}
header{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.av{width:46px;height:46px;border-radius:50%;background:var(--b);color:var(--bt);display:flex;align-items:center;justify-content:center;font-weight:600}
h1{font-size:19px;margin:0;font-weight:600}.sub{color:var(--tx2);font-size:13px}
header nav{margin-left:auto;display:flex;gap:12px;font-size:13px}a{color:var(--acc)}
.warn{background:var(--c);color:var(--ct);border-radius:10px;padding:9px 12px;font-size:13px;margin-bottom:12px}
.tabs{display:flex;gap:6px;margin:6px 0 4px}.tabs label{padding:6px 14px;border-radius:999px;border:1px solid var(--ln);cursor:pointer;font-size:14px;color:var(--tx2)}
input[name=okres]{position:absolute;opacity:0;pointer-events:none}
#o1:checked~.tabs label[for=o1],#o2:checked~.tabs label[for=o2],#oR:checked~.tabs label[for=oR]{background:var(--tx);color:var(--card);border-color:var(--tx)}
#o1:focus-visible~.tabs label[for=o1],#o2:focus-visible~.tabs label[for=o2],#oR:focus-visible~.tabs label[for=oR]{outline:2px solid var(--acc)}
.okres{display:none}#o1:checked~.k1,#o2:checked~.k2,#oR:checked~.kR{display:block}
.r{display:grid;grid-template-columns:minmax(150px,240px) minmax(0,1fr);gap:8px 14px;align-items:center;padding:10px 0;border-top:1px solid var(--ln)}
.p{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.p b{font-weight:500}
.sr{font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px}
.oc{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.g{position:relative;display:inline-flex;align-items:baseline;padding:3px 9px;border:1.5px solid transparent;border-radius:7px;font-weight:600;cursor:default;outline:none}
.g sub{font-size:11px;font-weight:400;margin-left:1px}.g s{font-weight:400;opacity:.8;margin-left:1px;text-decoration:none}
.g.nl{background:transparent!important;border:1.5px dashed currentColor}.g.k{background:transparent!important;border:1.5px solid currentColor}
.g .t{display:none;position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);z-index:5;width:max-content;max-width:260px;
background:var(--pop);color:var(--popt);border-radius:8px;padding:7px 10px;font-size:12px;font-weight:400;line-height:1.45;white-space:normal;text-align:left}
.g:hover .t,.g:focus .t{display:block}.t i{opacity:.75;font-style:normal}
.gw{display:inline-flex;flex-direction:column;align-items:center;gap:1px}
.gw small{font-size:10px;line-height:1;color:var(--tx2);font-variant-numeric:tabular-nums}
.sep{width:1px;align-self:stretch;background:var(--ln);margin:0 4px}.empty{color:var(--tx2);font-size:13px}
.v-a{background:var(--a);color:var(--at)}.v-b{background:var(--b);color:var(--bt)}.v-c{background:var(--c);color:var(--ct)}.v-d{background:var(--d);color:var(--dt)}.v-x{background:var(--x);color:var(--xt)}
footer{color:var(--tx2);font-size:12px;margin-top:12px;line-height:1.6}
.login{max-width:360px;margin:12vh auto 0}.login input{width:100%;padding:10px 12px;border:1px solid var(--ln);border-radius:9px;background:var(--bg);color:var(--tx);font-size:15px}
.login button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:9px;background:var(--acc);color:#fff;font-size:15px;cursor:pointer}
.err{color:var(--dt);font-size:13px;margin-top:8px}
@media (max-width:600px){.r{grid-template-columns:1fr}header nav{display:none}}
`;

function szkielet(tytul, tresc, { odswiez = 0 } = {}) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
${odswiez ? `<meta http-equiv="refresh" content="${odswiez}">` : ''}<title>${esc(tytul)}</title><style>${STYL}</style></head>
<body><main>${tresc}</main></body></html>`;
}

function stronaLogowania({ tytul, blad = '' } = {}) {
  return szkielet(
    tytul,
    `<form class="card login" method="post">
<h1>${esc(tytul)}</h1><p class="sub">Podaj hasło do strony z ocenami.</p>
<input type="password" name="haslo" autocomplete="current-password" autofocus required aria-label="Hasło">
${blad ? `<p class="err">${esc(blad)}</p>` : ''}<button type="submit">Pokaż oceny</button></form>`,
  );
}

function komunikat(tytul, tresc) {
  return szkielet(tytul, `<div class="card login"><h1>${esc(tytul)}</h1><p class="sub">${esc(tresc)}</p></div>`);
}

function chip(o) {
  const nl = o.typ === 'biezaca' && !o.liczy;
  const klasa = `g v-${klasaWartosci(o.wartosc)}${o.typ !== 'biezaca' ? ' k' : nl ? ' nl' : ''}`;
  const szczegoly = [
    `<b>${esc(dataPl(o.data) || 'bez daty')}</b>`,
    esc(o.kategoria),
    o.waga !== null && o.waga !== undefined ? `waga ${esc(o.waga)}` : '',
    o.przed ? `poprawa z ${esc(o.przed)}` : '',
    o.nauczyciel ? `<i>${esc(o.nauczyciel)}</i>` : '',
    o.komentarz ? `„${esc(o.komentarz)}”` : '',
    nl ? '<i>nie liczy się do średniej</i>' : '',
  ].filter(Boolean);
  const krotka = dataKrotka(o.data);
  return `<span class="gw"><span class="${klasa}" tabindex="0">${esc(o.ocena)}${o.przed ? `<s>[${esc(o.przed)}]</s>` : ''}${
    o.waga !== null && o.waga !== undefined && o.typ === 'biezaca' ? `<sub>${esc(o.waga)}</sub>` : ''
  }<span class="t">${szczegoly.join('<br>')}</span></span>${krotka ? `<small>${krotka}</small>` : ''}</span>`;
}

function srednia(wartosc, zLibrusa) {
  if (typeof wartosc !== 'number') return '';
  const opis = zLibrusa ? 'średnia ważona z Librusa' : 'średnia ważona wyliczona z wag (Librus jej nie pokazuje)';
  return `<span class="sr v-${klasaWartosci(wartosc)}" title="${opis}">${liczba(wartosc)}${zLibrusa ? '' : '*'}</span>`;
}

/** Ocena końcowa roczna (przewidywana roczna / roczna) – ale nie „śródroczna”. */
const roczna = (kategoria) => /roczn/i.test(kategoria || '') && !/śr[oó]droczn/i.test(kategoria || '');

/** Wiersze jednego widoku: okres 1, okres 2 albo cały rok ('R'). */
function widok(dane, klucz) {
  const przedmioty = [...new Set((dane.oceny || []).map((o) => o.przedmiot))].sort((a, b) => a.localeCompare(b, 'pl'));
  const zLibrusa = dane.srednieLibrus || {};
  const wiersze = przedmioty.map((p) => {
    const wszystkie = dane.oceny.filter((o) => o.przedmiot === p && !o.zastapiona);
    const wOkresie = (o) => (klucz === 'R' ? true : o.semestr === klucz);
    const biezace = wszystkie.filter((o) => o.typ === 'biezaca' && wOkresie(o));
    const koncowe = wszystkie.filter((o) =>
      o.typ !== 'biezaca' && (klucz === 'R' ? roczna(o.kategoria) : o.semestr === klucz && !roczna(o.kategoria)),
    );
    const sr = (dane.srednie && dane.srednie[p] && dane.srednie[p][klucz]) ?? null;
    const lib = zLibrusa[p] && zLibrusa[p][klucz] !== undefined;

    let oceny = '';
    if (klucz === 'R') {
      const s1 = biezace.filter((o) => o.semestr === 1).map(chip).join('');
      const s2 = biezace.filter((o) => o.semestr !== 1).map(chip).join('');
      oceny = s1 + (s1 && s2 ? '<span class="sep" aria-hidden="true"></span>' : '') + s2;
    } else {
      oceny = biezace.map(chip).join('');
    }
    if (koncowe.length) oceny += `<span class="sep" aria-hidden="true"></span>${koncowe.map(chip).join('')}`;
    return `<div class="r"><div class="p"><b>${esc(p)}</b>${srednia(sr, lib)}</div><div class="oc">${
      oceny || '<span class="empty">brak ocen</span>'
    }</div></div>`;
  });
  return wiersze.join('') || '<p class="empty">Brak ocen.</p>';
}

/** Cała strona z ocenami. stan = { dane, czas, blad, czasBledu } */
function stronaOcen(stan, { tytul = '', nazwa = '', wyloguj = true } = {}) {
  const d = stan.dane;
  if (!d) {
    return komunikat(tytul || nazwa || 'Librus – oceny', stan.blad ? `Nie udało się jeszcze odczytać ocen: ${stan.blad}` : 'Oceny pojawią się po pierwszym sprawdzeniu Librusa.');
  }
  const okresy = (d.oceny || []).filter((o) => o.typ === 'biezaca').map((o) => o.semestr);
  const biezacy = okresy.includes(2) ? 2 : 1;
  const inicjaly = String(d.uczen || '?').split(/\s+/).map((s) => s[0] || '').join('').slice(0, 2).toUpperCase();
  const blad =
    stan.blad && (!stan.czas || stan.czasBledu > stan.czas)
      ? `<div class="warn">Ostatnie sprawdzenie (${esc(czasPl(stan.czasBledu))}) nie udało się: ${esc(stan.blad)}. Poniżej oceny z ${esc(czasPl(stan.czas))}.</div>`
      : '';
  const zaznacz = (k) => (k === biezacy ? ' checked' : '');
  return szkielet(
    tytul || `${d.uczen || 'Librus'} – oceny`,
    `<div class="card">
<header><div class="av" aria-hidden="true">${esc(inicjaly)}</div>
<div><h1>${esc(tytul || d.uczen || 'Uczeń')}</h1><div class="sub">${tytul && d.uczen ? `${esc(d.uczen)} · ` : ''}Klasa ${esc(d.klasa || '–')} · stan na ${esc(czasPl(stan.czas))}</div></div>
<nav><a href="https://synergia.librus.pl/przegladaj_oceny/uczen" target="_blank" rel="noopener noreferrer">Librus</a>${
      wyloguj ? '<a href="?wyloguj=1">Wyloguj</a>' : ''
    }</nav></header>
${blad}
<input type="radio" name="okres" id="o1"${zaznacz(1)}><input type="radio" name="okres" id="o2"${zaznacz(2)}><input type="radio" name="okres" id="oR"${zaznacz('R')}>
<div class="tabs" role="tablist"><label for="o1">Okres 1</label><label for="o2">Okres 2</label><label for="oR">Cały rok</label></div>
<section class="okres k1">${widok(d, 1)}</section><section class="okres k2">${widok(d, 2)}</section><section class="okres kR">${widok(d, 'R')}</section>
<footer>Pod oceną data (miesiąc.dzień); najedź na ocenę (albo dotknij), żeby zobaczyć szczegóły. Mała liczba przy ocenie to waga.
Ramka przerywana – ocena nie liczy się do średniej; pełna ramka – ocena przewidywana, śródroczna lub roczna.
Średnia ważona jest z Librusa; * – Librus jej nie pokazuje, więc wyliczona z wag.</footer></div>`,
    { odswiez: 900 },
  );
}

// ------------------------------------------------------------------ trasy HTTP

function wyslij(res, status, html, naglowki = {}) {
  res.status(status);
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    ...naglowki,
  });
  res.send(html);
}

function usunTrasy(router, sciezka) {
  if (!router || !Array.isArray(router.stack)) return;
  for (let i = router.stack.length - 1; i >= 0; i--) {
    const warstwa = router.stack[i];
    if (warstwa.route && warstwa.route.path === sciezka && warstwa.route._afyaLibrus) router.stack.splice(i, 1);
  }
}

/**
 * Rejestruje stronę węzła. Zwraca funkcję sprzątającą (na node.on('close')).
 * opcje: { sciezka, haslo, token, tytul, nazwa, stan: () => ({ dane, czas, blad, czasBledu }) }
 *   haslo – formularz logowania + ciasteczko sesji na 30 dni,
 *   token – wejście bez logowania z linku ?token=… (np. lustro / tablet na ścianie).
 * Bez hasła i bez tokenu strona jest wyłączona.
 */
function zarejestrujStrone(RED, node, { sciezka, haslo = '', token = '', tytul = '', nazwa = '', stan }) {
  if (!RED.httpNode) throw new Error('no Node-RED HTTP server (is httpNodeRoot disabled?)');
  const wlasciciel = zajete.get(sciezka);
  if (wlasciciel && wlasciciel !== node.id) throw new Error(`path ${sciezka} is already used by another node`);
  zajete.set(sciezka, node.id);

  const naglowek = tytul || nazwa || 'Librus – oceny';
  const ciastko = `afya_librus_${String(node.id).replace(/[^a-z0-9]/gi, '')}`;
  const sesja = haslo ? tokenSesji(haslo, node.id) : '';
  const nieudane = new Map(); // ip → { ile, od }
  const OKNO = 15 * 60 * 1000;

  const zablokowany = (ip) => {
    const n = nieudane.get(ip);
    return !!n && Date.now() - n.od < OKNO && n.ile >= 10;
  };
  const porazka = (ip, co) => {
    const n = nieudane.get(ip);
    const teraz = Date.now();
    nieudane.set(ip, n && teraz - n.od < OKNO ? { ile: n.ile + 1, od: n.od } : { ile: 1, od: teraz });
    node.warn(`Page ${sciezka}: wrong ${co} (${ip})`);
    return new Promise((r) => setTimeout(r, 800));
  };
  const zalogowany = (req) => !!sesja && rowne(ciasteczka(req)[ciastko] || '', sesja);
  const ciasteczko = (req, wartosc, wiek) => {
    const https = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    return `${ciastko}=${wartosc}; Path=/; Max-Age=${wiek}; HttpOnly; SameSite=Strict${https ? '; Secure' : ''}`;
  };
  const wylaczona = (res) =>
    wyslij(res, 503, komunikat(naglowek, 'Strona jest wyłączona: ustaw hasło strony albo token w konfiguracji węzła.'));
  const tylkoLink = (res, status = 401) =>
    wyslij(res, status, komunikat(naglowek, 'Ta strona otwiera się tylko z linku z tokenem.'));

  const get = async (req, res) => {
    if (!haslo && !token) return wylaczona(res);
    const ip = req.ip || '?';
    const q = req.query || {};

    if (q.token !== undefined) {
      if (zablokowany(ip)) return wyslij(res, 429, komunikat(naglowek, 'Za dużo prób. Spróbuj za kilkanaście minut.'));
      if (token && rowne(String(q.token), token)) {
        nieudane.delete(ip);
        return wyslij(res, 200, stronaOcen(stan(), { tytul, nazwa, wyloguj: false }));
      }
      await porazka(ip, 'token');
      return haslo
        ? wyslij(res, 401, stronaLogowania({ tytul: naglowek, blad: 'Nieprawidłowy token w linku.' }))
        : tylkoLink(res);
    }
    if (q.wyloguj !== undefined) {
      return wyslij(res, 303, '', { Location: req.baseUrl + req.path, 'Set-Cookie': ciasteczko(req, '', 0) });
    }
    if (zalogowany(req)) return wyslij(res, 200, stronaOcen(stan(), { tytul, nazwa }));
    return haslo ? wyslij(res, 200, stronaLogowania({ tytul: naglowek })) : tylkoLink(res);
  };

  const post = async (req, res) => {
    if (!haslo && !token) return wylaczona(res);
    if (!haslo) return tylkoLink(res, 403);
    const ip = req.ip || '?';
    if (zablokowany(ip)) {
      return wyslij(res, 429, stronaLogowania({ tytul: naglowek, blad: 'Za dużo prób. Spróbuj za kilkanaście minut.' }));
    }
    const formularz = await czytajFormularz(req);
    if (rowne(formularz.haslo || '', haslo)) {
      nieudane.delete(ip);
      return wyslij(res, 303, '', {
        Location: req.baseUrl + req.path,
        'Set-Cookie': ciasteczko(req, sesja, DNI_SESJI * 24 * 3600),
      });
    }
    await porazka(ip, 'password');
    return wyslij(res, 401, stronaLogowania({ tytul: naglowek, blad: 'Nieprawidłowe hasło.' }));
  };

  RED.httpNode.get(sciezka, get);
  RED.httpNode.post(sciezka, post);
  const router = RED.httpNode._router || RED.httpNode.router;
  if (router && Array.isArray(router.stack)) {
    router.stack.forEach((w) => {
      if (w.route && w.route.path === sciezka && (w.route.stack || []).some((s) => s.handle === get || s.handle === post)) {
        w.route._afyaLibrus = true;
      }
    });
  }

  return () => {
    usunTrasy(RED.httpNode._router || RED.httpNode.router, sciezka);
    if (zajete.get(sciezka) === node.id) zajete.delete(sciezka);
  };
}

module.exports = { zarejestrujStrone, normalizujSciezke, stronaOcen, stronaLogowania, tokenSesji, esc };
