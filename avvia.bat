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

REM Se e' un clone Git, prova ad aggiornare automaticamente in fast-forward
where git >nul 2>&1
if not errorlevel 1 if exist ".git" (
    echo  Verifica aggiornamenti da GitHub...
    git fetch origin main --quiet 2>nul
    if errorlevel 1 (
        echo   Impossibile verificare aggiornamenti remoti ^(continuo con versione locale^).
    ) else (
        set "UPDATES=0"
        for /f %%U in ('git rev-list --count HEAD..origin/main 2^>nul') do set "UPDATES=%%U"
        if not "!UPDATES!"=="0" (
            echo   Trovati !UPDATES! aggiornamenti, applico git pull...
            git pull --ff-only origin main
            if errorlevel 1 (
                echo   ATTENZIONE: git pull non riuscito ^(continuo con versione locale^).
            )
        ) else (
            echo   Nessun aggiornamento disponibile.
        )
    )
    echo.
)

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
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { [string]$p.OwningProcess }"`) do (
    echo  Chiudo processo precedente ^(PID %%P^)...
    taskkill /PID %%P /F >nul 2>&1
)
ping -n 2 127.0.0.1 >nul

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
