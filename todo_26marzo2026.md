## Todo 26 Marzo 2026

### FASE 1 - Fix bloccanti (ora)
- [x] Fix CSS layout h-screen
- [x] Fix filtri Multi* in `mapUtils.ts`
- [x] Fix CRS / riproiezione `proj4`

### FASE 2 - Infrastruttura progetto (1 settimana)
- [x] Cartella progetto strutturata (server)
- [x] Tabella `map_snapshots` nel DB
- [x] API `/map-snapshots` (CRUD)
- [x] Editor `ai_config/` nell'interfaccia (Impostazioni)

### FASE 3 - WebMap GIS (1-2 settimane)
- [x] SourceLoader: WMS/WMTS/XYZ (MapLibre nativo)
- [x] SourceLoader: WFS + ArcGIS REST
- [x] SourceLoader: Shapefile (`shpjs`)
- [x] SourceLoader: SpatiaLite (riuso parser `.sqlite` nel loader GeoPackage/SpatiaLite)
- [x] Preset italiani (IGM, Geoportale, LiDAR - template configurabili)

### FASE 4 - DataLinker + MapExporter (1 settimana)
- [x] `normalizeUSCode()` in `shared/`
- [x] Popup arricchito con lookup US
- [x] Canvas capture + overlay
- [x] Inserimento snapshot in relazione con AI (prompt report giornata)

### FASE 5 - Plugin QGIS (separato, Python)
- [ ] Export bundle `.archeodoc`
- [ ] `manifest.json` generator
- [ ] Sync bidirezionale

### Note operative
- FASE 5 rimane separata dal repository web (richiede nuovo pacchetto Python plugin QGIS).
