
import makeWASocket, {
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

import pino from 'pino';
import readline from 'node:readline/promises';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OWNER_NUMBER = '628561411054';

const RULES = `
1. Dilarang menggunakan cheat.
2. Dilarang melakukan griefing.
3. Hormati semua pemain.
4. Dilarang spam dan toxic.
5. Patuhi arahan admin.
`;

const ABOUT = `
${SERVER_NAME}
Server Minecraft Bedrock.
Tempat bermain dan bersenang-senang bersama!
`;

const SOCIALS = `
WhatsApp: https://chat.whatsapp.com/CONTOH
YouTube: https://youtube.com/@CONTOH
Discord: https://discord.gg/CONTOH
`;

import fs from 'node:fs';

const config = JSON.parse(
  fs.readFileSync('./config.json', 'utf8')
);

const BOT_NAME = config.BOT_NAME;
const SERVER_NAME = config.SERVER_NAME;
const SERVER_IP = config.SERVER_IP;
const SERVER_PORT = config.SERVER_PORT;
const OWNER_NUMBER = config.OWNER_NUMBER;
const RULES = config.RULES.join('\n');
const ABOUT = config.ABOUT;

const SOCIALS = Object.entries(config.SOCIALS)
  .map(([name, url]) => `${name}: ${url}`)
  .join('\n');


async function checkBedrockServer(address) {
  const url =
    `https://api.mcsrvstat.us/bedrock/3/${encodeURIComponent(address)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'VARZE-BOT/1.0'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`API HTTP ${response.status}`);
  }

  return await response.json();
}

async function getPingMessage(address, label) {
  const data = await checkBedrockServer(address);

  if (!data.online) {
    return (
      `🏓 CEK SERVER ${label}\n\n` +
      `🌐 Alamat: ${address}\n` +
      `🔴 Status: Offline atau tidak terjangkau`
    );
  }

  return (
    `🏓 STATUS SERVER ${label}\n\n` +
    `🌐 Alamat: ${data.hostname || data.ip || address}:${data.port || ''}\n` +
    `🟢 Status: Online\n` +
    `👥 Pemain: ${data.players?.online ?? '?'} / ${data.players?.max ?? '?'}\n` +
    `🎮 Versi: ${data.version || 'Tidak diketahui'}`
  );
}


const UPDATE_REPO = 'maker1912/rootbot';
const UPDATE_BRANCH = 'main';
const UPDATE_INTERVAL = 60_000;

let updatePromptActive = false;

async function checkGitHubUpdate() {
  if (updatePromptActive) return;

  try {
    const { stdout: remoteCommit } = await execFileAsync(
      'git',
      ['ls-remote', `https://github.com/${UPDATE_REPO}.git`,
       `refs/heads/${UPDATE_BRANCH}`],
      { timeout: 15000 }
    );

    const latestCommit = remoteCommit.trim().split(/\s+/)[0];
    if (!latestCommit) return;

    const { stdout: localCommit } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD']
    );

    if (latestCommit === localCommit.trim()) return;

    updatePromptActive = true;

    console.log('\n🔔 UPDATE TERSEDIA!');
    console.log('Commit lokal :', localCommit.trim().slice(0, 7));
    console.log('Commit GitHub:', latestCommit.slice(0, 7));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = (
      await rl.question('Update sekarang? (y/n): ')
    ).trim().toLowerCase();

    rl.close();

    if (answer !== 'y') {
      console.log('Update ditunda.');
      updatePromptActive = false;
      return;
    }

    console.log('Mengambil update dari GitHub...');

    // Pastikan tidak ada perubahan lokal yang akan tertimpa.
    const { stdout: status } = await execFileAsync(
      'git',
      ['status', '--porcelain']
    );

    if (status.trim()) {
      console.log(
        'Update dibatalkan: ada perubahan lokal atau file belum dilacak.'
      );
      console.log('Simpan atau commit perubahan lokal terlebih dahulu.');
      updatePromptActive = false;
      return;
    }

    // Hanya menerima update fast-forward.
    await execFileAsync('git', ['fetch', 'origin', UPDATE_BRANCH]);

    const { stdout: fetchedCommit } = await execFileAsync(
      'git',
      ['rev-parse', `origin/${UPDATE_BRANCH}`]
    );

    if (fetchedCommit.trim() !== latestCommit) {
      console.log('GitHub berubah saat update. Coba lagi nanti.');
      updatePromptActive = false;
      return;
    }

    // Pastikan perubahan hanya maju, bukan mengganti riwayat lokal.
    const { stdout: ancestor } = await execFileAsync(
      'git',
      ['merge-base', 'HEAD', `origin/${UPDATE_BRANCH}`]
    );

    if (ancestor.trim() !== localCommit.trim()) {
      console.log(
        'Update dibatalkan: riwayat Git berbeda atau ada commit lokal.'
      );
      updatePromptActive = false;
      return;
    }

    // Simpan backup sebelum mengganti kode.
    await execFileAsync('cp', ['index.js', 'index.js.backup']);

    await execFileAsync(
      'git',
      ['merge', '--ff-only', `origin/${UPDATE_BRANCH}`]
    );

    console.log('Update berhasil. Memulai ulang bot...');

    // Ganti proses Node.js saat ini dengan versi terbaru.
    const { spawn } = await import('node:child_process');
    const child = spawn(
      process.execPath,
      ['index.js'],
      { stdio: 'inherit' }
    );

    child.on('error', (error) => {
      console.error('Gagal menjalankan ulang bot:', error.message);
    });

    process.exit(0);
  } catch (error) {
    console.error('Updater error:', error.message);
    updatePromptActive = false;
  }
}

