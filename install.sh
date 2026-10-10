#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "================================"
echo "       VARZE BOT INSTALLER"
echo "================================"

pkg update -y
pkg install nodejs-lts ffmpeg python make clang -y

if [ ! -f package.json ]; then
    npm init -y
fi

npm pkg set type=module

npm install @whiskeysockets/baileys@7.0.0-rc14 pino sharp

if [ ! -f config.json ]; then
    echo "ERROR: config.json tidak ditemukan!"
    exit 1
fi

if [ ! -f index.js ]; then
    echo "ERROR: index.js tidak ditemukan!"
    exit 1
fi

cat > start.sh <<'START'
#!/data/data/com.termux/files/usr/bin/bash
cd "$HOME/rootbot"
node index.js
START

chmod +x start.sh

echo
echo "Instalasi selesai!"
echo "Jalankan bot dengan: ./start.sh"
EOF

chmod +x install.sh
./install.sh
