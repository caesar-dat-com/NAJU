#!/usr/bin/env bash
set -e

# NAJU Launcher (Linux)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/naju"

echo "[NAJU] Verificando / instalando dependencias..."
npm install

echo "[NAJU] Iniciando servidor local..."
npm run dev >/dev/null 2>&1 &
PID=$!

sleep 1

URL="http://localhost:1420"
echo "[NAJU] Abriendo $URL"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v gnome-open >/dev/null 2>&1; then
  gnome-open "$URL" >/dev/null 2>&1 &
fi

echo "[NAJU] Servidor PID: $PID (para detener: kill $PID)"
wait $PID
