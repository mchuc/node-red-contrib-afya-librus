# node-red-contrib-afya-librus

Węzeł Node-RED, który loguje się do dziennika **Librus Synergia**, czyta oceny
(opcjonalnie też uwagi) i mówi, **co jest nowego i za co**: kategoria, komentarz
nauczyciela, waga, średnia i wszystkie oceny z przedmiotu. Wynik od razu nadaje się
do bramki SMS. Nie potrzebuje Home Assistanta ani Pythona.

```
[inject co 1 h] → [librus oceny] → [switch: payload.tekst niepusty] → [SMS sender]
```

Przykładowy SMS:

```
Librus Kowalski Jaś: 4[1](2) z Matematyka (Kartkówka) | oceny: 5(3), 3-(2), +, 4[1](2)
Librus Kowalski Jaś: uwaga negatywna – Brak zadania domowego (Testowa Anna)
```

Oceny są zapisane jak w dzienniku: `ocena(waga)`. Poprawiona ocena ma postać `po[przed]`,
np. `4[1](2)` oznacza 4 po poprawie z 1, z wagą 2.

## Instalacja

Wymagania: Node.js ≥ 18.17, Node-RED ≥ 3.

```bash
cd ~/.node-red
npm install /ścieżka/do/node-red-contrib-afya-librus
# albo prosto z GitHuba:
npm install github:mchuc/node-red-contrib-afya-librus
```

Potem zrestartuj Node-RED. Węzeł **librus oceny** pojawi się w palecie, w grupie *Afya*.

## Konfiguracja węzła

| Pole | Opis |
|---|---|
| Login, Hasło | Konto rodzica lub ucznia w Librusie. Zapisywane jako *credentials* Node-RED, więc nie trafiają do eksportu flow. |
| Tekst SMS | Szablon linii o nowej ocenie. Domyślnie: `Librus %uczen%: %zapis% z %przedmiot% (%kategoria%) %komentarz%` |
| bez polskich znaków | Zamienia ą→a, ł→l itd., więc SMS mieści 160 znaków zamiast 70. |
| dopisz wszystkie oceny z przedmiotu | Do każdej linii o ocenie dopisuje `\| oceny: 5(3), 3-(2), 4[1](2)` (bieżący semestr tego przedmiotu). |
| odczytuj też uwagi nauczyciela | Czyta stronę „Uwagi” i zgłasza nowe uwagi. |
| SMS – uwaga | Szablon linii o nowej uwadze. Domyślnie: `Librus %uczen%: uwaga %rodzaj% – %tresc% (%nauczyciel%)` |

Pola w szablonie oceny: `%zapis%` `%ocena%` `%przedmiot%` `%kategoria%` `%komentarz%` `%waga%`
`%data%` `%nauczyciel%` `%srednia%` `%tablica%` `%semestr%` `%uczen%`.

Pola w szablonie uwagi: `%tresc%` `%rodzaj%` `%kategoria%` `%nauczyciel%` `%data%` `%uczen%`.

## Użycie

Każda wiadomość na wejściu uruchamia jedno sprawdzenie. Gotowe flow znajdziesz w
**Menu → Import → Przykłady → node-red-contrib-afya-librus**:

* **librus-mqtt**: pełny schemat z harmonogramem i MQTT (opis niżej),
* **librus-sms**: najprostszy wariant (inject co 1 h → węzeł → debug).

Do bramki SMS przepuszczaj tylko wiadomości z niepustym `msg.payload.tekst`, np. węzłem
*switch* z regułą „is not empty”. Inaczej SMS wychodziłby przy każdym sprawdzeniu.

### Przykład „librus-mqtt”: harmonogram i MQTT

```
zegar 1: co 45 min ─► [tylko 7:00–15:00] ─┐
zegar 2: co 1 h, 15–21 ───────────────────┼─► [Librus – oceny] ─► librus/dane (retain)
test SMS (msg.test) ──────────────────────┘          │
                                                     └─► [coś nowego?] ─► [SMS jako JSON]  ─► librus/sms/json
                                                                       └─► [SMS jako tekst] ─► librus/sms/tekst
```

* **7:00–15:00**: sprawdzenie co 45 minut. Interwał 45 min jest ustawiony w zwykłym *inject*.
  Filtr godzin to krótka funkcja, w której godziny `OD`/`DO` zmienisz na górze kodu.
* **15:00–21:00**: sprawdzenie co godzinę (ostatnie o 21:00).
* **22:00–7:00**: brak sprawdzeń.
* Godziny są liczone wg strefy czasowej serwera Node-RED, więc ustaw `TZ=Europe/Warsaw`.

Tematy MQTT:

| Temat | Kiedy | Treść |
|---|---|---|
| `librus/dane` (retain) | po każdym sprawdzeniu | cały `msg.payload` (`ok`, `nowe`, `oceny`, `tablica`, `uwagi`…) albo `ok:false` z `blad` |
| `librus/sms/json` | tylko gdy coś nowego | wariant A: obiekt JSON dla bramki SMS |
| `librus/sms/tekst` | tylko gdy coś nowego | wariant B: zwykły tekst SMS |

Wariant A ma postać:

```json
{ "do": "48600000000", "tresc": "Librus Kowalski Jaś: 6(2) z Język polski (Wypracowanie)", "od": "DZIENNIK", "flash": false }
```

