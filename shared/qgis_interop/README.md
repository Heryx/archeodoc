# QGIS interoperability schema

Contratto condiviso tra il futuro plugin QGIS (Python, repo separato) e il server ArcheoDoc
(TypeScript). Non è codice eseguito da questa app: è la definizione delle regole e dei formati
file su cui i due lati devono restare d'accordo.

- **`rules.json`** — unica fonte di verità per le regole di validazione (nomi campo US
  accettati, formati layer supportati, policy sui duplicati, ecc). Il plugin QGIS deve
  incorporare/leggere una copia di questo file, non ridefinire le regole a mano in Python.
  Lato server, importare `rules.ts`, mai leggere `rules.json` direttamente.
- **`manifest.schema.json`** — JSON Schema di `archeodoc/manifest.json`, il file che il plugin
  scrive accanto al progetto QGIS a ogni check: elenco dei layer leggibili da ArcheoDoc con path
  relativi al progetto.
- **`us_links.schema.json`** — JSON Schema di `archeodoc/us_links.json`: mappa
  `codice US → (layer, feature)`, sostituisce l'euristica `guessUSCode` in
  [`client/src/components/webmap/modules/FeaturePopup.tsx`](../../client/src/components/webmap/modules/FeaturePopup.tsx)
  con un collegamento esplicito prodotto dal plugin.

## Flusso

1. L'utente lavora nel progetto QGIS come sempre (nessuna modifica al progetto stesso).
2. Il plugin esegue il check e scrive/aggiorna `archeodoc/manifest.json`, `us_links.json`,
   `report.json` nella cartella del progetto (mai dentro il progetto).
3. ArcheoDoc importa puntando alla cartella di progetto: legge `manifest.json` per sapere quali
   file aprire (gpkg, shp, geojson, raster georeferenziati interni/esterni) e `us_links.json` per
   il collegamento diretto US↔geometria, senza più indovinare i nomi dei campi.

## Cosa NON è ancora fatto

Questo è solo il contratto dati. Restano da implementare separatamente:

- il plugin QGIS (PyQGIS) che genera questi file e fa il check;
- lato server, un validatore che legge `manifest.json`/`us_links.json` e la lettura di
  Shapefile e raster georeferenziati esterni (oggi `server/routes/webmap_routes.ts` importa solo
  gpkg/geojson);
- l'estensione del popup mappa per usare `us_links.json` invece di `guessUSCode` quando presente.
