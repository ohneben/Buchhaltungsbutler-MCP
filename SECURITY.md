# Sicherheitsrichtlinie

## Unterstützte Versionen

Dieses Projekt verfolgt den jeweils neuesten Commit auf dem `main`-Branch.
Sicherheitsfixes landen dort — bitte stelle sicher, dass du die aktuellste
Version einsetzt, bevor du ein Problem meldest.

| Version | Unterstützt |
| ------- | :---------: |
| `main` (aktuell) | ✅ |
| ältere Commits   | ❌ |

## Sicherheitslücken melden

**Bitte eröffne für Sicherheitsprobleme kein öffentliches Issue.**

Melde Schwachstellen vertraulich über GitHub:

1. Öffne den [**Security**-Tab](../../security) dieses Repositorys.
2. Klicke auf [**Report a vulnerability**](../../security/advisories/new), um ein
   privates Security Advisory zu starten.

> Falls der Button „Report a vulnerability" nicht sichtbar ist, muss ein
> Maintainer zuerst unter **Settings → Security** die Option
> **Private vulnerability reporting** aktivieren.

Bitte gib an:

- eine Beschreibung des Problems und seiner Auswirkung,
- Schritte zur Reproduktion (nach Möglichkeit mit Proof of Concept) und
- die betroffene Version bzw. den Commit sowie deine Umgebung.

Eine erste Rückmeldung erhältst du nach bestem Bemühen. Sobald ein Fix bereit
ist, wird er auf `main` veröffentlicht und das Advisory publiziert.

## Hinweise zu Betrieb und Absicherung

Dieser Server verbindet einen MCP-Client mit der **BuchhaltungsButler-Cloud-API**.
Er kann echte Buchhaltungsdaten lesen und schreiben — behandle ihn entsprechend:

- **Deine API-Zugangsdaten sind Geheimnisse.** `BB_API_CLIENT`, `BB_API_SECRET`
  und `BB_API_KEY` liegen in `.env`, die per `.gitignore` ausgeschlossen ist —
  committe oder teile sie niemals. Falls eines davon abfließt, rotiere es in
  **BuchhaltungsButler → Einstellungen → API**.
- **Zugangsdaten erreichen das Modell nie.** Der Server setzt Basic-Auth und den
  `api_key` bei jedem ausgehenden Request selbst ein; der MCP-Client (und das
  LLM dahinter) sieht ausschließlich Tool-Eingaben und API-Antworten, niemals
  deine Secrets.
- **Der HTTP-Endpunkt ist standardmäßig nicht authentifiziert.** Setze
  `MCP_AUTH_TOKEN` und verlange es über den Header
  `Authorization: Bearer <Token>` — **auch dann, wenn der Server nur auf
  `localhost` läuft.** Der Server validiert derzeit weder den `Host`- noch den
  `Origin`-Header, deshalb kann eine beliebige Webseite im Browser einen
  Endpunkt auf `localhost` per DNS-Rebinding ansprechen. Ein reiner
  localhost-Bind ist also **kein** ausreichender Schutz. Machst du den Server
  über deinen Rechner hinaus erreichbar, betreibe ihn zusätzlich hinter TLS
  (Reverse Proxy), statt den Port direkt zu veröffentlichen.
- **Achte auf die destruktiven Tools.** **Drei** Tools löschen bzw. stornieren
  Daten — `cost_locations_delete`, `receipts_delete_id_by_customer` und
  `postings_cancel` — und mehrere weitere setzen Zustände zurück. Sie tragen
  `destructiveHint` bzw. kein `readOnlyHint`, sodass ein gut umgesetzter Host
  vor der Ausführung nachfragen kann — lass diese Bestätigung aktiviert.
- **Betreibe den Container in einem vertrauenswürdigen Netz** und **halte die
  Abhängigkeiten aktuell** (siehe Dependabot, falls aktiviert).

Danke, dass du dabei hilfst, dieses Projekt und seine Nutzer sicher zu halten.
