# AgentMeter

Eine Windows-Tray-App zur Überwachung der Nutzungslimits von **Claude Code, Codex, Antigravity, Grok und Grok Bot**. Konten lassen sich im Dashboard, in einem Desktop-Widget oder einer kompakten Strip anzeigen, ohne Zugangsdaten in einem zusätzlichen Cloud-Dienst zu verwalten.

**Aktuelle Codeversion: 0.0.1** · Windows 10/11 · Tauri + WebView2 · MIT

[English](./README.md) · [Español](./README.es.md) · [Português](./README.pt.md) · [Italiano](./README.it.md) · [Deutsch](./README.de.md) · [繁體中文](./README.zh-TW.md)

[Funktionen](#features) · [Einrichtung](#installation) · [Konten](#accounts) · [Widget / Strip](#widget-strip) · [Build und Tests](#development)

<a id="features"></a>
## Funktionen

- **Fünf Anbieter**, mit unabhängigen Aktualisierungen, Einrichtungs-/Statusmeldungen, zwischengespeicherten Werten sowie Wiederholungs- und Wartezeitsteuerung. Ein nicht verfügbarer Anbieter blockiert die anderen nicht.
- **Vier Dashboard-Seiten:** Home, Services, Statistics und Settings; eine reine Symbolleiste mit übersetzten Tooltips, Tastaturnavigation und zugänglichen Namen für Bedienelemente.
- **Mehrere Claude-/Codex-Konten:** getrennte Profile, Anmeldung über offizielle CLIs, neue kontospezifische Terminals, separate Kontingente/Caches/Wartezeiten und ein ausgewähltes Konto je Anbieter in der Strip.
- **Kontingentdetails:** gemeldete Zeitfenster, verbrauchte/verbleibende Prozente, Tarif, Reset-Countdowns, Verbrauchstempo und Aufschlüsselungen nach Anbieter/Produkt, sofern verfügbar.
- **Neon-Desktop-Widget:** transparentes Fenster, immer im Vordergrund, Kontonamen, Prozentringe, Sitzungsbalken, ausgerichtete 5h-/7d-Spalten und kleine Reset-Countdowns. Zusätzliche Konten sind innerhalb der Ansicht scrollbar.
- **Widget-Skalierung:** beginnt bei **100%**, bis **300%** in **25%-Schritten**, zusätzlich zur Windows-DPI-Skalierung. Die gespeicherte Skalierung vergrößert die Strip nicht.
- **Kompakte Strip:** ausgewählte Konten und abgekürzte Anbieternamen; frei verschiebbar oder oberhalb einer Taskleiste anheftbar, ohne Arbeitsfläche zu reservieren.
- **Sichtbarkeitssteuerung:** ausgeblendete Anbieter werden nicht abgefragt; Antigravitys Claude+GPT-Pool lässt sich aus-/einblenden, ohne die zugrunde liegenden Werte zu verändern.
- **Gespeicherte Einstellungen:** Sprache, verbrauchte/verbleibende Anzeige, Ansichtsmodus, Widget-Skalierung, Sperre, getrennte Widget-/Strip-Positionen und Taskleisten-Anheftung.
- **Tray und Autostart:** Dashboard öffnen, Zusatzansichten zeigen/verbergen, Position sperren, beim Windows-Login starten und beenden. Gespeicherte Ansichten werden während der Desktop-/Monitorinitialisierung erneut wiederhergestellt.
- **Helles/dunkles Design und fünf UI-Sprachen**, für Dashboard, Widget, Strip und Tray-Menü. Ohne ausdrückliche Themenwahl wird das Systemdesign übernommen.
- **Zurückhaltende Claude-Abfragen:** Pause bei inaktivem/gesperrtem Windows, Serverwartezeiten bleiben nach Neustarts bestehen, und abgelehnte Access-Tokens lösen einen Wiederherstellungsversuch über die offizielle CLI aus.
- **Lokale Integration:** nutzt bestehende Desktop-/CLI-Anmeldungen. Antigravity verwendet seine IDE oder den lokalen `agy`-Server; Browsererweiterung, AgentMeter-Konto und Telemetrie sind nicht erforderlich.

<a id="screenshots"></a>
## Bildschirmaufnahmen

### Dashboard
<p align="center"><img src="./assets/screenshots/dashboard.png" alt="Echtes AgentMeter-Dashboard im dunklen Design" width="644"></p>

### Widget
<p align="center"><img src="./assets/screenshots/widget.png" alt="AgentMeter-Neon-Widget mit mehreren Konten" width="640"></p>

### Strip
<p align="center"><img src="./assets/screenshots/strip.png" alt="Kompakte AgentMeter-Strip" width="500"></p>

Echte Aufnahmen von **AgentMeter**, keine Entwürfe: Dashboard in der Standardbreite von 644 px und Widget bei 100%. Werte und verfügbare Zeitfenster hängen von angemeldeten Konten und Tarifen ab; die Bilder zeigen keine fest vorgegebenen Beispielkontingente.

<a id="providers"></a>
## Unterstützte Anbieter

| Anbieter | Angezeigte Daten, sofern gemeldet | Benötigte Quelle |
|---|---|---|
| **Claude** | Sitzungs-/5-Stunden-, Wochen- und modellspezifische Limits; Tarif und Resets | Angemeldetes Claude-Code-Profil |
| **Codex** | Sitzungs-/5-Stunden- sowie Wochen- oder Monatsfenster je nach Tarif/Konto | Codex Desktop oder angemeldetes Codex-CLI-Profil |
| **Antigravity** | Gemini- und Claude+GPT-Pools mit 5-Stunden-/Wochenfenstern | Angemeldete Antigravity-IDE **oder eigenständige `agy`-CLI**, weiterhin laufend |
| **Grok** | Abonnementkontingent und Produktaufschlüsselungen, sofern gemeldet | Angemeldetes Grok-Build-CLI-Profil |
| **Grok Bot** | Separates Wochenkontingent | Angemeldete Grok-Bot-Desktop-App |

AgentMeter zeigt verfügbare Daten, statt fehlende Zeitfenster zu erfinden. Eine Codex-Karte mit ausschließlich wöchentlichem Limit nutzt den gesamten Kontingentbereich. Das Widget blendet Konten/Anbieter ohne brauchbare Werte aus; Home kann Einrichtungs-/Fehlerkarten behalten. Ausdrücklich ausgeblendete Anbieter werden nicht abgefragt.

<a id="installation"></a>
## Installation und Anbietereinrichtung

1. Einen verfügbaren Installer aus [GitHub Releases](https://github.com/carlos-mto/AgentMeter/releases) herunterladen oder den [aktuellen Quellcode bauen](#development). Falls noch kein Installer verfügbar ist, aus den Quellen bauen.
2. Installer ausführen und **AgentMeter** öffnen. Der aktuelle Code erzeugt `AgentMeter_0.0.1_x64-setup.exe` und `agentmeter.exe`.
3. Anmeldung/Einrichtung der gewünschten Anbieter abschließen. Das Schließen des Dashboards lässt die App im Tray weiterlaufen; **Quit** beendet sie.

**Windows 10/11 und Microsoft Edge WebView2 Runtime sind erforderlich.** Für eigene Builds werden zusätzlich die unten genannten Werkzeuge benötigt. Aktuelle Builds sind nicht codesigniert; vertrauenswürdige Releases/Quellen verwenden.

- **Claude:** bei Bedarf Claude Code installieren, `claude` ausführen und anmelden. Für normale Prüfungen muss die CLI nicht weiterlaufen.
- **Codex:** für das aktuelle Konto in Codex Desktop anmelden oder **Services → Accounts → Sign in** für ein separates CLI-Profil verwenden. Die offizielle `codex`-CLI ist für diesen Knopf und **Open CLI** erforderlich.
- **Antigravity:** die angemeldete IDE oder eine angemeldete `agy`-Terminalsitzung weiterlaufen lassen. AgentMeter findet den Server auf `127.0.0.1`; manuelle Port-/Tokenkonfiguration ist unnötig. Bei `agy` wird keine IDE benötigt. Laufen beide, hat die IDE Vorrang. Ohne beide können noch gültige Cache-Zeitfenster bis zu 24 Stunden verfügbar bleiben.
- **Grok Bot:** die [Desktop-App](https://docs.x.ai/grok-bot/get-started) installieren und anmelden. Das Kontingent ist unabhängig von Grok/SuperGrok. Erneut öffnen, wenn AgentMeter neue Anmeldedaten benötigt.
- **Grok:** Grok Build installieren und einmal anmelden. Erneut öffnen, wenn AgentMeter neue Anmeldedaten anfordert.

Gemini-Modelle bleiben über **Antigravitys Kontingent-Pools** verfügbar, nicht als eigenständiger Anbieter.

<a id="dashboard"></a>
## Dashboard-Navigation

Das Standardfenster misst **644 × 840 logische Pixel**. Es lässt sich bis auf **380 × 520** verkleinern und besitzt anpassungsfähige Karten sowie eine **68 px breite Symbolleiste**. Beim Zeigen auf ein Symbol erscheint dessen übersetzter Name; Design- und Sprachverknüpfungen stehen unten.

| Seite | Zweck |
|---|---|
| **Home** | Karten je Anbieter/Konto, echte Zeitfenster, Tarif/Status, Resets, Verbrauchstempo und Aufschlüsselungen. Manuelle Aktualisierung und Sichtbarkeitskontrollen. |
| **Services** | Zentraler Ort für Kontenverwaltung, Strip-Kontenauswahl, Anbietersichtbarkeit, Verbindungsstatus und Einrichtungshinweise. |
| **Statistics** | Tabelle des aktuellen Kontingentstands mit verbrauchten/verbleibenden Werten und Cache-Status; berücksichtigt Anbieter-/Pool-Sichtbarkeit. Keine zusätzlichen Anfragen, historischen Diagramme oder Mittelwerte über unzusammenhängende Pools. |
| **Settings** | Globales Design, Sprachverknüpfungen und verbrauchte/verbleibende Anzeige; Konten werden in Services verwaltet, nicht zusätzlich hier. |

Der **Claude+GPT-Augenknopf von Antigravity** blendet diesen Pool in allen Ansichten aus/ein. Ist er ausgeblendet, nutzen Widget/Strip Geminis **5h-/7d**-Fenster. Die Einstellung verändert weder Abfragen noch ursprüngliche Anbieterdaten.

<a id="accounts"></a>
## Mehrere Claude- und Codex-Konten

1. **Services → Accounts** öffnen. Konten sind nach Anbieter gruppiert.
2. Claude oder Codex wählen und **Add account** anklicken; nach der Anmeldung zeigt das Konto den Benutzernamen aus seinen Zugangsdaten (bis dahin wird es nummeriert, z. B. „Konto 2“).
3. Das Verzeichnis leer lassen, um ein getrenntes Profil anzulegen, oder ein vorhandenes **absolutes Konfigurationsverzeichnis** angeben, keine Zugangsdaten-Datei.
4. Mit **Sign in** über die offizielle CLI anmelden. AgentMeter kopiert keine Zugangsdaten zwischen Profilen.

| Aktion / Verhalten | Wirkung |
|---|---|
| **Open CLI** | Öffnet ein neues Terminal mit nur dem profilspezifischen `CLAUDE_CONFIG_DIR` oder `CODEX_HOME`; bestehende Terminals und die globale Umgebung bleiben unverändert. |
| **Check accounts** | Prüft aktivierte Profile unter Beachtung von Wartezeiten und Ablaufsteuerung. Claude behält den Mindestabstand von sechs Minuten und die Pause bei Inaktivität/Sperre. |
| **Selected for Strip** | Wählt ein Konto je Anbieter für die Strip, ohne andere Konten aus Home/Statistics/Widget auszublenden. |
| **Remove** | Entfernt den Profileintrag, lässt Dateien und laufende Sitzungen aber bestehen. |
| **Current account** | Implizites Standardprofil, das Umgebungsvariablen oder `~/.claude` / `~/.codex` berücksichtigt; es kann nicht entfernt werden. |

Jedes Profil besitzt eigene Kontingent-/Cache-/Wartezeitdaten. Verfügbare lokale Benutzernamen haben Vorrang vor Aliasen; im Widget erscheinen sie kleiner und in Kleinbuchstaben. E-Mail-Domains und Tokens werden weder angezeigt noch im Profilregister gespeichert. Einen Anbieter auszublenden pausiert alle seine Konten. Der Widget-Knopf **Accounts** öffnet direkt Services.

Mehrkontenverwaltung ist derzeit auf **Claude und Codex** beschränkt. Andere Anbieter behalten ihr bisheriges Einzelkontoverhalten; es gibt keine automatische Kontenrotation.

<a id="widget-strip"></a>
## Widget und Strip

Mit den Knöpfen der Seitenleiste oder dem Tray-Menü eine Zusatzansicht wählen.

### Widget

- Rahmenlos, transparent und immer im Vordergrund, mit AgentMeter-Messsymbol und Neon-Layout.
- Zeigt alle Claude-/Codex-Konten mit brauchbaren Werten, Prozentringe, Sitzungsbalken und ausgerichtete **5h-/7d**-Spalten. Bei ausschließlich wöchentlichem Limit bleibt die 5h-Spalte leer; kleine Reset-Countdowns stehen darunter.
- Unkonfigurierte Konten/Anbieter und Einträge ohne brauchbare Daten werden ausgeblendet; gültige Werte machen sie wieder sichtbar. Zusätzliche Zeilen sind innerhalb der Ansicht scrollbar.
- Zum Bewegen die Kopfzeile ziehen; die Positionssperre verhindert unbeabsichtigtes Verschieben.
- **− / +** regelt **100–300%** in **25%-Schritten**. Der Wert wird gespeichert; Windows-DPI-Skalierung kommt zusätzlich hinzu.
- **Accounts** öffnet Services; **Open dashboard** öffnet Details, ohne das Widget auszublenden.

### Strip

- Kompakte horizontale Leiste mit einem ausgewählten Claude-/Codex-Konto je Anbieter, abgekürzten Namen, Prozentwerten und Reset-Tooltips.
- Blendet wie das Widget Anbieter aus, deren ausgewähltes Konto noch keine verwertbaren Werte hat (nicht konfiguriert, nicht verfügbar, Fehler oder Anmeldung erforderlich); diese Zustände stehen im Dashboard.
- Behält ihre ursprüngliche kompakte Skalierung, unabhängig von der Widget-Vergrößerung.
- Außerhalb der Bedienelemente ziehen, um sie zu bewegen. Mit dem Stecknadelknopf oberhalb einer Taskleiste anheften und auf einen freien Abschnitt ziehen.
- Das Anheften reserviert keine Arbeitsfläche. Die Überlagerung weicht zurück, wenn die Taskleiste automatisch verborgen wird oder eine andere App im Vollbild läuft.

Widget und Strip speichern **getrennte Positionen**. **Open dashboard** erhält Sichtbarkeit und Taskleisten-Anheftung; **Hide** oder das Abwählen im Tray-Menü verbirgt die Zusatzansicht. Beide verwenden Dashboard-Daten ohne weitere Kontingentanfragen.

<a id="tray"></a>
## Tray und Autostart

Ein Linksklick auf das Tray-Symbol schaltet die Dashboard-Sichtbarkeit um. Das Rechtsklick-Menü bietet **Open dashboard**, **Show widget**, **Show strip**, **Lock widget position**, **Launch at startup** und **Quit**.

Bei Bedarf **Launch at startup** aktivieren. Vor dem Beenden Widget oder Strip wählen, wenn diese Ansicht beim Windows-Login wieder erscheinen soll. Der Autostart verwendet `--hidden`: Dashboard bleibt geschlossen; gespeicherter Modus, Skalierung und Position werden während der Desktop-/Monitorinitialisierung erneut wiederhergestellt. Ist keine Zusatzansicht aktiviert, ist ein reiner Tray-Start beabsichtigt.

<a id="appearance"></a>
## Darstellung und Sprache

- **Design:** hell und dunkel in der gesamten App; folgt dem System bis zu einer ausdrücklichen Wahl. Das Widget behält Neon-Design und transparentes Fenster; Texte und Bedienelemente werden nicht ausgeblendet.
- **Kontingentanzeige:** **Used** oder **Remaining** wählen, einheitlich in Dashboard, Statistics, Widget und Strip.
- **UI-Sprachen:** **English, Español, Português, Italiano und Deutsch**. **Language** oben rechts oder über Seitenleiste/Settings ändern. Die Auswahl wird gespeichert und gilt auch für das Tray-Menü.
- Beim ersten Start wird eine unterstützte Windows-Sprache erkannt, sonst Englisch verwendet. Anbieternamen und technische Rohdiagnosen behalten ihren Ursprungstext.

Die Dokumentation gibt es auf Englisch, Spanisch, Portugiesisch, Italienisch, Deutsch und traditionellem Chinesisch. Das chinesische README bedeutet **nicht**, dass bereits eine chinesische UI implementiert ist.

<a id="privacy"></a>
## Datenschutz, lokale Daten und Kompatibilität

Keine Telemetrie, Nutzungsanalyse oder AgentMeter-Cloud-Konten. Kontingentabfragen kontaktieren Anbieter mit unterstützten lokalen Anmeldungen; AgentMeter hat keinen Upload-/Synchronisierungsdienst.

- AgentMeter liest bei Bedarf vorhandene Desktop-/CLI-Zugangsdaten, nutzt aber keine Refresh-Tokens der Anbieter. Nach einem Claude-`401` versucht es die Wiederherstellung über `claude update` und liest danach den Access-Token erneut; dieser Befehl kann Claude Code selbst aktualisieren.
- Antigravity wird über den lokalen IDE-/`agy`-Server abgefragt, ohne eine Google-Anmeldung zu verwalten.
- Grok Bots kurzlebiger Access-Token wird für die Anfrage lokal mit Windows DPAPI entschlüsselt; sein Refresh-Token wird von AgentMeter weder entschlüsselt noch verwendet, gecacht oder gesendet.
- Ein Profil hinzuzufügen kopiert keine Zugangsdaten; es zu entfernen löscht keine Kontodateien.

Der Datenordner ist **`%LOCALAPPDATA%\stackly-agent-manager`**. Externe CLI-Verzeichnisse ändern sich nicht:

| Ort / Identität | Inhalt |
|---|---|
| `accounts.json` | Aliase, Konfigurationspfade und ausgewählte Strip-Konten, keine Zugangsdaten. |
| `accounts/<provider>/<id>` | Standardverzeichnisse für getrennte Profile; offizielle CLIs verwalten deren Anmeldungen. |
| `widget.json` | Ansichts-/Sprachpräferenzen und gespeicherte Positionen. |
| `provider-cache` | Kontingent-/Wartezeitstände und begrenzte Diagnoseinformationen. |

<a id="troubleshooting"></a>
## Fehlerbehebung

| Problem | Prüfung |
|---|---|
| Anbieter/Konto fehlt im Widget | Anbieter in Services aktivieren und anmelden. Das Widget benötigt brauchbare Werte; Home kann Einrichtungs-/Fehlerzustände zeigen. |
| Widget/Strip erscheint nicht beim Login | **Launch at startup** aktivieren und gewünschten Ansichtsmodus speichern, nicht nur Dashboard. Desktop-/Monitorwiederherstellung abwarten; bei Bedarf im Tray öffnen. |
| Grok fehlt oder verlangt Anmeldung | Grok Build installieren/öffnen, anmelden und Karte aktualisieren. AgentMeter erneuert den CLI-Token nicht selbst. |
| Claude wird vom Server begrenzt | Angezeigten Countdown beachten. Aktualisierung und **Check accounts** umgehen keine Wartezeiten; Neustarts löschen sie nicht. |
| Claude aktualisiert nicht bei Inaktivität/Sperre | Beabsichtigte Pause; nach neuer Aktivität werden Prüfungen verzögert, um eine Anfragelawine zu vermeiden. Bestehende Wartezeiten gelten weiter. |
| Claude lehnt den Access-Token ab | Wiederherstellung über offizielle CLI wird versucht; bei Fehlschlag Claude Code öffnen und Anmeldung prüfen. |
| Antigravity verlangt einen Client | Angemeldete IDE oder `agy`-Sitzung weiterlaufen lassen. Nur `agy` zu installieren oder `agy --help` auszuführen reicht nicht. |
| Grok Bot verlangt Anmeldung | Grok Bot erneut öffnen; ein späterer Check liest den erneuerten kurzlebigen Access-Token. |
| Unbekannter Herausgeber in Windows | Builds sind nicht codesigniert; vertrauenswürdige Releases nutzen oder aus Quellen bauen. |

<a id="limitations"></a>
## Einschränkungen

- **Nur Windows**; dieses Projekt unterstützt derzeit keine macOS-/Linux-Builds.
- Anbieterendpunkte sind undokumentiert; Verfügbarkeit, Tarife und Zeitfensterformate können unabhängig wechseln.
- Statistics zeigt den aktuellen Stand, keine gespeicherte Nutzungshistorie, Token-Abrechnung oder Prognose.
- Mehrkontenprofile werden nur für Claude/Codex unterstützt; automatische Rotation fehlt.
- Es gibt ein einziges Zusatzfenster: Es kann zwischen Monitoren verschoben werden, Widget/Strip wird aber **nicht automatisch auf jedem Monitor/jeder Taskleiste dupliziert**.
- Cache-Daten sind ausdrücklich gekennzeichnet und garantieren keine aktuellen Live-Kontingente.

<a id="development"></a>
## Aus Quellcode bauen und testen

### Voraussetzungen

- Windows 10/11 und WebView2 Runtime.
- **Node.js 22+** mit npm, auch für optionale native WebView-Probes benötigt.
- **Rust stable**, mit Windows-MSVC-Toolchain.
- Visual Studio / Build Tools mit **Desktop development with C++** und Windows-10/11-SDK.

Im Stammverzeichnis des Repositories:

```powershell
npm ci
npm run tauri -- dev
```

Windows-Installer bauen:

```powershell
npm run tauri -- build --bundles nsis -- --locked
```

Ausgaben für 0.0.1:

```text
src-tauri/target/release/agentmeter.exe
src-tauri/target/release/bundle/nsis/AgentMeter_0.0.1_x64-setup.exe
```

Release: `npm run release` (oder `pwsh scripts/release.ps1 -DryRun` zum Probelauf) führt die Tests aus, baut den NSIS-Installer, setzt den Tag `v<Version>` und veröffentlicht das GitHub-Release mit Installer und SHA-256. Erfordert `gh auth login`.

Automatisierte Tests ausführen:

```powershell
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Die optionalen nativen Probes für [Dashboard](./tests/smoke/dashboard.smoke.mjs) und [Konten](./tests/smoke/accounts.smoke.mjs) benötigen **vorübergehendes, ausschließlich lokales Loopback-CDP**; im normalen Betrieb ist es unnötig und darf nicht aktiv bleiben. Die [Architektur](./docs/architecture.md) beschreibt Implementierung, Abfragerichtlinien und native Integration.

<a id="project"></a>
## Projekt und Lizenz

- [Architektur](./docs/architecture.md)
- [Tauri + Rust + Windows-Architektur](./docs/tauri-rust-windows-architecture.md)
- [Problem melden](https://github.com/carlos-mto/AgentMeter/issues)
- Inspiriert von mehreren Community-Projekten und Werkzeugen.

Veröffentlicht unter der [MIT-Lizenz](./LICENSE).
