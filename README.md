# TubeCraft

Web-basierter 3D-Designer für Rohr-Stecksysteme, kompatibel mit QUADRO®-Bauteilen.
Inoffizielles Hobby-Projekt, nicht mit dem Hersteller verbunden. Keine Statik- oder Sicherheitsprüfung.

Version 0.1.0 läuft komplett im Browser, ohne Backend.

## Funktionen

- 3D-Editor im 20-cm-Raster: Rohre (75, 35 und 15 cm), Platten, halbe Platten, Lochplatten
- Kupplungen werden automatisch aus den Rohren berechnet (Raum 3–6, Fläche 2–4)
- Teileliste inklusive Rohr- und Plattenschrauben, eigene Teileliste mit Fehlteilen, optional nur vorhandene Teile zulassen
- Platten werden kollisionsfrei an zwei gegenüberliegenden Rohren verschraubt, die Plattenschraube ersetzt dort die Rohrschraube
- Bauplan Schritt für Schritt, Ebene für Ebene; Platten erst, wenn ihr Rahmen geschlossen ist
- Import der Bestandsliste (`.qbl`) aus dem QUADRO 3D-Programm als eigene Teileliste
- QDF-Import (Rohre, Platten, 45°-Dachkupplungen; Spezialteile werden übersprungen und gemeldet)
- Speichern im Browser und als Datei (`.tubecraft.json`), Rückgängig/Wiederholen, Deutsch/Englisch

## Bedienung

| Taste | Aktion |
| --- | --- |
| `V` `T` `P` `E` | Auswählen, Rohr, Platte, Löschen |
| `1` `2` `3` | Rohrlänge 35 / 15 / 75 cm |
| `R` | Richtung neuer Rohre am Boden drehen |
| `Pos1` oder `H` | Kamera auf das ganze Modell ausrichten |
| `Entf` | Auswahl löschen |
| Rechtsklick | Teil unter dem Mauszeiger löschen |
| `Umschalt`+Klick | Mehrere Teile auswählen |
| `Strg+Z` / `Strg+Y` | Rückgängig / Wiederholen |
| `←` `→` | Bauplan-Schritt |

Maus: links drehen, rechts verschieben, Rad zoomen. `.qdf`- und `.json`-Dateien lassen sich auch ins Fenster ziehen.

## Entwicklung

```sh
npm install
npm run dev      # Entwicklungsserver
npm test         # Tests
npm run build    # Produktions-Build nach dist/
```

Zum Abgleich mit echten Modellen (nicht im Repo, da urheberrechtlich geschützt):

```sh
QDF_SAMPLES_DIR=/pfad/zu/qdf-dateien npm test
```

## Betrieb

```sh
APP_VERSION=$(npm run -s app-version) docker compose up -d --build   # http://localhost:8080
```

## Versionierung

Die Version in der Fußzeile der App kommt aus git (`npm run -s app-version`):

- sauberer Checkout des Tags `vX.Y.Z` → `X.Y.Z`
- alles andere → `X.Y.Z-<branch>.<Commits seit letztem Tag>+<commit>[.dirty]`, wobei `X.Y.Z` die Zielversion aus `package.json` ist

Im Docker-Image gibt es kein git, dort wird die Version über `APP_VERSION` hineingereicht.

## Aufbau

- `src/core/` – Datenmodell, Geometrie, Kupplungs-Ableitung, QDF-Parser, Teileliste, Bauschritte (ohne UI, getestet)
- `src/ui/` – React-Oberfläche und 3D-Ansicht (three.js über react-three-fiber)
- `src/store.ts` – Anwendungszustand, Undo-Verlauf, Speicherung im Browser

## Lizenz

AGPL-3.0-or-later, siehe [LICENSE](LICENSE).
