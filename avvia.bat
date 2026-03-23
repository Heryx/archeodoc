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

REM Installa/aggiorna le dipendenze (veloce se gia' aggiornate)
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
set "PORT_PID="
for /f %%P in ('powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess }"') do set "PORT_PID=%%P"

if defined PORT_PID (
    echo.
    echo  Chiudo processo precedente sulla porta 5000 (PID %PORT_PID%)...
    taskkill /PID %PORT_PID% /F >nul 2>&1
    timeout /t 2 >nul
)

echo.
echo  Compilazione applicazione (build produzione)...
call npm run build
if errorlevel 1 (
    echo  ERRORE durante la build dell'applicazione.
    pause
    exit /b 1
)

echo.
echo  ================================================
echo   Server avviato su http://localhost:5000
echo   Apri il browser e vai su quella URL.
echo   Per chiudere: tieni premuto Ctrl+C
echo  ================================================
echo.

REM Avvia il server in background e aspetta che sia pronto, poi apri il browser
set NODE_ENV=production
start /b node dist\index.cjs
timeout /t 3 >nul
start http://localhost:5000

REM Tieni la finestra aperta (il server gira in background)
echo  Premi un tasto per fermare il server...
pause >nul
taskkill /IM node.exe /F >nul 2>&1

echo.
echo  Server fermato.
pause
