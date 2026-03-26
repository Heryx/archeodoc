# ArcheoDoc - Documentazione di Scavo Archeologico

ArcheoDoc e una web app TypeScript (Node.js + Express + SQLite + React) per gestire la documentazione di scavo:
- cantieri e giornate,
- schede US/SAS/RA,
- quality control,
- supporto AI,
- import da Google Docs e GeoPackage,
- gestione thesaurus di progetto.

## Funzionalita principali

### 1) Multi-progetto
- Ogni progetto ha cartelle dedicate per database, media, export e backup.
- Gestione da UI in `Progetti dati`.
- Possibilita di scegliere preset schema (custom o ICCD) per ogni progetto.

### 2) Schede US complete
- Campi top-level (codice, tipo, definizione, descrizione, quota, settore, periodi, ecc.).
- Relazioni stratigrafiche/fisiche.
- Sezione guida compilazione direttamente nel form US.
- Normalizzazione `tipo` e `definizione` con thesaurus del progetto.

### 3) Harris Matrix in sezione separata
- Pagina dedicata: `Harris Matrix` (non dentro la scheda US).
- Modalita:
  - `Tutto`
  - `Sequenza fisica`
  - `Sequenza stratigrafica`

### 4) Schede materiali (RA)
- Gestione schede RA collegate alle US.
- Filtri per US e operazioni CRUD da interfaccia.

### 5) Thesaurus di progetto
- Editor schema con sezione dedicata `Thesaurus`.
- Selezione del campo thesaurus da compilare.
- Popolamento voci:
  - manuale,
  - da DB progetto,
  - da file SQLite esterno (`.sqlite`, `.db`, `.gpkg`).

### 6) Import GeoPackage
- Import US pre-compilate da file `.gpkg` dalla pagina upload.
- Preview struttura tabelle prima dell'import (`Analizza struttura`).
- Mapping automatico dei campi con deduplica e warning.
- Opzione per importare attributi extra in `schedaData`.
- WebMap dedicata per interrogare geometrie/attributi (`Analisi e strumenti > WebMap`),
  con lettura stile layer (`layer_styles` QML/SLD) quando disponibile.
- Supporto CRS da GeoPackage in WebMap con gestione SRID per layer vettoriali.

### 7) WebMap GIS (QGIS-like)
- Basemap selezionabile: `Nessuna`, `OSM`, `Satellite`, `Topo`.
- Layer panel con:
  - visibilita layer,
  - opacita/stile per layer,
  - zoom su layer,
  - highlight del layer attivo.
- SourceLoader da sidebar:
  - XYZ / WMTS,
  - WMS (via proxy server),
  - WFS (GeoJSON),
  - ArcGIS REST,
  - import shapefile `.zip`.
- Barra stato in basso con:
  - stato mappa,
  - probe tile OSM,
  - zoom e scala visibilita,
  - CRS del layer/progetto attivo.
- Popup feature con attributi e lookup US normalizzato (`normalizeUSCode`).

### 8) MapExporter e snapshot mappa
- Modale dedicata `MapExporter` (toolbar WebMap) con:
  - tab `Cattura` (anteprima + salvataggio),
  - tab `Libreria` (lista snapshot salvati).
- Overlay esportazione:
  - titolo,
  - didascalia,
  - data/ora,
  - freccia nord opzionale,
  - barra scala opzionale.
- Salvataggio snapshot per cantiere in media progetto (`_map_snapshots/<cid>/...`).
- Metadati snapshot persistiti: extent, center, zoom, bearing, pitch, tags.

### 9) Google Docs
- Setup cantiere su Google Drive (`/api/cantieri/:id/google/setup`).
- Sync in preview e applicazione (`/api/cantieri/:id/google/sync`).
- Parsing strutturato + integrazione con normalizzazione thesaurus.

### 10) QC e AI
- QC su nomenclatura, completezza, coerenza relazioni e allegati.
- AI provider supportati:
  - Gemini
  - Claude
- Selezione provider automatica o forzata da configurazione.

### 11) Backup
- Backup manuale con endpoint `GET /api/backup`.
- Backup giornaliero automatico per progetto (job periodico lato server).

---

## Requisiti

- Node.js 18+ (consigliato 20+)
- npm
- Sistema operativo: Windows, macOS o Linux

---

## Avvio rapido

### Opzione A - launcher

Windows:
```bat
avvia.bat
```

