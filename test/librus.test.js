'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsujOceny,
  parsujInformacje,
  policzSrednie,
  wartoscOceny,
  tekstSms,
  pobierzOceny,
  zbudujTablice,
  parsujUwagi,
} = require('../lib/librus');

const { HTML_OCENY, HTML_INFO, HTML_UWAGI, atrapaLibrusa } = require('./fixtures/atrapa');

// ------------------------------------------------------------------ parser

test('parsuje oceny z tabeli (kolumny wg nagłówka, pomija zachowanie i szczegóły)', () => {
  const oceny = parsujOceny(HTML_OCENY);
  assert.deepEqual(
    oceny.map((o) => `${o.przedmiot}|${o.ocena}|s${o.semestr}|${o.typ}`),
    [
      'Matematyka|5|s1|biezaca',
      'Matematyka|3-|s1|biezaca',
      'Matematyka|+|s1|biezaca',
      'Matematyka|1|s1|biezaca',
      'Matematyka|4|s1|biezaca',
      'Matematyka|4|s1|koncowa',
      'Matematyka|4+|s2|biezaca',
      'Język polski|6|s2|biezaca',
    ],
  );

  const sprawdzian = oceny[0];
  assert.equal(sprawdzian.id, '5001:5');
  assert.equal(sprawdzian.kategoria, 'Sprawdzian');
  assert.equal(sprawdzian.komentarz, 'Funkcja liniowa');
  assert.equal(sprawdzian.data, '2026-10-06');
  assert.equal(sprawdzian.nauczyciel, 'Testowa Anna');
  assert.equal(sprawdzian.waga, 3);
  assert.equal(sprawdzian.liczy, true);
  assert.equal(sprawdzian.wartosc, 5);
  assert.equal(sprawdzian.link, 'https://synergia.librus.pl/przegladaj_oceny/szczegoly/5001');

  assert.equal(oceny[2].liczy, false); // aktywność „+”
  assert.equal(oceny[2].waga, null);
  // poprawa: [1 4] – „1” zastąpiona, „4” pamięta ocenę sprzed poprawy
  assert.equal(oceny[3].zastapiona, true);
  assert.equal(oceny[3].liczy, false); // Librus nie daje „Licz do średniej” przy zastąpionej
  assert.equal(oceny[4].przed, '1');
  assert.equal(oceny[4].zapis, '4[1](2)');
  assert.equal(sprawdzian.zapis, '5(3)');
  assert.equal(oceny[2].zapis, '+');
  assert.equal(oceny[5].kategoria, 'przewidywana śródroczna');
  assert.equal(oceny[7].komentarz, 'Rozprawka: „Lalka” – bardzo dobra argumentacja');
});

test('działa też bez kolumny ocen przewidywanych (inny colspan okresów)', () => {
  const html = HTML_OCENY.replace('colspan="4" class="colspan center"><span>Okres 1', 'colspan="3" class="colspan center"><span>Okres 1')
    .replace('<td class="no-border-top">(I)</td>', '')
    .replace(/<td class="center"><span class="grade-box"><a class="ocena" href="\/przegladaj_oceny\/szczegoly\/5006"[^]*?<\/td>/, '');
  const oceny = parsujOceny(html);
  const ustna = oceny.find((o) => o.ocena === '4+');
  assert.equal(ustna.semestr, 2);
  assert.equal(oceny.find((o) => o.przedmiot === 'Język polski').semestr, 2);
  assert.equal(oceny.filter((o) => o.typ === 'koncowa').length, 0);
});

test('bez nagłówka semestr wynika z daty', () => {
  const html = HTML_OCENY.replace(/<thead>[^]*?<\/thead>/, '');
  const oceny = parsujOceny(html);
  assert.equal(oceny.find((o) => o.id === '5001:5').semestr, 1);
  assert.equal(oceny.find((o) => o.id === '5101:6').semestr, 2);
});

test('błędy strony: brak dostępu i brak tabeli', () => {
  assert.throws(() => parsujOceny('<h2 class="inside">Brak dostępu</h2>'), /brak dostępu/);
  assert.throws(() => parsujOceny('<html><body><p>coś innego</p></body></html>'), /nie znaleziono tabeli/);
});

