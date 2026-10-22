@echo off
REM Ricompila ArcheoDoc.exe dal sorgente C# del launcher veloce.
set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"

"%CSC%" /nologo /out:"%~dp0..\ArcheoDoc.exe" /platform:x64 /win32icon:"%~dp0..\archeodoc.ico" "%~dp0launcher\ArcheoDocLauncher.cs"
if errorlevel 1 (
    echo ERRORE durante la compilazione del launcher.
    pause
    exit /b 1
)
echo ArcheoDoc.exe ricompilato con successo.
pause
