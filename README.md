# node-red-contrib-afya-librus

[![npm](https://img.shields.io/npm/v/node-red-contrib-afya-librus)](https://www.npmjs.com/package/node-red-contrib-afya-librus)
[![license: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Node-RED node for the Polish school register **Librus Synergia**: it reads the grades (optionally also
teacher notes) and tells you **what is new and what it is for** – category, teacher's comment, weight,
average and all grades of the subject. The result is ready for an SMS gateway. No Home Assistant, no Python.

**[English](#english) · [Polski](#polski)** · Example flow / przykładowy flow: [Librus → MQTT / SMS](https://flows.nodered.org/flow/09832a281a27aff8fee4d1ec3690ebd8)

---

## English

```
[inject every 1 h] → [librus grades] → [switch: payload.tekst not empty] → [SMS sender]
```

Example SMS (the text is Polish, as it goes to Polish parents):

```
Librus Kowalski Jaś: 4[1](2) z Matematyka (Kartkówka) | oceny: 5(3), 3-(2), +, 4[1](2)
Librus Kowalski Jaś: uwaga negatywna – Brak zadania domowego (Testowa Anna)
```

Grades are written as in the register: `grade(weight)`. An improved grade looks like `new[old]`,
e.g. `4[1](2)` = 4 after improving 1, weight 2.

### Install

Requires Node.js ≥ 18.17 and Node-RED ≥ 3.

```bash
cd ~/.node-red
npm install node-red-contrib-afya-librus
# or straight from GitHub:
npm install github:mchuc/node-red-contrib-afya-librus
```

Restart Node-RED. The node **librus grades** appears in the **AFYA** palette group.

### Configuration

| Field | Description |
|---|---|
| Login, Password | Parent or student account. Stored as Node-RED *credentials*, never exported with the flow. |
| New grade | SMS line template for a new grade. Default: `Librus %uczen%: %zapis% z %przedmiot% (%kategoria%) %komentarz%` |
| Append all grades of the subject | Adds `\| oceny: 5(3), 3-(2), 4[1](2)` (current semester of the subject) to each grade line. |
| Without Polish letters | Replaces ą→a, ł→l …, so one SMS holds 160 instead of 70 characters. |
| Also read teacher notes | Reads the “Uwagi” page and reports new notes. |
| New note | SMS line template for a new note. Default: `Librus %uczen%: uwaga %rodzaj% – %tresc% (%nauczyciel%)` |
| Variable | Optional: the last `msg.payload` is also stored in a **global** (readable from any flow) or **flow** context variable, e.g. `global.get("librus_john")`. |
| Show a web page with the grades | Turns on the grades page (see below). |
| Page path | Address of the page, e.g. `librus/john` → `http://<node-red>:1880/librus/john`. One path per child. |
| Page password | Password for the page. Required – without it the page stays off. Stored as credentials. |

Grade placeholders: `%zapis%` `%ocena%` `%przedmiot%` `%kategoria%` `%komentarz%` `%waga%` `%data%`
`%nauczyciel%` `%srednia%` `%tablica%` `%semestr%` `%uczen%`.
Note placeholders: `%tresc%` `%rodzaj%` `%kategoria%` `%nauczyciel%` `%data%` `%uczen%`.

### Usage

Every incoming message starts one check. Ready flows: **Menu → Import → Examples → node-red-contrib-afya-librus**:

* **librus-mqtt** – schedule (7:00–15:00 every 45 min, 15:00–21:00 hourly, no checks at night) and MQTT topics
  `librus/dane` (retained, full result), `librus/sms/json` and `librus/sms/tekst` (only when something is new),
* **librus-sms** – the simplest variant (inject every 1 h → node → debug).

The **librus-mqtt** flow is also in the Node-RED library: [Librus Synergia: new school grades & notes → MQTT / SMS](https://flows.nodered.org/flow/09832a281a27aff8fee4d1ec3690ebd8).

Pass only messages with a non-empty `msg.payload.tekst` to the SMS gateway (e.g. a *switch* node, rule
“is not empty”), otherwise an SMS would go out after every check. Set `TZ=Europe/Warsaw` for the schedule.

### Grades page

Each node can serve its own web page with the grades – one node, path and password per child
(e.g. `/librus/john` and `/librus/anna`):

* student and class at the top, tabs **Term 1 / Term 2 / Whole year** (the current term opens first),
* subjects in alphabetical order, the **weighted average right after the subject name**,
* the grades in order, coloured by value, with the weight as a small number – **hover or tap a grade** to see
  the date, category, weight, teacher and comment,
* dashed frame – the grade does not count to the average; solid frame – predicted / term / final grade,
* works on a phone and in dark mode, refreshes itself every 15 minutes.

The **average is taken from Librus** (columns Śr.I / Śr.II / Śr.R, so the school's own weights and
settings apply). If the school hides the averages, it is calculated from the Librus weights (`+` = +0.5,
`-` = −0.25, only grades with “Licz do średniej: tak”) and marked with `*`.

Access needs the page password: a login form, then a session cookie (`HttpOnly`, `SameSite=Strict`) for
30 days; changing the password logs everyone out, 10 wrong passwords in 15 minutes block the address for a while.
The page is served by Node-RED itself (under `httpNodeRoot`), so it is reachable wherever Node-RED is – put it
behind HTTPS / VPN when you open it to the internet. The last result is stored in
`~/.node-red/afya-librus/<node-id>.json`, so the page works right after a restart.

### Output (`msg.payload`)

Field names are Polish (unchanged since 1.0):

| Field | Meaning |
|---|---|
| `ok` | `true` – read successfully; on error `{ ok: false, czas, blad }` (`blad` = error text) |
| `nowe` | grades that were not there at the previous check (with subject average `srednia` and `tablica`) |
| `tekst` | ready SMS text, one line per new grade / note; empty when nothing is new |
| `oceny` | all grades: `przedmiot` (subject), `ocena` (grade), `zapis` (as in the register), `przed` (before improvement), `wartosc` (numeric value), `kategoria`, `komentarz`, `data`, `nauczyciel` (teacher), `waga` (weight), `liczy` (counts to average), `semestr`, `typ` (`biezaca` regular / `koncowa` predicted, semester or final), `zastapiona` (old, improved grade), `link`, `id` |
| `srednie` | weighted averages per term and year: `{ "Matematyka": { "1": 4.07, "2": 4.5, "R": 4.13 } }` – from Librus (Śr.I / Śr.II / Śr.R) or calculated from the Librus weights where the school hides them |
| `srednieLibrus` | only the averages Librus itself shows |
| `tablica` | all regular grades of a subject in one string, per semester |
| `uwagi`, `noweUwagi` | teacher notes (only with *Also read teacher notes*): `tresc`, `data`, `nauczyciel`, `rodzaj`, `kategoria`, `id` |
| `uczen`, `klasa` | student and class |
| `pierwszyOdczyt` | `true` on the very first check – grades are only remembered |
| `czas` | time of the check (ISO) |

### SMS test

Send `msg.test = true`. When nothing is new, the latest grade (and note) is reported as new, so you can check
the whole SMS path at once. The example flows have a separate *inject* for it.

### How new grades are detected

Seen grades and notes are saved in `~/.node-red/afya-librus/<node-id>.json`, so a restart does not cause
duplicates. The first check only remembers the state (`pierwszyOdczyt: true`) – no SMS with the whole year of
grades. Turning on notes later works the same way. A grade is recognised by its Librus number and value, so a
changed value is reported too.

### Limitations

* Descriptive grades in the new layout (classes 1–3) are not read.
* Accounts with two-factor login confirmation are not supported.
* The node reads the Synergia web pages – when Librus changes the login or the page layout, it may stop
  working; you then get `ok: false` with a description.

### Tests

```bash
npm install
npm test
```

Tests do not connect to Librus – they use a fake server and synthetic pages with fictional data.

### Credits

Inspired by [LibrusSynergiaHA](https://github.com/LukMaverick/LibrusSynergiaHA) for Home Assistant (LukMaverick).
This node works differently: it connects to Synergia itself, runs in Node-RED and is written from scratch in
JavaScript. Unofficial project, not affiliated with Librus.

---

## Polski

Węzeł Node-RED, który loguje się do dziennika **Librus Synergia**, czyta oceny
(opcjonalnie też uwagi) i mówi, **co jest nowego i za co**: kategoria, komentarz
nauczyciela, waga, średnia i wszystkie oceny z przedmiotu. Wynik od razu nadaje się
do bramki SMS. Nie potrzebuje Home Assistanta ani Pythona.

```
[inject co 1 h] → [librus grades] → [switch: payload.tekst niepusty] → [SMS sender]
```

Przykładowy SMS:

```
Librus Kowalski Jaś: 4[1](2) z Matematyka (Kartkówka) | oceny: 5(3), 3-(2), +, 4[1](2)
Librus Kowalski Jaś: uwaga negatywna – Brak zadania domowego (Testowa Anna)
```

Oceny są zapisane jak w dzienniku: `ocena(waga)`. Poprawiona ocena ma postać `po[przed]`,
np. `4[1](2)` oznacza 4 po poprawie z 1, z wagą 2.

### Instalacja

Wymagania: Node.js ≥ 18.17, Node-RED ≥ 3.

```bash
cd ~/.node-red
npm install /ścieżka/do/node-red-contrib-afya-librus
# albo prosto z GitHuba:
npm install github:mchuc/node-red-contrib-afya-librus
```

Potem zrestartuj Node-RED. Węzeł **librus grades** pojawi się w palecie, w grupie **AFYA**.

### Konfiguracja węzła

| Pole | Opis |
|---|---|
| Login, Password | Konto rodzica lub ucznia w Librusie. Zapisywane jako *credentials* Node-RED, więc nie trafiają do eksportu flow. |
| New grade | Szablon linii SMS o nowej ocenie. Domyślnie: `Librus %uczen%: %zapis% z %przedmiot% (%kategoria%) %komentarz%` |
| Without Polish letters | Zamienia ą→a, ł→l itd., więc SMS mieści 160 znaków zamiast 70. |
| Append all grades of the subject | Do każdej linii o ocenie dopisuje `\| oceny: 5(3), 3-(2), 4[1](2)` (bieżący semestr tego przedmiotu). |
| Also read teacher notes | Czyta stronę „Uwagi” i zgłasza nowe uwagi. |
| New note | Szablon linii SMS o nowej uwadze. Domyślnie: `Librus %uczen%: uwaga %rodzaj% – %tresc% (%nauczyciel%)` |
| Variable | Opcjonalnie: ostatni `msg.payload` trafia też do zmiennej **global** (dostępna z każdego flow) lub **flow**, np. `global.get("librus_jas")`. |
| Show a web page with the grades | Włącza stronę z ocenami (opis niżej). |
| Page path | Adres strony, np. `librus/jas` → `http://<node-red>:1880/librus/jas`. Każde dziecko – osobna ścieżka. |
| Page password | Hasło do strony. Wymagane – bez niego strona jest wyłączona. Zapisywane jako *credentials*. |

Pola w szablonie oceny: `%zapis%` `%ocena%` `%przedmiot%` `%kategoria%` `%komentarz%` `%waga%`
`%data%` `%nauczyciel%` `%srednia%` `%tablica%` `%semestr%` `%uczen%`.

Pola w szablonie uwagi: `%tresc%` `%rodzaj%` `%kategoria%` `%nauczyciel%` `%data%` `%uczen%`.

### Użycie

Każda wiadomość na wejściu uruchamia jedno sprawdzenie. Gotowe flow znajdziesz w
**Menu → Import → Przykłady → node-red-contrib-afya-librus**:

* **librus-mqtt**: pełny schemat z harmonogramem i MQTT (opis niżej),
* **librus-sms**: najprostszy wariant (inject co 1 h → węzeł → debug).

Flow **librus-mqtt** jest też w bibliotece Node-RED: [Librus Synergia: new school grades & notes → MQTT / SMS](https://flows.nodered.org/flow/09832a281a27aff8fee4d1ec3690ebd8).

Do bramki SMS przepuszczaj tylko wiadomości z niepustym `msg.payload.tekst`, np. węzłem
*switch* z regułą „is not empty”. Inaczej SMS wychodziłby przy każdym sprawdzeniu.

#### Przykład „librus-mqtt”: harmonogram i MQTT

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

#### Strona z ocenami

Każdy węzeł może pokazywać własną stronę z ocenami – osobny węzeł, ścieżka i hasło dla każdego dziecka
(np. `/librus/jas` i `/librus/ola`):

* na górze uczeń i klasa, zakładki **Okres 1 / Okres 2 / Cały rok** (otwiera się bieżący okres),
* przedmioty alfabetycznie, **średnia ważona zaraz po nazwie przedmiotu**,
* kolejne oceny w kolorach wg wartości, waga jako mała liczba – **po najechaniu albo dotknięciu** widać datę,
  kategorię, wagę, nauczyciela i komentarz,
* ramka przerywana – ocena nie liczy się do średniej; pełna ramka – ocena przewidywana, śródroczna lub roczna,
* działa na telefonie i w trybie ciemnym, sama odświeża się co 15 minut.

**Średnia jest brana z Librusa** (kolumny Śr.I / Śr.II / Śr.R, więc obowiązują wagi i ustawienia szkoły).
Gdy szkoła ukrywa średnie, jest wyliczana z wag Librusa (`+` = +0,5, `-` = −0,25, tylko oceny z „Licz do
średniej: tak”) i oznaczona `*`.

Wejście tylko po haśle strony: formularz logowania, potem ciasteczko sesji (`HttpOnly`, `SameSite=Strict`)
na 30 dni; zmiana hasła wylogowuje wszystkich, 10 błędnych haseł w 15 minut blokuje adres na chwilę. Stronę
serwuje sam Node-RED, więc jest dostępna tam, gdzie Node-RED – wystawiając ją do internetu, użyj HTTPS / VPN.
Ostatni wynik leży w `~/.node-red/afya-librus/<id-węzła>.json`, więc strona działa zaraz po restarcie.

#### Wyjście (`msg.payload`)

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
* `srednie`: średnie ważone dla okresów i roku (`1`, `2`, `R`) – z Librusa (Śr.I / Śr.II / Śr.R), a gdy szkoła
  je ukrywa, wyliczone z wag Librusa. `srednieLibrus` – tylko te, które pokazuje sam Librus.
* `tablica`: wszystkie oceny bieżące przedmiotu w jednym napisie, osobno dla każdego semestru.
* `uwagi`, `noweUwagi`: pojawiają się tylko wtedy, gdy włączona jest opcja „Also read teacher notes”.

#### Test SMS

Wyślij do węzła `msg.test = true`. Jeśli nie ma nowości, najnowsza ocena (i uwaga, jeśli są
włączone) zostanie podana jako nowa, więc od razu zobaczysz, czy SMS dochodzi. W przykładowym
flow jest do tego osobny *inject*.

#### Jak wykrywane są nowości

Lista już widzianych ocen i uwag leży w pliku `~/.node-red/afya-librus/<id-węzła>.json`, więc
restart Node-RED nie powoduje duplikatów. Pierwsze uruchomienie tylko zapamiętuje stan
(`pierwszyOdczyt: true`), żeby nie wysłać SMS-a z całym rokiem ocen. Tak samo działa pierwsze
włączenie opcji uwag. Ocena jest rozpoznawana po numerze w Librusie i wartości, więc zmiana
wartości przez nauczyciela też zostanie zgłoszona.

### Ograniczenia

* Oceny opisowe w nowym układzie Librusa (klasy 1–3) nie są odczytywane.
* Konta z dodatkowym potwierdzeniem logowania (2FA) nie są obsługiwane.
* Węzeł czyta stronę WWW Synergii. Gdy Librus zmieni logowanie albo wygląd strony, może przestać
  działać. Dostaniesz wtedy `ok: false` z opisem błędu.

### Testy

```bash
npm install
npm test
```

Testy nie łączą się z Librusem. Używają atrapy serwera i syntetycznych stron z fikcyjnymi danymi.

### Skąd pomysł

Inspiracją była integracja [LibrusSynergiaHA](https://github.com/LukMaverick/LibrusSynergiaHA)
dla Home Assistanta (LukMaverick). Ten węzeł działa na innej zasadzie: sam łączy się z Synergią,
działa w Node-RED i jest napisany od zera w JavaScripcie.

Projekt nieoficjalny, niezwiązany z firmą Librus.

---

Marcin Chuć · [MIT](LICENSE)
