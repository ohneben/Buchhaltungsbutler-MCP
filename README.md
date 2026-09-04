# ohneben's Buchhaltungsbutler MCP

[![CI](https://github.com/ohneben/Buchhaltungsbutler-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/ohneben/Buchhaltungsbutler-MCP/actions/workflows/ci.yml)
[![Docker-Image veröffentlichen](https://github.com/ohneben/Buchhaltungsbutler-MCP/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/ohneben/Buchhaltungsbutler-MCP/actions/workflows/docker-publish.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-green.svg)](./LICENSE.md)

Verwalte deine [BuchhaltungsButler](https://www.buchhaltungsbutler.de/)-Buchhaltung in
natürlicher Sprache aus KI-Assistenten wie **Claude**, **Cursor** und jedem anderen
[MCP](https://modelcontextprotocol.io)-Client.

Dieser [Model-Context-Protocol](https://modelcontextprotocol.io)-Server stellt die
**[BuchhaltungsButler API v1](https://app.buchhaltungsbutler.de/docs/api/v1/)** bereit —
alle **54 Endpunkte**, automatisch aus der offiziellen OpenAPI-Spezifikation
(Spec-Version **1.9.1**) als MCP-Tools generiert. Jedes Tool ist
**sicherheitskategorisiert** (nur lesend / schreibend / destruktiv), damit dein Assistent
weiß, was eine Aktion tut, *bevor* er sie ausführt. Läuft über **stdio**
(Claude Desktop und andere lokale Launcher) oder **Streamable HTTP** (gehostet in Docker).

## Warum dieser Server

Manche MCP-Server leiten eine API einfach nur weiter. Dieser hier ist darauf ausgelegt,
**gefahrlos an ein Sprachmodell übergeben** und **im Alltag betrieben** werden zu können:

| Was du bekommst | Warum das zählt |
| --- | --- |
| **Alle 54 Endpunkte, automatisch generiert** aus der offiziellen Spec | Vollständige Abdeckung von Belegen, Transaktionen, Buchungen, Rechnungen, Auswertungen und Stammdaten — nichts handverlesen, nichts vergessen. |
| **Jedes Tool ist sicherheitskategorisiert** 🟢 / 🟡 / 🔴 | Ein Banner am Anfang jeder Tool-Beschreibung sagt dem Modell genau, was passiert — lesen, anlegen, ändern, zurücknehmen oder löschen — bevor es handelt. |
| **Maschinenlesbare MCP-Annotationen** (`readOnlyHint`, `destructiveHint`) | Hosts, die Annotationen auswerten (Claude gehört dazu), können Lesezugriffe automatisch zulassen und vor destruktiven Aktionen eine Bestätigung verlangen. |
| **Zwei Transporte: stdio *und* Streamable HTTP** | Lokal in Claude Desktop nutzen — oder einen dauerhaft laufenden Server betreiben, den beliebig viele MCP-Clients über HTTP erreichen. |
| **Docker + docker-compose, Health-Check, Auto-Restart** | Produktionsnahes Deployment ab Werk: `docker compose up`, und er bleibt oben. |
| **Optionale Bearer-Token-Authentifizierung** am HTTP-Endpunkt | Sichere den Server mit einem gemeinsamen Geheimnis ab, sobald er über localhost hinaus erreichbar ist. |
| **Eingebautes Rate-Limiting** | Drosselt sich selbst unter dem BuchhaltungsButler-Limit von 100 Anfragen/Kunde/Minute, damit du nie dagegenläufst. |
| **Deine Zugangsdaten erreichen das Modell nie** | Die Credentials liegen in der Server-Umgebung und werden pro Anfrage injiziert — der Assistent sieht nur Tool-Eingaben und API-Antworten. |

### Im Vergleich

Nach aktuellem Stand ist dies der einzige dedizierte BuchhaltungsButler-MCP-Server.
Alternativ *könntest* du einen generischen OpenAPI→MCP-Wrapper auf die Spec richten —
das lässt allerdings einiges liegen:

| Fähigkeit | **Dieses Projekt** | Generischer OpenAPI→MCP-Wrapper\* |
| --- | :---: | :---: |
| Alle 54 BuchhaltungsButler-Endpunkte als Tools | ✅ | ✅ |
| 🟢 / 🟡 / 🔴 Sicherheitskategorie + Banner pro Tool | ✅ | ❌ |
| `readOnlyHint` / `destructiveHint` MCP-Annotationen | ✅ | ➖ |
| `$ref`-Auflösung für Batch-Payloads + HTML-bereinigte Beschreibungen | ✅ | ➖ |
| Eingebautes Rate-Limiting (bleibt unter BBs 100/Kunde/Min.) | ✅ | ❌ |
| `stdio`-Transport | ✅ | ✅ |
| **Streamable-HTTP-Transport** | ✅ | ➖ |
| **Docker + docker-compose**, Health-Check, Auto-Restart | ✅ | ❌ |
| **Optionale Bearer-Token-Auth** am Endpunkt | ✅ | ❌ |
| Credentials serverseitig injiziert, nie ans Modell gesendet | ✅ | ➖ |
| Lizenz | MIT | unterschiedlich |

<sub>\*Generische OpenAPI→MCP-Wrapper machen aus jeder Swagger-/OpenAPI-Spec MCP-Tools.
Sie erreichen dieselben Endpunkte, behandeln aber jede Operation gleich — keine
Sicherheitskategorien, keine Betriebsgeschichte, keine auf echte Buchhaltungsdaten
abgestimmten Leitplanken. „➖“ = je nach Werkzeug unterschiedlich / nicht garantiert.</sub>

## Was du damit machen kannst

Sobald der Server verbunden ist, kannst du deinen Assistenten zum Beispiel bitten:

- „Liste alle Eingangsbelege vom letzten Monat auf, die noch offen sind.“
- „Erstelle einen Rechnungsentwurf für die ACME GmbH: 10 Stunden Beratung à 120 €.“
- „Buche diese Banktransaktion auf Sachkonto 4400.“
- „Lade diesen PDF-Beleg hoch und ordne ihn der passenden Transaktion zu.“
- „Zeig mir meine Kreditoren und leg einen neuen für unseren Hosting-Anbieter an.“
- „Erstelle mir die BWA für das letzte Quartal und zeig mir das Kontenblatt zu Konto 4400.“

Die Tools werden automatisch aus der offiziellen API generiert und in 🟢 nur lesend,
🟡 schreibend und 🔴 destruktiv gruppiert — ein gut umgesetzter Host kann jede Gruppe
unterschiedlich behandeln.

## Funktionsweise

```
Claude / Cursor / beliebiger MCP-Client  ──MCP──►  dieser Server  ──HTTPS──►  BuchhaltungsButler API (Cloud)
```

Der Server liest die mitgelieferte OpenAPI-Spec ein und macht daraus MCP-Tools (inklusive
Auflösung von `$ref`-Batch-Payloads und Entfernen von HTML aus den Beschreibungen),
versieht jedes Tool mit seiner Sicherheitskategorie und hängt deine Basic-Auth-Credentials
sowie den `api_key` an jede ausgehende Anfrage. Deine Zugangsdaten bleiben in der
Server-Umgebung — das Modell sieht sie nie und fasst sie nie an.

## Voraussetzungen

- Ein **BuchhaltungsButler-Konto mit API-Zugang** — ein **API Client + API Secret**
  (Einstellungen → API) sowie ein Kunden-**`api_key`**
  (siehe [API-Zugangsdaten besorgen](#api-zugangsdaten-besorgen)).
- **Docker** (Docker Desktop unter macOS/Windows) für den Schnellstart unten — oder
  **Node.js ≥ 18**, um [aus dem Quellcode zu starten](#aus-dem-quellcode-starten-stdio-ohne-docker).

## Schnellstart (Docker)

**1. Zugangsdaten hinterlegen.** Beispielkonfiguration kopieren und ausfüllen:

```bash
cp .env.example .env
# .env bearbeiten → BB_API_CLIENT, BB_API_SECRET, BB_API_KEY setzen
#                 → MCP_AUTH_TOKEN auf eine lange Zufallszeichenkette setzen,
#                   falls der Server über localhost hinaus erreichbar ist
```

**2. Server starten:**

```bash
docker compose up -d --build
```

**3. Prüfen, ob er läuft:**

```bash
curl -s http://localhost:3000/health     # → {"status":"ok","server":"buchhaltungsbutler-mcp"}
```

**4. MCP-Client verbinden.** Entfernte Endpunkte werden in Claude als **Custom Connector**
hinzugefügt (Einstellungen → Connectors) oder lokal mit
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) gebrückt. Trage Folgendes unter
`mcpServers` in deiner Client-Konfiguration ein und starte die App danach vollständig neu:

```json
{
  "mcpServers": {
    "buchhaltungsbutler": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp",
        "--header", "Authorization: Bearer DEIN_MCP_AUTH_TOKEN"
      ]
    }
  }
}
```

(Die `--header`-Zeile entfällt, wenn du `MCP_AUTH_TOKEN` leer gelassen hast.)

### Lieber ein fertiges Image?

Jeder Push auf `main` veröffentlicht ein startbereites Image in der GitHub Container
Registry — damit kannst du den lokalen Build komplett überspringen:

```bash
docker run -d --name buchhaltungsbutler-mcp -p 3000:3000 --env-file .env \
  ghcr.io/ohneben/buchhaltungsbutler-mcp:latest
```

## API-Zugangsdaten besorgen

BuchhaltungsButler nutzt zwei Authentifizierungsebenen (siehe die
[offizielle Dokumentation](https://app.buchhaltungsbutler.de/docs/api/v1/)):

1. **HTTP-Basic-Auth** — ein **API Client** + **API Secret**, deine globalen
   API-Zugangsdaten. Zu finden bzw. anzulegen in BuchhaltungsButler unter
   **Einstellungen → API**.
2. **`api_key`** — legt fest, *auf welches Kundenkonto* sich eine Anfrage bezieht. Er
   steht in den Firmendaten-Einstellungen des jeweiligen Kunden.

Trage alle drei Werte in `.env` ein. Der Server hängt sie an jede Anfrage an, dein
Assistent bekommt sie also nie zu sehen. Ein einzelner Tool-Aufruf kann optional einen
eigenen `api_key` mitgeben, um ein anderes Kundenkonto anzusprechen.

## Konfiguration

Alles wird in `.env` gesetzt (kopiert aus `.env.example`):

| Variable | Pflicht | Standard | Beschreibung |
|---|---|---|---|
| `BB_API_CLIENT` | ✅ | — | API Client (Basic-Auth-Benutzername) |
| `BB_API_SECRET` | ✅ | — | API Secret (Basic-Auth-Passwort) |
| `BB_API_KEY` | ✅ | — | Standard-Kunden-`api_key` |
| `MCP_TRANSPORT` | — | `stdio` | `stdio` oder `http` (das Docker-Image nutzt standardmäßig `http`) |
| `PORT` | — | `3000` | HTTP-Port, auf dem gelauscht wird |
| `HOST` | — | `0.0.0.0` | HTTP-Bind-Adresse |
| `MCP_HTTP_PATH` | — | `/mcp` | HTTP-Route für MCP |
| `MCP_AUTH_TOKEN` | — | _(aus)_ | Verlangt `Authorization: Bearer <Token>` auf `/mcp` |
| `BB_RATE_LIMIT` | — | `90` | Clientseitiges Limit an Anfragen pro Minute |
| `BB_BASE_URL` | — | _(aus der Spec)_ | Überschreibt die Basis-URL der API |

Nach Änderungen an `.env` neu laden mit `docker compose up -d --force-recreate`.

## Sicherheitskategorien der Tools

Jede Tool-Beschreibung beginnt mit einem dieser Banner und trägt die passenden
[MCP-Annotationen](https://modelcontextprotocol.io/docs/concepts/tools#tool-annotations):

| Banner | Anzahl | `readOnlyHint` | `destructiveHint` | Bedeutung |
|---|---|---|---|---|
| 🟢 **READ-ONLY** | 15 | `true` | `false` | Ruft nur Daten ab. Ungefährlich. |
| 🟡 **WRITE · legt Daten an** | 24 | `false` | `false` | Erzeugt Datensätze (nicht idempotent — mehrfach aufgerufen entstehen Duplikate). |
| 🟡 **WRITE · ändert Daten** | 4 | `false` | `false` | Ändert bestehende Stammdaten direkt. |
| 🟡 **WRITE · verknüpft/löst** | 4 | `false` | `false` | Ordnet Beleg ↔ Transaktion zu bzw. hebt die Zuordnung auf. Umkehrbar. |
| 🟡 **WRITE · nimmt Zustand zurück** | 4 | `false` | `false` | Setzt Buchungen auf unbestätigt / stellt Belege wieder her. Umkehrbar. |
| 🔴 **DESTRUCTIVE · löscht** | 3 | `false` | `true` | Löscht oder storniert einen Datensatz. Vorher bestätigen lassen. |

Hosts, die Annotationen respektieren (Claude gehört dazu), können für
`destructiveHint`-Tools eine Bestätigung verlangen und `readOnlyHint`-Tools automatisch
vertrauen.

> Mit `npm run list-tools` (ohne Zugangsdaten) lässt sich der vollständige Katalog
> jederzeit ausgeben.

<details>
<summary><strong>🟢 READ-ONLY (15)</strong></summary>

| Tool | Endpunkt |
|---|---|
| `accounts_get` | `POST /accounts/get` |
| `cost_locations_get` | `POST /cost-locations/get` |
| `postings_get` | `POST /postings/get` |
| `receipts_get` | `POST /receipts/get` |
| `receipts_get_id_by_customer` | `POST /receipts/get/id_by_customer` |
| `receipts_assigned_transactions_get` | `POST /receipts/assigned-transactions/get` |
| `reports_get_bwa` | `POST /reports/get/bwa` |
| `reports_get_sums` | `POST /reports/get/sums` |
| `reports_get_sums_ledger` | `POST /reports/get/sums/ledger` |
| `transactions_get` | `POST /transactions/get` |
| `transactions_get_id_by_customer` | `POST /transactions/get/id_by_customer` |
| `transactions_assigned_receipts_get` | `POST /transactions/assigned-receipts/get` |
| `settings_get_creditors` | `POST /settings/get/creditors` |
| `settings_get_debtors` | `POST /settings/get/debtors` |
| `settings_get_postingaccounts` | `POST /settings/get/postingaccounts` |
</details>

<details>
<summary><strong>🟡 WRITE · legt Daten an (24)</strong></summary>

| Tool | Endpunkt |
|---|---|
| `accounts_add` | `POST /accounts/add` |
| `comments_add` | `POST /comments/add` |
| `cost_locations_add` | `POST /cost-locations/add` |
| `invoices_create` | `POST /invoices/create` |
| `invoices_create_draft` | `POST /invoices/create/draft` |
| `invoices_create_e_invoice` | `POST /invoices/create/e-invoice` |
| `postings_add_free` | `POST /postings/add/free` |
| `postings_add_receipt` | `POST /postings/add/receipt` |
| `postings_add_transaction` | `POST /postings/add/transaction` |
| `postings_add_batch_free` | `POST /postings/add-batch/free` |
| `postings_add_batch_receipts` | `POST /postings/add-batch/receipts` |
| `postings_add_batch_transactions` | `POST /postings/add-batch/transactions` |
| `receipts_add` | `POST /receipts/add` |
| `receipts_addBatch` | `POST /receipts/addBatch` |
| `receipts_upload` | `POST /receipts/upload` |
| `reports_create_bwa` | `POST /reports/create/bwa` |
| `reports_create_sums` | `POST /reports/create/sums` |
| `settings_add_creditor` | `POST /settings/add/creditor` |
| `settings_add_debtor` | `POST /settings/add/debtor` |
| `settings_add_postingaccount` | `POST /settings/add/postingaccount` |
| `settings_add_batch_creditors` | `POST /settings/add-batch/creditors` |
| `settings_add_batch_debtors` | `POST /settings/add-batch/debtors` |
| `transactions_add` | `POST /transactions/add` |
| `transactions_addBatch` | `POST /transactions/addBatch` |
</details>

<details>
<summary><strong>🟡 WRITE · ändert (4) · verknüpft (4) · nimmt zurück (4)</strong></summary>

| Tool | Endpunkt | Unterkategorie |
|---|---|---|
| `cost_locations_update` | `POST /cost-locations/update` | ändert |
| `settings_update_creditor` | `POST /settings/update/creditor` | ändert |
| `settings_update_debtor` | `POST /settings/update/debtor` | ändert |
| `settings_update_postingaccount` | `POST /settings/update/postingaccount` | ändert |
| `transactions_assign_receipt` | `POST /transactions/assign/receipt` | verknüpft |
| `transactions_assign_batch_receipt` | `POST /transactions/assign-batch/receipt` | verknüpft |
| `transactions_unassign_receipt` | `POST /transactions/unassign/receipt` | verknüpft |
| `postings_assign_receipt_to_free_posting` | `POST /postings/assign/receipt-to-free-posting` | verknüpft |
| `postings_unconfirm_free` | `POST /postings/unconfirm/free` | nimmt zurück |
| `postings_unconfirm_receipt` | `POST /postings/unconfirm/receipt` | nimmt zurück |
| `postings_unconfirm_transaction` | `POST /postings/unconfirm/transaction` | nimmt zurück |
| `receipts_restore_id_by_customer` | `POST /receipts/restore/id_by_customer` | nimmt zurück |
</details>

<details>
<summary><strong>🔴 DESTRUCTIVE · löscht (3)</strong></summary>

| Tool | Endpunkt | Hinweis |
|---|---|---|
| `receipts_delete_id_by_customer` | `POST /receipts/delete/id_by_customer` | Wiederherstellbar über `receipts_restore_id_by_customer` |
| `cost_locations_delete` | `POST /cost-locations/delete` | **Nicht** wiederherstellbar |
| `postings_cancel` | `POST /postings/cancel` | Noch nicht festgeschriebene Buchungen werden gelöscht; festgeschriebene werden durch eine Stornobuchung ausgeglichen |
</details>

## Aus dem Quellcode starten (stdio, ohne Docker)

Du bevorzugst den klassischen stdio-Modus für Claude Desktop? Dann lokal bauen:

```bash
npm install
npm run build
```

Anschließend Claude Desktop in `claude_desktop_config.json` auf den kompilierten
Einstiegspunkt zeigen lassen:

```json
{
  "mcpServers": {
    "buchhaltungsbutler": {
      "command": "node",
      "args": ["/ABSOLUTER/PFAD/Buchhaltungsbutler MCP/dist/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "BB_API_CLIENT": "dein-api-client",
        "BB_API_SECRET": "dein-api-secret",
        "BB_API_KEY": "dein-kunden-api-key"
      }
    }
  }
}
```

Oder den Container stattdessen über stdio betreiben:

```json
{
  "mcpServers": {
    "buchhaltungsbutler": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT=stdio",
        "-e", "BB_API_CLIENT", "-e", "BB_API_SECRET", "-e", "BB_API_KEY",
        "buchhaltungsbutler-mcp:latest"
      ],
      "env": {
        "BB_API_CLIENT": "dein-api-client",
        "BB_API_SECRET": "dein-api-secret",
        "BB_API_KEY": "dein-kunden-api-key"
      }
    }
  }
}
```

(Das Image vorher bauen: `docker build -t buchhaltungsbutler-mcp:latest .`)

## Spec aktuell halten

Die mitgelieferte `spec.json` ist die offizielle BuchhaltungsButler-v1-OpenAPI-Spec — die
maßgebliche Quelle für die Tools. So aktualisierst du sie auf einen neueren API-Stand:

```bash
curl -s https://app.buchhaltungsbutler.de/docs/api/v1.de.json -o spec.json
npm run build
```

Neue Pfade werden automatisch übernommen; trage sie in `PATH_CATEGORY` in
`src/categories.ts` ein, damit sie die richtige Sicherheitskategorie bekommen (nicht
zugeordnete Pfade fallen konservativ auf die Kategorie *create* zurück).

> **Hinweis zur Versionsnummer:** BuchhaltungsButler pflegt das Feld `info.version` in
> der Spec nicht zuverlässig — der Inhalt kann sich ändern, ohne dass die Nummer steigt.
> Verlass dich beim Abgleich also nicht auf die Version, sondern vergleiche die
> Pfadliste (`paths`) und die Parameter der Endpunkte.

## Entwicklung

```bash
npm install
npm run build      # TypeScript → dist/ kompilieren
npm test           # Vitest-Suite ausführen
npm run list-tools # kategorisierten Tool-Katalog ausgeben (ohne Zugangsdaten)
```

Die CI baut und testet jeden Push unter Node 20 und 22; Pushes auf `main` veröffentlichen
zusätzlich ein Docker-Image in der GitHub Container Registry.

## Hinweise & Konventionen

- **Datumsangaben**: `YYYY-MM-DD`. **Beträge**: Punkt als Dezimaltrennzeichen (z. B. `-12.30`).
- **Datei-Uploads** (`receipts_upload`, `receipts_add`, `receipts_addBatch`): Die Datei
  wird als Base64-Zeichenkette im Feld `file` übergeben.
- **Blättern**: Die meisten `get`-Tools akzeptieren `limit` und `offset`.
- **Batch-Tools** erwarten Arrays von Objekten; die Item-Schemata werden aus den
  Spec-Definitionen aufgelöst und dem Modell mitgegeben.
- **Auswertungen** (BWA, Summen- und Saldenliste) werden asynchron im Hintergrund
  erzeugt: erst `reports_create_*` aufrufen, dann `reports_get_*` mit der zurückgegebenen
  `id_by_customer`. Eine neue Auswertung desselben Typs ersetzt die vorherige.
- **Rate-Limit**: BuchhaltungsButler erlaubt 100 Anfragen/Kunde/Minute; der Server
  drosselt sich selbst bei `BB_RATE_LIMIT` (Standard 90), um sicher darunter zu bleiben.

## Sicherheit

- Deine API-Zugangsdaten liegen ausschließlich in `.env`, und diese Datei ist von Git
  ausgeschlossen. **Committe niemals echte Geheimnisse.** Falls doch etwas abfließt,
  rotiere die Daten unter **BuchhaltungsButler → Einstellungen → API**.
- Der HTTP-Endpunkt ist standardmäßig nicht authentifiziert (auf localhost unbedenklich).
  Um ihn über deinen Rechner hinaus verfügbar zu machen, setze `MCP_AUTH_TOKEN` und
  sende ihn als `Authorization: Bearer <Token>`-Header — idealerweise hinter TLS.

Die vollständige Richtlinie und den Meldeweg für Sicherheitslücken findest du in
[SECURITY.md](./SECURITY.md).

## Credits & Lizenz

Eine inoffizielle Community-Integration für
[BuchhaltungsButler](https://www.buchhaltungsbutler.de/); weder mit BuchhaltungsButler
verbunden noch von dort unterstützt. Basiert auf dem
[Model Context Protocol](https://modelcontextprotocol.io). Veröffentlicht unter der
[MIT-Lizenz](./LICENSE.md).