macOS/Linux:
```bash
chmod +x avvia.sh
./avvia.sh
```

### Opzione B - sviluppo manuale

```bash
npm install
npm run dev
```

App disponibile su:
`http://localhost:5000`

---

## Configurazione AI (`.env`)

Crea un file `.env` nella root del progetto.

Esempio:
```env
# opzionale: auto, gemini o claude
AI_PROVIDER=auto

# almeno una chiave AI
GEMINI_API_KEY=metti-qui-la-chiave
# ANTHROPIC_API_KEY=sk-ant-...

# opzionale
PORT=5000
```

Note:
- Se `AI_PROVIDER` non e impostato, l'app sceglie automaticamente il provider disponibile.
- Se sono presenti entrambe le chiavi, viene preferito Gemini in auto-detect.

---

## Setup Google Docs (opzionale)

Per le funzioni Google (setup/sync):

1. Crea credenziali OAuth su Google Cloud.
2. Salva `credentials.json` nella root del progetto.
3. Collega l'account da `Impostazioni > Google`.
4. Verifica gli scope richiesti:
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/drive.file`

Endpoint utili:
- `GET /api/google/status`
- `GET /api/google/auth`
- `POST /api/google/revoke`

Se compare l'errore `insufficient authentication scopes`:
- disconnetti Google (`/api/google/revoke` o da UI),
- rifai login OAuth,
- conferma tutti i permessi richiesti.

---

## Struttura dati progetto

Per ogni progetto, ArcheoDoc crea una struttura simile:

```text
<workspace>/<project-id>/
  project.sqlite
  media/
  exports/
  backups/
  project.json
  documentation.schema.json
```

Il workspace di default e:
`%USERPROFILE%/ArcheoDocProjects` (Windows)
oppure la home utente su altri sistemi.

Puoi cambiarlo con:
`ARCHEODOC_WORKSPACE_ROOT`

---

## Script npm utili

- `npm run dev` - avvio in sviluppo
- `npm run build` - build produzione
- `npm run start` - avvio da `dist`
- `npm run check` - typecheck TypeScript
- `npm test` - test automatici
- `npm run db:push` - sync schema DB con Drizzle

---

## API principali

- Progetti
  - `GET /api/projects`
  - `POST /api/projects`
  - `POST /api/projects/:id/select`
  - `GET /api/projects/:id/schema`
  - `PATCH /api/projects/:id/schema`
  - `POST /api/projects/:id/thesaurus/suggest-db`
  - `POST /api/projects/:id/thesaurus/suggest-sqlite`

- Cantieri/US
  - `GET /api/cantieri`
  - `GET /api/cantieri/:cid/us`
  - `POST /api/cantieri/:cid/import-geopackage/preview`
  - `POST /api/cantieri/:cid/geopackage/webmap-preview`
  - `POST /api/cantieri/:cid/import-geopackage`
  - `POST /api/cantieri/:cid/webmap/sketches/export-geopackage`

- WebMap tile/proxy
  - `GET /api/map-proxy/wms`
  - `GET /api/map-tiles/osm/:z/:x/:y.png`
  - `GET /api/map-tiles/opentopo/:z/:x/:y.png`
  - `GET /api/map-tiles/esri/:z/:y/:x`

- Map snapshots
  - `GET /api/cantieri/:cid/map-snapshots`
  - `POST /api/cantieri/:cid/map-snapshots`
  - `PATCH /api/map-snapshots/:id`
  - `DELETE /api/map-snapshots/:id`

- Google
  - `POST /api/cantieri/:id/google/setup`
  - `POST /api/cantieri/:id/google/sync`

- Backup
  - `GET /api/backup`

---

## Aggiornamenti

Quando aggiorni il codice:
- mantieni i dati progetto (`project.sqlite`, `media`, `exports`, `backups`),
- riavvia l'app,
- se necessario esegui `npm install` per dipendenze nuove.

Controllo aggiornamenti da UI:
- usa il pulsante `Controlla aggiornamenti` nella barra laterale in basso (vicino a impostazioni/tema),
- se ci sono aggiornamenti disponibili, usa `Aggiorna ora` per eseguire `git pull --ff-only`,
- dopo l'aggiornamento e consigliato riavviare l'app,
- il launcher `avvia.bat` non esegue piu `git fetch/pull` automatico, per ridurre i tempi di avvio.
