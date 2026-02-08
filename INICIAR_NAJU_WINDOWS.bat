@echo off
setlocal

REM NAJU Launcher (Windows)
REM - Instala dependencias la primera vez
REM - Inicia el servidor local accesible en la LAN (QR)
REM - Abre NAJU en el navegador

cd /d "%~dp0naju"

echo [NAJU] Verificando / instalando dependencias...
call npm install
if errorlevel 1 (
  echo [NAJU] Error instalando dependencias. Verifica que Node.js este instalado.
  pause
  exit /b 1
)

echo [NAJU] Iniciando servidor local...
start "NAJU" cmd /k "npm run dev"

REM Dale un instante para levantar
ping 127.0.0.1 -n 2 >nul

echo [NAJU] Abriendo en el navegador...
start "" "http://localhost:1420"

echo.
echo [NAJU] Puedes cerrar esta ventana. El servidor queda corriendo en la otra.
endlocal
