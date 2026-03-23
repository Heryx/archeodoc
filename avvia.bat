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

REM Evita processo vecchio su porta 5000 (server stale)
set "PORT_PID="
for /f %%P in ('powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess }"') do set "PORT_PID=%%P"

if defined PORT_PID (
    set "PORT_CMD="
    for /f "usebackq delims=" %%C in (`powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter 'ProcessId=%PORT_PID%'; if ($p) { $p.CommandLine }"`) do set "PORT_CMD=%%C"

    echo.
    echo  Porta 5000 gia in uso (PID %PORT_PID%).
    echo  Comando: %PORT_CMD%
    echo %PORT_CMD% | findstr /I /C:"dist\index.cjs" >nul
    if not errorlevel 1 (
        echo  Trovata istanza precedente di ArcheoDoc: la chiudo per usare la build aggiornata...
        taskkill /PID %PORT_PID% /F >nul 2>&1
        timeout /t 1 >nul
    ) else (
        echo  ERRORE: la porta 5000 e' occupata da un altro processo.
        echo  Chiudi quel processo e riprova.
        pause
        exit /b 1
    )
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

REM Apri automaticamente il browser
start http://localhost:5000

REM Avvia il server (cmd resta aperto)
set NODE_ENV=production
node dist\index.cjs

echo.
echo  Server fermato.
pause