`do` to numer odbiorcy; kilka numerów oddziel przecinkami. `od` to nazwa nadawcy. Oba ustawisz
w węźle **SMS jako JSON**. Zostaw wariant, którego używa Twoja bramka SMS, a drugi usuń.
Po imporcie ustaw jeszcze login i hasło Librusa oraz adres brokera, a potem kliknij **test SMS**.

### Wyjście (`msg.payload`)

```json
{
  "ok": true,
  "czas": "2026-11-25T07:00:03.120Z",
  "uczen": "Kowalski Jaś",
  "klasa": "7 b",
  "nowe": [
    {
      "przedmiot": "Matematyka",
      "ocena": "4",
      "zapis": "4[1](2)",
      "przed": "1",
      "wartosc": 4,
      "kategoria": "Kartkówka",
      "komentarz": "",
      "data": "2026-11-17",
      "nauczyciel": "Testowa Anna",
      "waga": 2,
      "liczy": true,
      "semestr": 1,
      "typ": "biezaca",
      "zastapiona": false,
      "link": "https://synergia.librus.pl/przegladaj_oceny/szczegoly/5005",
      "id": "5005:4",
      "srednia": 4.07,
      "tablica": "5(3), 3-(2), +, 4[1](2)"
    }
  ],
  "tekst": "Librus Kowalski Jaś: 4[1](2) z Matematyka (Kartkówka) | oceny: 5(3), 3-(2), +, 4[1](2)",
  "pierwszyOdczyt": false,
  "oceny": [ "… wszystkie oceny w tym samym formacie …" ],
  "srednie": { "Matematyka": { "1": 4.07, "2": 4.5 } },
  "tablica": { "Matematyka": { "1": "5(3), 3-(2), +, 4[1](2)", "2": "4+(1)" } },
  "noweUwagi": [],
  "uwagi": [
    {
      "id": "3f1c9a0b7d2e",
      "tresc": "Pomoc przy organizacji apelu",
      "data": "2026-11-05",
      "nauczyciel": "Przykładowy Jan",
      "rodzaj": "pozytywna",
      "kategoria": "Aktywność"
    }
  ]
}
```

* `ok`: `true`, gdy odczyt się udał. Przy błędzie dostajesz `{ "ok": false, "czas": "…", "blad": "opis" }`.
* `nowe`: oceny, których nie było przy poprzednim sprawdzeniu.
* `tekst`: gotowy SMS, jedna linia na każdą nową ocenę i uwagę. Pusty, gdy nic nowego.
* `zapis`: ocena jak w dzienniku, np. `5(3)`, `4[1](2)` albo `+`.
* `przed`: ocena sprzed poprawy. `zastapiona: true` oznacza starą ocenę, którą uczeń poprawił.
  Taka ocena nie trafia do `nowe` ani do `tablica`, widać ją tylko w nawiasie.
* `typ`: `biezaca` (zwykła ocena) albo `koncowa` (przewidywana, śródroczna lub roczna, szczegóły w `kategoria`).
* `srednie`: średnia ważona ocen bieżących, które Librus liczy do średniej.
* `tablica`: wszystkie oceny bieżące przedmiotu w jednym napisie, osobno dla każdego semestru.
* `uwagi`, `noweUwagi`: pojawiają się tylko wtedy, gdy włączona jest opcja „odczytuj też uwagi”.

### Test SMS

Wyślij do węzła `msg.test = true`. Jeśli nie ma nowości, najnowsza ocena (i uwaga, jeśli są
włączone) zostanie podana jako nowa, więc od razu zobaczysz, czy SMS dochodzi. W przykładowym
flow jest do tego osobny *inject*.

### Jak wykrywane są nowości

Lista już widzianych ocen i uwag leży w pliku `~/.node-red/afya-librus/<id-węzła>.json`, więc
restart Node-RED nie powoduje duplikatów. Pierwsze uruchomienie tylko zapamiętuje stan
(`pierwszyOdczyt: true`), żeby nie wysłać SMS-a z całym rokiem ocen. Tak samo działa pierwsze
włączenie opcji uwag. Ocena jest rozpoznawana po numerze w Librusie i wartości, więc zmiana
wartości przez nauczyciela też zostanie zgłoszona.

## Ograniczenia

* Oceny opisowe w nowym układzie Librusa (klasy 1–3) nie są odczytywane.
* Konta z dodatkowym potwierdzeniem logowania (2FA) nie są obsługiwane.
* Węzeł czyta stronę WWW Synergii. Gdy Librus zmieni logowanie albo wygląd strony, może przestać
  działać. Dostaniesz wtedy `ok: false` z opisem błędu.

## Testy

```bash
npm install
npm test
```

Testy nie łączą się z Librusem. Używają atrapy serwera i syntetycznych stron z fikcyjnymi danymi.

## Skąd pomysł

Inspiracją była integracja [LibrusSynergiaHA](https://github.com/LukMaverick/LibrusSynergiaHA)
dla Home Assistanta (LukMaverick). Ten węzeł działa na innej zasadzie: sam łączy się z Synergią,
działa w Node-RED i jest napisany od zera w JavaScripcie.

Projekt nieoficjalny, niezwiązany z firmą Librus.

Licencja: [MIT](LICENSE).
