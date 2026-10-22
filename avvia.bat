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

REM Finestra browser separata con caricatore: mostra lo stato e passa all'app quando il server e' pronto
set "LOADER_DIR=%TEMP%\archeodoc_loading"
if not exist "!LOADER_DIR!\" mkdir "!LOADER_DIR!"
copy /y "script\loading.html" "!LOADER_DIR!\loading.html" >nul
call :status "Avvio in corso..."
set "LOADER_URL=file:///!LOADER_DIR:\=/!/loading.html"
set "LOADER_OPENED=0"
for %%B in (msedge chrome) do if "!LOADER_OPENED!"=="0" (
    reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%%B.exe" >nul 2>&1 && (start "" %%B --app="!LOADER_URL!" & set "LOADER_OPENED=1")
)
if "!LOADER_OPENED!"=="0" start "" "!LOADER_DIR!\loading.html"

REM Controlla se Node.js e' installato
node --version >nul 2>&1
if errorlevel 1 (
    call :status_err "Node.js non trovato. Installalo da nodejs.org e riavvia."
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
call :status "Verifica delle dipendenze..."
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
    call :status_err "Errore durante l'installazione delle dipendenze. Vedi la finestra del terminale."
    echo  ERRORE durante l'installazione delle dipendenze.
    pause
    exit /b 1
)

REM Crea la cartella uploads se non esiste
if not exist "uploads\" mkdir uploads

call :status "Preparazione..."
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
    call :status "Aggiornamento in corso: compilazione dell'applicazione (puo' richiedere un minuto)..."
    call npm run build
    if errorlevel 1 (
        echo.
        call :status_err "Errore durante la build. Vedi la finestra del terminale."
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

REM Il caricatore sonda la porta 5000 e apre l'app appena il server risponde
call :status "Avvio del server..." ready

REM Avvia il server (questa finestra resta aperta finche' non la chiudi)
set NODE_ENV=production
node dist\index.cjs

echo.
echo  Server fermato.
pause
exit /b 0

:status
set "ST_READY=false"
if "%~2"=="ready" set "ST_READY=true"
>"%LOADER_DIR%\status.js" echo window.ARCHEO_STATUS={text:"%~1",ready:%ST_READY%};
exit /b 0

:status_err
>"%LOADER_DIR%\status.js" echo window.ARCHEO_STATUS={text:"%~1",error:true};
exit /b 0
