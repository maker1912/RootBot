
#!/data/data/com.termux/files/usr/bin/bash

set -Ee

cd "$HOME/rootbot"

echo "=================================="
echo "     VARZE BOT AUTO INSTALLER"
echo "=================================="

# 1. System dependencies
echo "[1/6] Memasang paket Termux..."
pkg update -y
pkg install -y nodejs-lts git ffmpeg python make clang

# 2. Validate bot files
echo "[2/6] Memeriksa file..."
if [ ! -f index.js ]; then
  echo "ERROR: index.js tidak ditemukan!"
  exit 1
fi

if [ ! -f config.json ]; then
  echo "ERROR: config.json tidak ditemukan!"
  exit 1
fi

# 3. Configure ES modules
echo "[3/6] Mengatur package.json..."
if [ ! -f package.json ]; then
  npm init -y
fi

npm pkg set type=module

# 4. Install declared dependencies
echo "[4/6] Memasang dependency..."
if [ -f package-lock.json ]; then
  npm install
else
  npm install @whiskeysockets/baileys@7.0.0-rc14 pino sharp
fi

# Pastikan dependency utama tersedia.
npm install @whiskeysockets/baileys@7.0.0-rc14 pino sharp

# 5. Scan imports for missing packages
echo "[5/6] Memeriksa import package..."

node --input-type=module <<'NODE'
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const source = fs.readFileSync('index.js', 'utf8');
const packages = new Set();

const regex = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
let match;

while ((match = regex.exec(source)) !== null) {
  const name = match[1];

  if (
    name.startsWith('.') ||
    name.startsWith('/') ||
    name.startsWith('node:')
  ) continue;

  const parts = name.split('/');
  const pkg = name.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : parts[0];

  packages.add(pkg);
}

const builtin = new Set([
  ...process.getBuiltinModule ? [] : [],
  'fs', 'path', 'os', 'util', 'url', 'crypto',
  'http', 'https', 'stream', 'events', 'readline',
  'child_process', 'timers', 'buffer', 'assert',
  'process', 'module', 'net', 'dns', 'tls',
  'zlib', 'worker_threads', 'perf_hooks'
]);

for (const pkg of packages) {
  if (builtin.has(pkg)) continue;

  try {
    import.meta.resolve(pkg);
    console.log(`OK: ${pkg}`);
  } catch {
    console.log(`Dependency belum tersedia: ${pkg}`);
    try {
      execFileSync('npm', ['install', pkg], { stdio: 'inherit' });
    } catch {
      console.error(`Gagal memasang ${pkg}`);
      process.exitCode = 1;
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
NODE

# 6. Install PM2 and start bot
echo "[6/6] Memasang PM2..."
npm install -g pm2

echo "Menjalankan bot..."
pm2 delete varze-bot >/dev/null 2>&1 || true
pm2 start index.js --name varze-bot --time --restart-delay 3000
pm2 save

echo
echo "=================================="
echo "       INSTALL SELESAI"
echo "=================================="
echo "Status : pm2 status"
echo "Log    : pm2 logs varze-bot"
echo "Restart: pm2 restart varze-bot"
echo "Stop   : pm2 stop varze-bot"
NODE
