@echo off
setlocal

REM Crea un acceso directo (NAJU.lnk) en esta misma carpeta con icono.

set "ROOT=%~dp0"
set "TARGET=%ROOT%INICIAR_NAJU_WINDOWS.bat"
set "ICON=%ROOT%NAJU.ico"
set "SHORTCUT=%ROOT%NAJU.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$WshShell = New-Object -ComObject WScript.Shell;" ^
  "$Shortcut = $WshShell.CreateShortcut('%SHORTCUT%');" ^
  "$Shortcut.TargetPath = '%TARGET%';" ^
  "$Shortcut.WorkingDirectory = '%ROOT%';" ^
  "$Shortcut.IconLocation = '%ICON%,0';" ^
  "$Shortcut.Save();"

if exist "%SHORTCUT%" (
  echo [NAJU] Acceso directo creado: %SHORTCUT%
  echo [NAJU] Ahora solo dale doble click a NAJU.lnk
) else (
  echo [NAJU] No se pudo crear el acceso directo.
)

pause
endlocal
