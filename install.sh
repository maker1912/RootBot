
#!/data/data/com.termux/files/usr/bin/bash

set -e

cd "$HOME/rootbot"

echo "================================"
echo "       VARZE BOT INSTALLER"
echo "================================"

echo "[1/6] Memasang kebutuhan Termux..."
pkg update -y
pkg install -y nodejs-lts ffmpeg git

echo "[2/6] Memeriksa file bot..."
if [ ! -f index.js ]; then
    echo "ERROR: index.js tidak ditemukan!"
    exit 1
fi

if [ ! -f config.json ]; then
    echo "ERROR: config.json tidak ditemukan!"
    exit 1
fi

echo "[3/6] Mengatur Node.js ES Module..."
npm pkg set type=module

echo "[4/6] Memasang dependensi..."
npm install @whiskeysockets/baileys@7.0.0-rc14 pino sharp

echo "[5/6] Memasang PM2..."
npm install -g pm2

echo "[6/6] Menjalankan VARZE BOT..."

# Hentikan proses PM2 lama dengan nama yang sama.
pm2 delete varze-bot >/dev/null 2>&1 || true

# Jalankan bot menggunakan PM2.
pm2 start index.js \
  --name varze-bot \
  --time \
  --restart-delay 3000

pm2 save

echo
echo "================================"
echo " INSTALASI SELESAI!"
echo "================================"
echo "Lihat log:     pm2 logs varze-bot"
echo "Status bot:    pm2 status"
echo "Restart bot:   pm2 restart varze-bot"
echo "Stop bot:      pm2 stop varze-bot"
echo "Hapus PM2:     pm2 delete varze-bot"
echo
