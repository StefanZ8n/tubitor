# Tubitor

> [!IMPORTANT]
> **This project is no longer developed.** It is published as-is and will not receive updates, bug fixes or support. Issues and pull requests will likely go unanswered. Feel free to fork it.

Web-based 3D designer for tube construction kits, compatible with QUADRO® parts.
Unofficial hobby project, not affiliated with the manufacturer. No structural or safety checks.

Version 0.1.0 runs entirely in the browser, without a backend.

## Features

- 3D editor on a 20 cm grid: tubes (75, 35 and 15 cm), panels, half panels, perforated panels
- Connectors are derived automatically from the tubes (3D 3–6 way, flat 2–4 way)
- Auto colour: randomly colours tubes and panels in the four basic colours
- Parts list (screws as additional info), own parts inventory with missing parts, optionally allow only parts in stock
- Panels are screwed collision-free onto two opposite tubes; the panel screw replaces the tube screw there
- Step-by-step building plan, layer by layer; panels only once their frame is closed
- Import of the stock list (`.qbl`) from the QUADRO 3D program as own parts inventory
- QDF import (tubes, panels, 45° roof connectors; special parts are skipped and reported)
- Saving in the browser and as a file (`.tubitor.json`), undo/redo, German/English

## Usage

| Key | Action |
| --- | --- |
| `V` `T` `P` `E` | Select, tube, panel, erase |
| `1` `2` `3` | Tube length 35 / 15 / 75 cm |
| `R` | Rotate direction of new tubes on the ground |
| `Home` or `H` | Fit camera to the whole model |
| `Del` | Delete selection |
| Right click | Delete part under the mouse pointer |
| `Shift`+click | Select multiple parts |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `←` `→` | Building plan step |

Mouse: left to rotate, right to pan, wheel to zoom. `.qdf` and `.json` files can also be dropped onto the window.

## Development

```sh
npm install
npm run dev      # development server
npm test         # tests
npm run build    # production build into dist/
```

To check against real models (not in the repo, as they are copyrighted):

```sh
QDF_SAMPLES_DIR=/path/to/qdf-files npm test
```

## Deployment

```sh
APP_VERSION=$(npm run -s app-version) docker compose up -d --build   # http://localhost:8080
```

## Versioning

The version in the app footer comes from git (`npm run -s app-version`):

- clean checkout of tag `vX.Y.Z` → `X.Y.Z`
- anything else → `X.Y.Z-<branch>.<commits since last tag>+<commit>[.dirty]`, where `X.Y.Z` is the target version from `package.json`

The Docker image has no git, so the version is passed in via `APP_VERSION`.

## Structure

- `src/core/` – data model, geometry, connector derivation, QDF parser, parts list, building steps (no UI, tested)
- `src/ui/` – React interface and 3D view (three.js via react-three-fiber)
- `src/store.ts` – application state, undo history, browser storage

## License

AGPL-3.0-or-later, see [LICENSE](LICENSE).
