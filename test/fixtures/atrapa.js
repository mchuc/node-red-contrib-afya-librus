'use strict';
// Atrapa serwerów Librusa do testów (bez sieci).
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML_OCENY = fs.readFileSync(path.join(__dirname, 'oceny.html'), 'utf8');
const HTML_INFO = `<html><body><table class="decorated big center"><tbody>
  <tr class="line0"><th>Uczeń</th><td>Kowalski Jaś</td></tr>
  <tr class="line1"><th>Klasa</th><td>7 b</td></tr>
</tbody></table></body></html>`;
const HTML_UWAGI = `<html><body><h2 class="inside">Uwagi</h2>
<table class="decorated big center">
  <thead><tr><td>Uwaga</td><td>Data</td><td>Kto dodał</td><td>Rodzaj uwagi</td><td>Kategoria</td></tr></thead>
  <tbody>
    <tr class="line0"><td colspan="5" class="center bolded">Okres 1</td></tr>
    <tr class="line1"><td>Rozmawiał na lekcji mimo upomnień</td><td class="small">2026-10-14</td><td>Testowa Anna</td><td>negatywna</td><td>Zachowanie na lekcji</td></tr>
    <tr class="line0"><td>Pomoc przy organizacji apelu</td><td class="small">2026-11-05</td><td>Przykładowy Jan</td><td>pozytywna</td><td>Aktywność</td></tr>
  </tbody>
  <tfoot><tr><td colspan="5">&nbsp;</td></tr></tfoot>
</table></body></html>`;

function atrapaLibrusa({ haslo = 'tajne', przerwa = false } = {}) {
  const log = [];
  const fetch = async (url, opcje = {}) => {
    const u = new URL(url);
    const cookie = (opcje.headers && opcje.headers.Cookie) || '';
    log.push(`${opcje.method || 'GET'} ${u.host}${u.pathname} [${cookie}]`);
    const odp = (status, body, naglowki = []) => new Response(body, { status, headers: new Headers(naglowki) });

    if (u.host === 'api.librus.pl' && u.pathname === '/') {
      return przerwa
        ? odp(503, JSON.stringify({ Message: [{ description: 'Prace serwisowe do 6:00' }] }))
        : odp(200, '{}');
    }
    if (u.pathname === '/loguj/portalRodzina') {
      return odp(302, null, [['location', 'https://api.librus.pl/OAuth/Authorization?client_id=46&response_type=code']]);
    }
    if (u.host === 'api.librus.pl' && u.pathname === '/OAuth/Authorization' && opcje.method === 'GET') {
      return odp(200, '<form></form>', [['set-cookie', 'apisid=abc; Path=/; HttpOnly']]);
    }
    if (u.host === 'api.librus.pl' && u.pathname === '/OAuth/Authorization' && opcje.method === 'POST') {
      assert.match(cookie, /apisid=abc/);
      const dane = new URLSearchParams(opcje.body);
      if (dane.get('pass') !== haslo) {
        return odp(403, JSON.stringify({ status: 'error', errors: [{ message: 'Nieprawidłowy login lub hasło.' }] }));
      }
      return odp(200, JSON.stringify({ status: 'ok', goTo: '/OAuth/Authorization/2FA?client_id=46' }));
    }
    if (u.pathname === '/OAuth/Authorization/2FA') {
      return odp(302, null, [['location', 'https://synergia.librus.pl/loguj/przekierowanie?code=xyz']]);
    }
    if (u.pathname === '/loguj/przekierowanie') {
      return odp(302, null, [
        ['location', '/uczen/index'],
        ['set-cookie', 'DZIENNIKSID=L01~sesja; path=/; HttpOnly'],
        ['set-cookie', 'SDZIENNIKSID=s2; path=/'],
      ]);
    }
    if (u.pathname === '/uczen/index') return odp(200, '<html></html>');
    if (u.pathname === '/przegladaj_oceny/uczen') {
      assert.match(cookie, /DZIENNIKSID=L01~sesja/);
      assert.doesNotMatch(cookie, /apisid/); // ciasteczko api.librus.pl nie leci do synergia
      return odp(200, HTML_OCENY);
    }
    if (u.pathname === '/informacja') return odp(200, HTML_INFO);
    if (u.pathname === '/uwagi') return odp(200, HTML_UWAGI);
    return odp(404, 'nie ma');
  };
  return { fetch, log };
}

module.exports = { HTML_OCENY, HTML_INFO, HTML_UWAGI, atrapaLibrusa };
