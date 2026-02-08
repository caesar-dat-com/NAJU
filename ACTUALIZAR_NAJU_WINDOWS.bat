@echo off
setlocal

REM Actualiza NAJU desde GitHub (origin/main)
cd /d "%~dp0"

echo [NAJU] Git pull...
git pull --rebase
if errorlevel 1 (
  echo [NAJU] No se pudo actualizar (revisa tu conexion o credenciales de Git).
  pause
  exit /b 1
)

echo [NAJU] npm install...
cd /d "%~dp0naju"
call npm install

echo [NAJU] Listo. Ahora ejecuta INICIAR_NAJU_WINDOWS.bat
pause
endlocal
