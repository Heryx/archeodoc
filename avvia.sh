#!/bin/bash
echo ""
echo " ================================================"
echo "  ArcheoDoc - Documentazione Scavo Archeologico"
echo " ================================================"
echo ""

# Controlla Node.js
if ! command -v node &> /dev/null; then
    echo " ERRORE: Node.js non trovato."
    echo " Scaricalo da https://nodejs.org"
    exit 1
fi

echo " Node.js: $(node --version)"

# Prima installazione
if [ ! -d "node_modules" ]; then
    echo ""
    echo " Prima installazione - scarico le dipendenze..."
    npm install
fi

# Crea uploads
mkdir -p uploads

echo ""
echo " ================================================"
echo "  Server avviato su http://localhost:5000"
echo "  Apri il browser su quella URL."
echo "  Per chiudere: Ctrl+C"
echo " ================================================"
echo ""

# Apri browser (funziona su Mac e molti Linux)
if command -v open &> /dev/null; then
    open http://localhost:5000
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:5000
fi

NODE_ENV=production node dist/index.cjs
