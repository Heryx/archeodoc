@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

title ArcheoDoc - Documentazione Scavo
echo.
echo  ================================================
echo   ArcheoDoc - Documentazione Scavo Archeologico
echo  ================================================
echo.

REM Controlla se Node.js e' installato
node --version >nul 2>&1
if errorlevel 1 (
    echo  ERRORE: Node.js non trovato.
    echo  Scaricalo da https://nodejs.org e installalo prima di continuare.
    echo.
    pause
    exit /b 1
)

echo  Node.js trovato:
node --version
echo.

REM Installa/aggiorna le dipendenze
echo  Verifica dipendenze...
call npm install
if errorlevel 1 (
    echo  ERRORE durante l'installazione delle dipendenze.
    pause
    exit /b 1
)

REM Crea la cartella uploads se non esiste
if not exist "uploads\" mkdir uploads

REM Chiudi eventuale processo precedente sulla porta 5000
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { Write-Host ' Chiudo processo precedente (PID' $p.OwningProcess ')...'; Stop-Process -Id $p.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 >nul

echo.
echo  Compilazione applicazione...
call npm run build
if errorlevel 1 (
    echo.
    echo  ERRORE durante la build. Dettagli sopra.
    pause
    exit /b 1
)

echo.
echo  ================================================
echo   Server in avvio su http://localhost:5000
echo   Il browser si aprira' automaticamente.
echo   Per chiudere il server: chiudi questa finestra
echo  ================================================
echo.

REM Apri il browser dopo 2 secondi (in background)
start "" cmd /c "timeout /t 2 >nul && start http://localhost:5000"

REM Avvia il server (questa finestra resta aperta finche' non la chiudi)
set NODE_ENV=production
node dist\index.cjs

echo.
echo  Server fermato.
pause
