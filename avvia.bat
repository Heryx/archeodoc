@echo off
setlocal EnableExtensions EnableDelayedExpansion
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
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
    echo  ERRORE durante l'installazione delle dipendenze.
    pause
    exit /b 1
)

REM Crea la cartella uploads se non esiste
if not exist "uploads\" mkdir uploads

REM Chiudi eventuale processo precedente sulla porta 5000 e attendi che si liberi
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = 5000;" ^
  "$pids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -and $_ -ne 0 };" ^
  "foreach ($procId in $pids) { Write-Host ('  Chiudo processo precedente (PID {0})...' -f $procId); taskkill /PID $procId /F 2>$null | Out-Null }" ^
  "for ($i = 0; $i -lt 20; $i++) { $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if (-not $busy) { break }; Start-Sleep -Milliseconds 500 }"

echo.
set "BUILD_REQUIRED=1"
set "BUILD_DECISION=build"

if exist "dist\index.cjs" if exist "dist\public\index.html" if exist "script\should_build.ps1" (
    for /f "usebackq delims=" %%D in (`powershell -NoProfile -ExecutionPolicy Bypass -File "script\should_build.ps1"`) do set "BUILD_DECISION=%%D"
    for /f "tokens=* delims= " %%D in ("!BUILD_DECISION!") do set "BUILD_DECISION=%%D"
    if /I "!BUILD_DECISION!"=="skip" set "BUILD_REQUIRED=0"
)

if "!BUILD_REQUIRED!"=="1" (
    echo  Sorgenti aggiornati, eseguo build...
    call npm run build
    if errorlevel 1 (
        echo.
        echo  ERRORE durante la build. Dettagli sopra.
        pause
        exit /b 1
    )
) else (
    echo  Build aggiornata, salto compilazione.
)

echo.
echo  ================================================
echo   Server in avvio su http://localhost:5000
echo   Il browser si aprira' automaticamente.
echo   Per chiudere il server: chiudi questa finestra
echo  ================================================
echo.

set "NO_RUN=!ARCHEODOC_NO_RUN!"
set "NO_RUN=!NO_RUN: =!"
if /I "!NO_RUN!"=="1" (
    echo  Modalita test: avvio server saltato ^(ARCHEODOC_NO_RUN=1^).
    exit /b 0
)

REM Apri il browser dopo 2 secondi (in background)
start "" cmd /c "ping -n 3 127.0.0.1 >nul && start http://localhost:5000"

REM Avvia il server (questa finestra resta aperta finche' non la chiudi)
set NODE_ENV=production
node dist\index.cjs

echo.
echo  Server fermato.
pause