test('wartości ocen i średnie ważone', () => {
  assert.equal(wartoscOceny('4+'), 4.5);
  assert.equal(wartoscOceny('3-'), 2.75);
  assert.equal(wartoscOceny('np'), null);
  const srednie = policzSrednie(parsujOceny(HTML_OCENY));
  // (5*3 + 2.75*2 + 4*2) / 7 = 4.07 ; „+”, poprawiona „1” i ocena przewidywana się nie liczą
  assert.deepEqual(srednie, { Matematyka: { 1: 4.07, 2: 4.5 }, 'Język polski': { 2: 6 } });
});

test('zestawienie ocen przedmiotu: ocena(waga), poprawa jako po[przed]', () => {
  assert.deepEqual(zbudujTablice(parsujOceny(HTML_OCENY)), {
    Matematyka: { 1: '5(3), 3-(2), +, 4[1](2)', 2: '4+(1)' },
    'Język polski': { 2: '6(2)' },
  });
});

test('poprawa rozpoznana także z opisu oceny („Poprawa oceny: …”)', () => {
  const html = HTML_OCENY.replace('Waga: 1&lt;br&gt;Dodał: Testowa Anna&lt;br/&gt;">4+', 'Waga: 1&lt;br&gt;Dodał: Testowa Anna&lt;br/&gt;Poprawa oceny: 2 (Odpowiedź)&lt;br/&gt;">4+');
  assert.equal(parsujOceny(html).find((o) => o.ocena === '4+').zapis, '4+[2](1)');
});

test('uwagi nauczyciela', () => {
  const uwagi = parsujUwagi(HTML_UWAGI);
  assert.equal(uwagi.length, 2);
  assert.deepEqual(
    { ...uwagi[0], id: undefined },
    {
      id: undefined,
      tresc: 'Rozmawiał na lekcji mimo upomnień',
      data: '2026-10-14',
      nauczyciel: 'Testowa Anna',
      rodzaj: 'negatywna',
      kategoria: 'Zachowanie na lekcji',
    },
  );
  assert.match(uwagi[0].id, /^[0-9a-f]{12}$/);
  assert.notEqual(uwagi[0].id, uwagi[1].id);
  assert.deepEqual(parsujUwagi('<div class="container border-red">Brak uwag</div>'), []);
});

test('informacje o uczniu', () => {
  assert.deepEqual(parsujInformacje(HTML_INFO), { uczen: 'Kowalski Jaś', klasa: '7 b' });
});

test('tekst SMS z szablonu, opcjonalnie bez polskich znaków', () => {
  const o = { ocena: '5', zapis: '5(3)', przedmiot: 'Język polski', kategoria: 'Sprawdzian', komentarz: '', waga: 3, srednia: 4.75 };
  assert.equal(tekstSms(undefined, o, 'Jaś'), 'Librus Jaś: 5(3) z Język polski (Sprawdzian)');
  assert.equal(
    tekstSms('%uczen%: %ocena% z %przedmiot%, śr. %srednia% %nieznane%', o, 'Żaneta Łącka', true),
    'Zaneta Lacka: 5 z Jezyk polski, sr. 4.75 %nieznane%',
  );
});

// ------------------------------------------------------------------ logowanie (atrapa serwerów Librusa)

test('logowanie i pobranie ocen (pełny przebieg)', async () => {
  const { fetch, log } = atrapaLibrusa();
  const wynik = await pobierzOceny('rodzic', 'tajne', { fetch });
  assert.equal(wynik.uczen, 'Kowalski Jaś');
  assert.equal(wynik.klasa, '7 b');
  assert.equal(wynik.oceny.length, 8);
  assert.equal(wynik.srednie.Matematyka[1], 4.07);
  assert.equal(wynik.uwagi, null); // uwagi tylko na życzenie
  const zUwagami = await pobierzOceny('rodzic', 'tajne', { fetch, uwagi: true });
  assert.equal(zUwagami.uwagi.length, 2);
  assert.ok(log.some((l) => l.startsWith('POST synergia.librus.pl/przegladaj_oceny/uczen')));
});

test('złe hasło i przerwa techniczna dają czytelny błąd', async () => {
  await assert.rejects(pobierzOceny('rodzic', 'zle', atrapaLibrusa()), /logowanie nieudane – Nieprawidłowy login lub hasło/);
  await assert.rejects(pobierzOceny('rodzic', 'tajne', atrapaLibrusa({ przerwa: true })), /przerwa techniczna – Prace serwisowe/);
});
