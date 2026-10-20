# ArcheoDoc Checker (plugin QGIS)

Plugin QGIS (PyQGIS) che valida un progetto rispetto alle regole di interoperabilità con
ArcheoDoc, senza mai modificare il progetto stesso. Scrive i risultati in una sottocartella
`archeodoc/` accanto al file `.qgz`/`.qgs`:

- `manifest.json` — elenco dei layer leggibili da ArcheoDoc (vettoriali gpkg/shp/geojson/kml,
  raster georeferenziati anche con world file esterno)
- `us_links.json` — collegamento esplicito `codice US → (layer, feature)`, calcolato dal campo
  attributo riconosciuto (`us_code`, `codice_us`, ecc.)
- `report.json` — errori/warning del check (CRS mancante o incoerente, geometrie non valide,
  codici US duplicati sullo stesso layer, raster non georeferenziati)

Se il progetto contiene raster **GeoTIFF** (non ancora leggibili dalla WebMap), il plugin chiede
se convertirli in PNG georeferenziato (world file) tramite GDAL/Processing: le copie vengono
salvate in `archeodoc/rasters/` e il manifest viene aggiornato per puntare alla copia convertita.
Il progetto QGIS e i file raster originali non vengono mai toccati.

Le regole (nomi campo, formati supportati, policy duplicati) vivono in
[`archeodoc_checker/core/rules.json`](archeodoc_checker/core/rules.json), copia di
[`shared/qgis_interop/rules.json`](../shared/qgis_interop/rules.json) nel repo principale.
**Se una cambia, sincronizzare anche l'altra a mano** — non c'è ancora un build step automatico
che le tenga allineate.

## Installazione per sviluppo

1. Individua la cartella profili di QGIS: in QGIS, `Impostazioni → Profili utente → Apri cartella
   profilo attivo`, poi `python/plugins/`.
2. Crea un collegamento simbolico (o copia) della cartella `archeodoc_checker/` di questo repo
   dentro quella cartella `python/plugins/`.
3. Riavvia QGIS, poi `Estensioni → Gestisci ed installa estensioni → Installate`, spunta
   "ArcheoDoc Checker".
4. Compare la voce di menu **ArcheoDoc → Verifica ed esporta per ArcheoDoc** (e un'icona in toolbar).

## Uso

Il progetto deve essere già salvato su disco (i file vengono scritti accanto ad esso). Click sulla
voce di menu: il plugin scansiona i layer, valida, e apre una finestra di esportazione dove puoi:

- scegliere quali layer/raster includere (selezionati tutti di default);
- vedere lo stato di ciascuno rispetto all'ultimo export — **Nuovo**, **Modificato**, **Invariato**;
- avviare l'esportazione con "Esporta": i raster GeoTIFF selezionati vengono convertiti in PNG
  georeferenziato **in background** (barra di progresso nella stessa finestra), riusando le
  conversioni già fatte se il raster sorgente non è cambiato dall'ultimo export;
- a fine esportazione, un riepilogo conferma che `manifest.json`, `us_links.json` e `report.json`
  sono stati scritti correttamente (con dimensione file), quanti layer sono stati esportati e
  l'esito di ogni conversione raster.

## Stato attuale / limiti noti

- Nessun packaging (`.zip` per l'installazione da file, pubblicazione su plugin repository QGIS)
  — solo installazione da sorgente per sviluppo.
- Nessun test automatico.
- Non crea ancora layer con lo schema atteso da zero (solo checker su progetto esistente).
- `isGeosValid()` per la validità geometrica richiede che il provider supporti il calcolo GEOS;
  per Shapefile/GeoPackage è affidabile, per altri provider può essere più lento o assente.
