#!/bin/bash
# Script start server Freezeraize
# Lokasi: /root/9router/start.sh

cd /root/9router

echo "=== Cek apakah server sudah jalan ==="
if curl -sS --max-time 3 "http://127.0.0.1:20127/api/health" 2>/dev/null | grep -q "ok"; then
  echo "Server sudah jalan di port 20127"
  echo "Version: $(curl -sS --max-time 3 "http://127.0.0.1:20127/api/version" 2>/dev/null)"
  exit 0
fi

echo "=== Kill process lama yang mungkin nempel ==="
pkill -f "next dev --port 20127" 2>/dev/null
pkill -f "next-server.*20127" 2>/dev/null
sleep 2

echo "=== Start server baru ==="
nohup npm run dev > /root/9router/server.log 2>&1 &
SERVER_PID=$!
echo "PID: $SERVER_PID"
echo "Log: /root/9router/server.log"

echo "=== Tunggu startup ==="
for i in $(seq 1 60); do
  sleep 1
  if curl -sS --max-time 3 "http://127.0.0.1:20127/api/health" 2>/dev/null | grep -q "ok"; then
    echo "Server siap dalam ${i} detik"
    echo "Version: $(curl -sS --max-time 3 "http://127.0.0.1:20127/api/version" 2>/dev/null)"
    exit 0
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "waiting... ${i}s"
  fi
done

echo "ERROR: Server gagal start dalam 60 detik"
echo "Cek log: cat /root/9router/server.log"
exit 1
