' ArcheoDoc - Avvio silenzioso (nessuna finestra CMD visibile)
' Questo script lancia ArcheoDoc.exe (avvio veloce) in background senza mostrare finestre nere.
' Per forzare una reinstallazione completa delle dipendenze o una ricompilazione, usa invece avvia.bat.
' Aggiorna anche l'icona del collegamento desktop ad ogni avvio.

Option Explicit

Dim oShell, sDir, sBat, sCmd, sIco, sDesktop, sLnk

Set oShell = CreateObject("WScript.Shell")

' Ricava la cartella dove si trova questo .vbs
sDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' Aggiorna l'icona del collegamento desktop se esiste archeodoc.ico
sIco = sDir & "archeodoc.ico"
sDesktop = oShell.SpecialFolders("Desktop")
sLnk = sDesktop & "\ArcheoDoc.lnk"

Dim oFso
Set oFso = CreateObject("Scripting.FileSystemObject")

If oFso.FileExists(sIco) And oFso.FileExists(sLnk) Then
    Dim oLink
    Set oLink = oShell.CreateShortcut(sLnk)
    oLink.IconLocation = sIco
    oLink.Save()
    Set oLink = Nothing
End If

Set oFso = Nothing

' Percorso dell'eseguibile di avvio veloce
sBat = sDir & "ArcheoDoc.exe"

' Comando diretto (nessun cmd /c intermedio)
sCmd = """" & sBat & """"

' Run(command, windowStyle=0 hidden, bWaitOnReturn=False)
oShell.Run sCmd, 0, False

Set oShell = Nothing
