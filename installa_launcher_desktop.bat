@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "TARGET_VBS=%SCRIPT_DIR%avvia_hidden.vbs"
set "WORKDIR=%SCRIPT_DIR%"
set "ICO_PATH=%SCRIPT_DIR%archeodoc.ico"

echo.
echo  Creazione icona e collegamento desktop "ArcheoDoc"...

REM Genera archeodoc.ico con PowerShell (32x32, testo "AD" su sfondo blu scuro)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Add-Type -AssemblyName System.Drawing;" ^
  "$size = 32;" ^
  "$bmp = New-Object System.Drawing.Bitmap($size, $size);" ^
  "$g = [System.Drawing.Graphics]::FromImage($bmp);" ^
  "$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias;" ^
  "$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit;" ^
  "$bg = [System.Drawing.Color]::FromArgb(255, 30, 58, 138);" ^
  "$g.Clear($bg);" ^
  "$font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold);" ^
  "$brush = [System.Drawing.Brushes]::White;" ^
  "$sf = New-Object System.Drawing.StringFormat;" ^
  "$sf.Alignment = [System.Drawing.StringAlignment]::Center;" ^
  "$sf.LineAlignment = [System.Drawing.StringAlignment]::Center;" ^
  "$rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size);" ^
  "$g.DrawString('AD', $font, $brush, $rect, $sf);" ^
  "$g.Dispose();" ^
  "$icoPath = '%ICO_PATH%';" ^
  "$ms = New-Object System.IO.MemoryStream;" ^
  "$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);" ^
  "$pngBytes = $ms.ToArray();" ^
  "$fs = [System.IO.File]::OpenWrite($icoPath);" ^
  "$bw = New-Object System.IO.BinaryWriter($fs);" ^
  "$bw.Write([byte]0); $bw.Write([byte]0);" ^
  "$bw.Write([uint16]1);" ^
  "$bw.Write([uint16]1);" ^
  "$bw.Write([byte]$size); $bw.Write([byte]$size);" ^
  "$bw.Write([byte]0); $bw.Write([byte]0);" ^
  "$bw.Write([uint16]1); $bw.Write([uint16]32);" ^
  "$offset = 6 + 16;" ^
  "$bw.Write([uint32]$pngBytes.Length);" ^
  "$bw.Write([uint32]$offset);" ^
  "$bw.Write($pngBytes);" ^
  "$bw.Close(); $fs.Close();" ^
  "Write-Host 'Icona creata.'"

REM Crea il collegamento sul desktop
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$shortcutPath = Join-Path $desktop 'ArcheoDoc.lnk';" ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "$shortcut = $shell.CreateShortcut($shortcutPath);" ^
  "$shortcut.TargetPath = 'wscript.exe';" ^
  "$shortcut.Arguments = '\"%SCRIPT_DIR%avvia_hidden.vbs\"';" ^
  "$shortcut.WorkingDirectory = '%WORKDIR%';" ^
  "$shortcut.Description = 'Avvia ArcheoDoc - Documentazione Scavo Archeologico';" ^
  "$shortcut.IconLocation = '%ICO_PATH%';" ^
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
