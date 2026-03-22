# ArcheoDoc — Documentazione Scavo Archeologico

Applicazione per la gestione e il quality control della documentazione di scavo giornaliera, con generazione automatica di schede US e diari di scavo tramite AI (Claude).

---

## Requisiti

- **Node.js 18+** — [scarica da nodejs.org](https://nodejs.org)
- Connessione Internet (solo per le API AI — Claude)
- **Chiave API Anthropic** (necessaria per le funzioni AI)

---

## Avvio rapido

### Windows
Doppio clic su **`avvia.bat`**

### Mac / Linux
```bash
chmod +x avvia.sh
./avvia.sh
```

Poi apri il browser su: **http://localhost:5000**

---

## Configurazione chiave API (OBBLIGATORIA per le funzioni AI)

Le funzioni AI (analisi testo, generazione schede, export .docx arricchito) richiedono una chiave API Anthropic.

### Come configurare:

1. Ottieni una chiave su [console.anthropic.com](https://console.anthropic.com)
2. Crea un file `.env` nella cartella di ArcheoDoc con questo contenuto:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxx
   ```
3. Riavvia l'applicazione

> Senza la chiave API, le funzioni AI non saranno disponibili ma tutto il resto funziona normalmente (upload, QC automatico, schede manuali).

---

## Struttura cartelle

```
archeodoc/
├── dist/           ← Applicazione compilata (non modificare)
├── uploads/        ← File caricati (foto, planimetrie, PDF...)
├── archeodoc.db    ← Database SQLite (si crea automaticamente)
├── avvia.bat       ← Script avvio Windows
├── avvia.sh        ← Script avvio Mac/Linux
└── package.json
```

---

## Funzionalità principali

### Cantieri
- Crea cantieri con codice, nome, località, committente, responsabile
- Nessun riferimento fisso a ditte — completamente libero

### Giornate di scavo
- Registra ogni giornata con data, operatori, meteo, settore
- Associa US e documenti alla giornata

### Unità Stratigrafiche (US)
- Schede complete: tipo, descrizione, quota, settore
- Relazioni stratigrafiche (coperto da / copre / si lega a / uguale a)
- Supporto tipi: strato, struttura, interfaccia, tomba, riempimento, buca
- Campi geometria WKT per integrazione QGIS

### Quality Control automatico
Verifica per ogni US:
- **Completezza** — campi obbligatori mancanti per tipo
- **Nomenclatura** — formato codice US (US 001, T.001, SB 001...)
- **Associazione** — presenza di foto e disegni
- **Coerenza stratigrafica** — riferimenti a US inesistenti

### AI — Analisi e formattazione testo
L'AI (Claude) analizza il testo inserito e:
- Individua campi mancanti rispetto agli standard (diversi per tipo US)
- Riformatta e corregge il testo con terminologia tecnica appropriata
- Produce schede US e diari giornalieri professionali

### Export .docx
- Scheda US formattata in Word con intestazione, campi mancanti evidenziati, scheda elaborata
- Diario giornaliero in Word con tutte le sezioni standard

### Caricamento documenti
- Upload multiplo (drag & drop) di foto, planimetrie, disegni, PDF, CSV
- Associazione a giornata e/o US

---

## Database SQLite / compatibilità QGIS

Il database `archeodoc.db` include:
- Tabelle `geometry_columns` e `spatial_ref_sys` (standard OGC)
- EPSG:4326 e EPSG:32632 (UTM 32N) precaricati
- Colonne WKT (`geom_centroide`, `geom_perimetro`) sulle US
- Apribile direttamente in QGIS come layer vettoriale

Per visualizzare in QGIS: **Layer → Aggiungi layer → SpatiaLite** e seleziona `archeodoc.db`.

---

## Aggiornamenti

Per aggiornare l'applicazione, sostituisci i file nella cartella `dist/` mantenendo il file `archeodoc.db` e la cartella `uploads/`.
