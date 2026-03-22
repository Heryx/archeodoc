@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "TARGET_BAT=%SCRIPT_DIR%avvia.bat"
set "WORKDIR=%SCRIPT_DIR%"

echo.
echo  Creazione collegamento desktop "ArcheoDoc"...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$shortcutPath = Join-Path $desktop 'ArcheoDoc.lnk';" ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "$shortcut = $shell.CreateShortcut($shortcutPath);" ^
  "$shortcut.TargetPath = '%TARGET_BAT%';" ^
  "$shortcut.WorkingDirectory = '%WORKDIR%';" ^
  "$shortcut.Description = 'Avvia ArcheoDoc';" ^
  "$shortcut.IconLocation = '%SystemRoot%\System32\shell32.dll,220';" ^
  "$shortcut.Save();"

if errorlevel 1 (
  echo.
  echo  ERRORE: impossibile creare il collegamento sul desktop.
  pause
  exit /b 1
)

echo.
echo  Fatto. Trovi "ArcheoDoc" sul Desktop.
echo  Da ora puoi avviare con doppio click.
echo.
pause