setInterval(checkGitHubUpdate, UPDATE_INTERVAL);
setTimeout(checkGitHubUpdate, 5000);


async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState('./session');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  if (!state.creds.registered) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const nomor = await rl.question(
      'Nomor WhatsApp (contoh 62812xxxx): '
    );

    rl.close();

    const kode = await sock.requestPairingCode(
      nomor.replace(/\D/g, '')
    );

    console.log('Kode pairing:', kode);
    console.log('Masukkan kode di WhatsApp kamu.');
  }

  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') {
      console.log('Bot berhasil terhubung!');
    }

    if (connection === 'close') {
      console.log('Koneksi terputus. Jalankan ulang bot.');
    }
  });


  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (!jid || jid === 'status@broadcast') continue;

      const isi =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      const cmd = isi.trim().split(/\s+/)[0].toLowerCase();
      const sender = msg.key.participant || jid;
      const nomor = sender.split('@')[0];
      const isOwner = nomor === OWNER_NUMBER;

      let balasan = '';

      switch (cmd) {
        case '/menu':
          balasan =
            `╭━━〔 ${BOT_NAME} 〕\n` +
            `┃ Server: ${SERVER_NAME}\n` +
            '┣━━〔 MENU UTAMA 〕\n' +
            '┃ /menu - Daftar command\n' +
            '┃ /ping - Ping server Minecraft\n' +
            '┃ /aturan - Aturan server\n' +
            '┃ /about - Tentang server\n' +
            '┃ /sosial - Media sosial\n' +
            '╰━━━━━━━━━━━━';
          break;

        case '/aturan':
        case '/rule':
        case '/rules':
          balasan = `📜 ATURAN ${SERVER_NAME}\n${RULES}`;
          break;

        case '/about':
        case '/tentang':
          balasan = `ℹ️ TENTANG SERVER\n${ABOUT}`;
          break;

        case '/sosial':
        case '/sosials':
          balasan = `🌐 SOSIAL MEDIA\n${SOCIALS}`;
          break;

        case '/admin':
          if (!isOwner) {
            balasan = '⛔ Command ini khusus admin.';
            break;
          }

          balasan =
            '🔐 ADMIN MENU\n' +
            '/admin - Menu admin\n' +
            '/setrules - (fitur belum dibuat)\n' +
            '/setabout - (fitur belum dibuat)\n' +
            '/setsosial - (fitur belum dibuat)';
          break;


        case '/ping': {
          const args = isi.trim().split(/\s+/);
          const address = args[1] || `${SERVER_IP}:${SERVER_PORT}`;
          const label = args[1] ? 'SERVER TARGET' : SERVER_NAME;

          try {
            balasan = await getPingMessage(address, label);
          } catch (error) {
            console.error('Gagal mengecek server:', error.message);

            balasan =
              `❌ Gagal mengecek server.\n` +
              `🌐 Alamat: ${address}\n` +
              `Coba lagi nanti atau periksa alamat server.`;
          }

          break;
        }


        default:
          continue;
      }

      await sock.sendMessage(jid, { text: balasan });
    }
  });
}

startBot().catch(console.error);
