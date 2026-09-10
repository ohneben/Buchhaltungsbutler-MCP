# ohneben's Buchhaltungsbutler MCP

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-ohneben-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/ohneben)

---

#### Lizenz & Checks

[![CI](https://github.com/ohneben/Buchhaltungsbutler-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/ohneben/Buchhaltungsbutler-MCP/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-green.svg)](./LICENSE.md)

#### MCP-Register

[![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0.1%2Fservers%2Fio.github.ohneben%252Fbuchhaltungsbutler-mcp%2Fversions%2Flatest&query=%24.server.version&prefix=v&label=MCP%20Registry&color=blue&logo=modelcontextprotocol&logoColor=white)](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.ohneben%2Fbuchhaltungsbutler-mcp/versions/latest)
[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/ohneben/buchhaltungsbutler-mcp)
[![Buchhaltungsbutler-MCP MCP server](https://glama.ai/mcp/servers/ohneben/Buchhaltungsbutler-MCP/badges/score.svg)](https://glama.ai/mcp/servers/ohneben/Buchhaltungsbutler-MCP)

#### Paketkennungen

Dieser Server hat eigene Kennungen. Was anders heisst, gehoert nicht dazu:

| Wo | Kennung |
|---|---|
| MCP-Register | `io.github.ohneben/buchhaltungsbutler-mcp` |
| Container (GHCR) | `ghcr.io/ohneben/buchhaltungsbutler-mcp` |
| npm | `@ohneben/buchhaltungsbutler-mcp` (noch nicht veroeffentlicht) |

Das npm-Paket `buchhaltungsbutler-mcp` ohne Scope ist ein anderes Projekt eines
anderen Autors ([mrvnklm/buchhaltungsbutler-mcp](https://github.com/mrvnklm/buchhaltungsbutler-mcp))
und hat mit diesem hier nichts zu tun. Verzeichnisse, die von dieser Seite
dorthin verlinken, verlinken auf das falsche Paket.

Verwalte deine [BuchhaltungsButler](https://www.buchhaltungsbutler.de/)-Buchhaltung in
natürlicher Sprache aus KI-Assistenten wie **Claude**, **Cursor** und jedem anderen
[MCP](https://modelcontextprotocol.io)-Client.

Dieser [Model-Context-Protocol](https://modelcontextprotocol.io)-Server stellt die
**[BuchhaltungsButler API v1](https://app.buchhaltungsbutler.de/docs/api/v1/)** bereit —
alle **54 Endpunkte** als **46 MCP-Tools**, aus der offiziellen
OpenAPI-Spezifikation (Spec-Version **1.9.1**) generiert. Jedes Tool ist
**sicherheitskategorisiert** (nur lesend / schreibend / destruktiv), damit dein Assistent
weiß, was eine Aktion tut, *bevor* er sie ausführt. Läuft über **stdio**
(Claude Desktop und andere lokale Launcher) oder **Streamable HTTP** (gehostet in Docker).

## Warum dieser Server

Manche MCP-Server leiten eine API einfach nur weiter. Dieser hier ist darauf ausgelegt,
**gefahrlos an ein Sprachmodell übergeben** und **im Alltag betrieben** werden zu können:

| Was du bekommst | Warum das zählt |
| --- | --- |
| **Alle 54 Endpunkte, automatisch generiert** aus der offiziellen Spec | Vollständige Abdeckung von Belegen, Transaktionen, Buchungen, Rechnungen, Auswertungen und Stammdaten. Nichts handverlesen, nichts vergessen. |
| **Jedes Tool ist sicherheitskategorisiert** 🟢 / 🟡 / 🔴 | Ein Banner am Anfang jeder Tool-Beschreibung sagt dem Modell genau, was passiert — lesen, anlegen, ändern, zurücknehmen oder löschen — bevor es handelt. |
| **Maschinenlesbare MCP-Annotationen** (`readOnlyHint`, `destructiveHint`) | Hosts, die Annotationen auswerten (Claude gehört dazu), können Lesezugriffe automatisch zulassen und vor destruktiven Aktionen eine Bestätigung verlangen. |
| **Zwei Transporte: stdio *und* Streamable HTTP** | Lokal in Claude Desktop nutzen — oder einen dauerhaft laufenden Server betreiben, den beliebig viele MCP-Clients über HTTP erreichen. |
| **Docker + docker-compose, Health-Check, Auto-Restart** | Produktionsnahes Deployment ab Werk: `docker compose up`, und er bleibt oben. |
| **Bearer-Token-Authentifizierung** am HTTP-Endpunkt | Pflicht, sobald der Server über Loopback hinaus gebunden ist: ohne `MCP_AUTH_TOKEN` verweigert er den Start, statt die API ungeschützt bereitzustellen. |
| **Eingebautes Rate-Limiting** | Drosselt sich selbst unter dem BuchhaltungsButler-Limit von 100 Anfragen/Kunde/Minute, damit du nie dagegenläufst. |
| **Deine Zugangsdaten erreichen das Modell nie** | Die Credentials liegen in der Server-Umgebung und werden pro Anfrage injiziert — der Assistent sieht nur Tool-Eingaben und API-Antworten. |

### Im Vergleich

Nach aktuellem Stand ist dies der einzige dedizierte BuchhaltungsButler-MCP-Server.
Alternativ *könntest* du einen generischen OpenAPI→MCP-Wrapper auf die Spec richten —
das lässt allerdings einiges liegen:

| Fähigkeit | **Dieses Projekt** | Generischer OpenAPI→MCP-Wrapper\* |
| --- | :---: | :---: |
| Alle 54 BuchhaltungsButler-Endpunkte abgedeckt | ✅ | ✅ |
| 🟢 / 🟡 / 🔴 Sicherheitskategorie + Banner pro Tool | ✅ | ❌ |
| `readOnlyHint` / `destructiveHint` MCP-Annotationen | ✅ | ➖ |
| `$ref`-Auflösung für Batch-Payloads + HTML-bereinigte Beschreibungen | ✅ | ➖ |
| Eingebautes Rate-Limiting (bleibt unter BBs 100/Kunde/Min.) | ✅ | ❌ |
| `stdio`-Transport | ✅ | ✅ |
| **Streamable-HTTP-Transport** | ✅ | ➖ |
| **Docker + docker-compose**, Health-Check, Auto-Restart | ✅ | ❌ |
| **Erzwungene Bearer-Token-Auth** am Endpunkt | ✅ | ❌ |
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
#                 → MCP_AUTH_TOKEN setzen. PFLICHT, sonst startet der Server
#                   nicht, denn .env.example bindet auf 0.0.0.0:
#                   openssl rand -hex 32
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

(Die `--header`-Zeile entfällt nur, wenn du ohne Token auf Loopback bindest.
Im Docker-Schnellstart oben ist das Token Pflicht.)

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
| `MCP_AUTH_TOKEN` | ⚠️ | _(aus)_ | Verlangt `Authorization: Bearer <Token>` auf `/mcp`. **Pflicht**, wenn `HOST` keine Loopback-Adresse ist — sonst startet der Server nicht |
| `MCP_ALLOWED_HOSTS` | — | _(automatisch)_ | Erlaubte `Host`-Header, kommagetrennt (Schutz vor DNS-Rebinding). Nötig hinter einem Reverse-Proxy |
| `MCP_ALLOW_INSECURE` | — | _(aus)_ | Hebt die Startverweigerung ohne Token auf. Nur für nachweislich unerreichbare Endpunkte |
| `MCP_SESSION_TTL` | — | `1800` | Sekunden Leerlauf, bevor eine Session verworfen wird |
| `MCP_MAX_SESSIONS` | — | `256` | Obergrenze gleichzeitiger Sessions |
| `BB_ALLOW_API_KEY_OVERRIDE` | — | _(aus)_ | Erlaubt einem Tool-Aufruf, den `api_key` zu überschreiben |
| `BB_RATE_LIMIT` | — | `90` | Clientseitiges Limit an Anfragen pro Minute |
| `BB_BASE_URL` | — | _(aus der Spec)_ | Überschreibt die Basis-URL der API |

Nach Änderungen an `.env` neu laden mit `docker compose up -d --force-recreate`.

## Toolnamen

Jedes Tool heisst `<ressource>_<verb>`. Die Verben sind fest: `list`, `get`,
`create`, `update`, `delete`, `upload`, `assign`, `unassign`, `unconfirm`,
`restore`, `cancel`. Damit heisst dieselbe Sache ueberall gleich, unabhaengig
davon, wie der jeweilige BB-Pfad geschrieben ist (die API mischt `add` und
`create`, und zwei Batch-Pfade sind camelCase).

Anlegen geht immer ueber ein Tool, das eine Liste nimmt. `receipts_create`
legt einen Beleg oder hundert an, ein einzelner Datensatz ist eine Liste mit
einem Eintrag. Deshalb gibt es 46 Tools fuer 54 Endpunkte: acht
Einzel-Endpunkte sind in ihrem Batch-Gegenstueck aufgegangen.

### Alte Namen bleiben aufrufbar

Die Namen bis 1.1.1 funktionieren weiter. Sie stehen nicht mehr im Katalog,
werden aber beim Aufruf aufgeloest, damit fest verdrahtete Aufrufe aus
aelteren Releases nicht ins Leere laufen. Ein Aufruf von `receipts_add` mit
Einzelfeldern landet weiterhin auf `/receipts/add`.

`BB_READ_ONLY` und `BB_TOOL_ALLOWLIST` greifen vorher: ueber einen alten Namen
laesst sich kein Tool erreichen, das die Policy ausschliesst.

| Alt (bis 1.1.1) | Neu |
|---|---|
| `accounts_get` | `accounts_list` |
| `receipts_get` | `receipts_list` |
| `receipts_get_id_by_customer` | `receipts_get_by_id` |
| `receipts_add`, `receipts_addBatch` | `receipts_create` |
| `transactions_add`, `transactions_addBatch` | `transactions_create` |
| `settings_get_creditors` | `creditors_list` |
| `settings_add_creditor`, `settings_add_batch_creditors` | `creditors_create` |
| `settings_get_postingaccounts` | `postingaccounts_list` |
| `postings_add_free`, `postings_add_batch_free` | `postings_create_free` |
| `transactions_assign_receipt`, `transactions_assign_batch_receipt` | `transactions_assign_receipts` |

Die vollstaendige Zuordnung steht in [`src/naming.ts`](src/naming.ts).

## Sicherheitskategorien der Tools

Jede Tool-Beschreibung beginnt mit einem dieser Banner und traegt die passenden
[MCP-Annotationen](https://modelcontextprotocol.io/docs/concepts/tools#tool-annotations):

| Banner | Anzahl | `readOnlyHint` | `destructiveHint` | Bedeutung |
|---|---|---|---|---|
| 🟢 **READ-ONLY** | 15 | `true` | `false` | Ruft nur Daten ab. Ungefaehrlich. |
| 🟡 **WRITE · legt Daten an** | 17 | `false` | `false` | Erzeugt Datensaetze (nicht idempotent, mehrfach aufgerufen entstehen Duplikate). |
| 🟡 **WRITE · aendert Daten** | 4 | `false` | `false` | Aendert bestehende Stammdaten direkt. |
| 🟡 **WRITE · verknuepft/loest** | 3 | `false` | `false` | Ordnet Beleg und Transaktion zu bzw. hebt die Zuordnung auf. Umkehrbar. |
| 🟡 **WRITE · nimmt Zustand zurueck** | 4 | `false` | `false` | Setzt Buchungen auf unbestaetigt / stellt Belege wieder her. Umkehrbar. |
| 🔴 **DESTRUCTIVE · loescht** | 3 | `false` | `true` | Loescht oder storniert einen Datensatz. Vorher bestaetigen lassen. |

Hosts, die Annotationen respektieren (Claude gehoert dazu), koennen fuer
`destructiveHint`-Tools eine Bestaetigung verlangen und `readOnlyHint`-Tools
automatisch vertrauen.

Jedes Tool bringt zusaetzlich ein `outputSchema` mit, also die Form der
Erfolgsantwort. Erfolgreiche Aufrufe liefern die Antwort deshalb nicht nur als
Text, sondern auch als `structuredContent`.

> Mit `npm run list-tools` (ohne Zugangsdaten) laesst sich der vollstaendige
> Katalog jederzeit ausgeben.

<details>
<summary><strong>🟢 READ-ONLY (15)</strong></summary>

| Tool | Endpunkt |
|---|---|
| `accounts_list` | `POST /accounts/get` |
| `cost_locations_list` | `POST /cost-locations/get` |
| `creditors_list` | `POST /settings/get/creditors` |
| `debtors_list` | `POST /settings/get/debtors` |
| `postingaccounts_list` | `POST /settings/get/postingaccounts` |
| `postings_list` | `POST /postings/get` |
| `receipts_get_by_id` | `POST /receipts/get/id_by_customer` |
| `receipts_list` | `POST /receipts/get` |
| `receipts_list_assigned_transactions` | `POST /receipts/assigned-transactions/get` |
| `reports_get_bwa` | `POST /reports/get/bwa` |
| `reports_get_sums` | `POST /reports/get/sums` |
| `reports_get_sums_ledger` | `POST /reports/get/sums/ledger` |
| `transactions_get_by_id` | `POST /transactions/get/id_by_customer` |
| `transactions_list` | `POST /transactions/get` |
| `transactions_list_assigned_receipts` | `POST /transactions/assigned-receipts/get` |
</details>

<details>
<summary><strong>🟡 WRITE · legt Daten an (17)</strong></summary>

Tools mit zwei Endpunkten nehmen eine Liste. Kommt der Aufruf stattdessen mit
Einzelfeldern, geht er an den Einzel-Endpunkt.

| Tool | Endpunkt | Einzel-Endpunkt |
|---|---|---|
| `accounts_create` | `POST /accounts/add` | |
| `comments_create` | `POST /comments/add` | |
| `cost_locations_create` | `POST /cost-locations/add` | |
| `creditors_create` | `POST /settings/add-batch/creditors` | `POST /settings/add/creditor` |
| `debtors_create` | `POST /settings/add-batch/debtors` | `POST /settings/add/debtor` |
| `invoices_create` | `POST /invoices/create` | |
| `invoices_create_draft` | `POST /invoices/create/draft` | |
| `invoices_create_e_invoice` | `POST /invoices/create/e-invoice` | |
| `postingaccounts_create` | `POST /settings/add/postingaccount` | |
| `postings_create_for_receipt` | `POST /postings/add-batch/receipts` | `POST /postings/add/receipt` |
| `postings_create_for_transaction` | `POST /postings/add-batch/transactions` | `POST /postings/add/transaction` |
| `postings_create_free` | `POST /postings/add-batch/free` | `POST /postings/add/free` |
| `receipts_create` | `POST /receipts/addBatch` | `POST /receipts/add` |
| `receipts_upload` | `POST /receipts/upload` | |
| `reports_create_bwa` | `POST /reports/create/bwa` | |
| `reports_create_sums` | `POST /reports/create/sums` | |
| `transactions_create` | `POST /transactions/addBatch` | `POST /transactions/add` |
</details>

<details>
<summary><strong>🟡 WRITE · aendert (4) · verknuepft (3) · nimmt zurueck (4)</strong></summary>

| Tool | Endpunkt | Unterkategorie |
|---|---|---|
| `cost_locations_update` | `POST /cost-locations/update` | aendert |
| `creditors_update` | `POST /settings/update/creditor` | aendert |
| `debtors_update` | `POST /settings/update/debtor` | aendert |
| `postingaccounts_update` | `POST /settings/update/postingaccount` | aendert |
| `postings_assign_receipt_to_free` | `POST /postings/assign/receipt-to-free-posting` | verknuepft |
| `transactions_assign_receipts` | `POST /transactions/assign-batch/receipt` | verknuepft |
| `transactions_unassign_receipt` | `POST /transactions/unassign/receipt` | verknuepft |
| `postings_unconfirm_free` | `POST /postings/unconfirm/free` | nimmt zurueck |
| `postings_unconfirm_for_receipt` | `POST /postings/unconfirm/receipt` | nimmt zurueck |
| `postings_unconfirm_for_transaction` | `POST /postings/unconfirm/transaction` | nimmt zurueck |
| `receipts_restore` | `POST /receipts/restore/id_by_customer` | nimmt zurueck |
</details>

<details>
<summary><strong>🔴 DESTRUCTIVE · loescht (3)</strong></summary>

| Tool | Endpunkt | Hinweis |
|---|---|---|
| `receipts_delete` | `POST /receipts/delete/id_by_customer` | Wiederherstellbar ueber `receipts_restore` |
| `cost_locations_delete` | `POST /cost-locations/delete` | **Nicht** wiederherstellbar |
| `postings_cancel` | `POST /postings/cancel` | Noch nicht festgeschriebene Buchungen werden geloescht; festgeschriebene werden durch eine Stornobuchung ausgeglichen |
</details>

### Was die v1-API nicht kann

Diese Luecken stehen absichtlich auch in den Tool-Beschreibungen, damit das
Modell nicht nach einem Endpunkt sucht, den es nicht gibt:

| Ressource | Fehlt |
|---|---|
| Kreditoren, Debitoren, Buchungskonten | kein Loeschen |
| Konten (`accounts`) | kein Aendern, kein Loeschen |
| Kommentare | kein Lesen, kein Aendern, kein Loeschen |
| Rechnungen | kein Lesen, kein Aendern, kein Stornieren |
| Transaktionen | kein Aendern, kein Loeschen |

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
- **Datei-Uploads** (`receipts_upload`): Die Datei wird als Base64-Zeichenkette im
  Feld `file` übergeben. `receipts_create` legt Belege ohne Datei an.
- **Blättern**: Die meisten `list`-Tools akzeptieren `limit` und `offset` und melden
  die Gesamtzahl in `rows`.
- **Anlegen** geht immer über ein Tool, das ein Array nimmt; die Item-Schemata werden
  aus den Spec-Definitionen aufgelöst und dem Modell mitgegeben. Ein einzelner
  Datensatz ist ein Array mit einem Eintrag.
- **Auswertungen** (BWA, Summen- und Saldenliste) werden asynchron im Hintergrund
  erzeugt: erst `reports_create_*` aufrufen, dann `reports_get_*` mit der zurückgegebenen
  `id_by_customer`. Eine neue Auswertung desselben Typs ersetzt die vorherige.
- **Rate-Limit**: BuchhaltungsButler erlaubt 100 Anfragen/Kunde/Minute; der Server
  drosselt sich selbst bei `BB_RATE_LIMIT` (Standard 90), um sicher darunter zu bleiben.

## Sicherheit

- Deine API-Zugangsdaten liegen ausschließlich in `.env`, und diese Datei ist von Git
  ausgeschlossen. **Committe niemals echte Geheimnisse.** Falls doch etwas abfließt,
  rotiere die Daten unter **BuchhaltungsButler → Einstellungen → API**.
- **Der HTTP-Endpunkt verlangt ein Token, sobald er über Loopback hinaus gebunden ist.**
  Ohne `MCP_AUTH_TOKEN` verweigert der Server den Start und erklärt im Fehlertext, was
  zu tun ist. Sende das Token als `Authorization: Bearer <Token>`-Header, idealerweise
  hinter TLS.
- **Auch auf localhost gilt:** ohne Token wird der `Host`-Header auf localhost-Namen
  begrenzt, damit keine beliebige Webseite den Endpunkt per DNS-Rebinding ansprechen
  kann. Hinter einem Reverse-Proxy setzt du dafür `MCP_ALLOWED_HOSTS`.
- **Hinter einem Reverse-Proxy** setzt du den `Host`-Header im Proxy am besten fest
  auf den internen Upstream-Namen und trägst genau diesen in `MCP_ALLOWED_HOSTS`
  ein. Dann hängt die Prüfung nicht an der öffentlichen Domain und übersteht einen
  Domainwechsel. (Tipp von [@WinFuture23](https://github.com/WinFuture23).)
- **Setzt du `MCP_ALLOWED_HOSTS` und hat deine Plattform einen HTTP-Health-Check,
  muss dessen Hostname mit in die Liste.** Railway sendet
  `Host: healthcheck.railway.app`, Kubernetes-Probes fragen je nach Konfiguration
  über die Container-IP an. Fehlt der Name, bekommt der Health-Check eine 403 und
  die Plattform wertet das Deployment als kaputt.
- **`/health` liegt hinter der Host-Prüfung**, aber vor der Token-Prüfung: ein
  Health-Check der Plattform braucht kein Token. Zusätzlich akzeptiert `/health`
  **immer** `localhost`, `127.0.0.1` und `[::1]`, damit der `HEALTHCHECK` aus dem
  mitgelieferten Dockerfile weiterläuft, wenn du `MCP_ALLOWED_HOSTS` auf deine
  öffentliche Domain setzt. Fragt dein Health-Check dagegen über die Container-IP
  oder einen Service-Namen an, musst du diesen Namen in `MCP_ALLOWED_HOSTS`
  aufnehmen.
- Der `api_key` pro Tool-Aufruf ist standardmäßig **deaktiviert**
  (`BB_ALLOW_API_KEY_OVERRIDE=1` schaltet ihn frei), damit das Modell nicht selbst
  entscheiden kann, auf welchen Mandanten geschrieben wird.

Die vollständige Richtlinie und den Meldeweg für Sicherheitslücken findest du in
[SECURITY.md](./SECURITY.md).

## Credits & Lizenz

Eine inoffizielle Community-Integration für
[BuchhaltungsButler](https://www.buchhaltungsbutler.de/); weder mit BuchhaltungsButler
verbunden noch von dort unterstützt. Basiert auf dem
[Model Context Protocol](https://modelcontextprotocol.io). Veröffentlicht unter der
[MIT-Lizenz](./LICENSE.md).
