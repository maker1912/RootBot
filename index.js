
import makeWASocket, {
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

import pino from 'pino';
import readline from 'node:readline/promises';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
    `https://api.mcstatus.io/v2/status/bedrock/${encodeURIComponent(address)}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`MCStatus.io HTTP ${response.status}`);
  }

  return await response.json();
}

async function getPingMessage(address, label) {
  const data = await checkBedrockServer(address);

  if (!data.online) {
    return (
      `🏓 STATUS ${label}\n\n` +
      `🌐 Alamat: ${address}\n` +
      `🔴 Status: Offline atau tidak terjangkau`
    );
  }

  return (
    `🏓 STATUS ${label}\n\n` +
    `🌐 Alamat: ${data.host || address}\n` +
    `🔌 Port: ${data.port ?? '?'}\n` +
    `🟢 Status: Online\n` +
    `👥 Pemain: ${data.players?.online ?? '?'} / ${data.players?.max ?? '?'}\n` +
    `🎮 Versi: ${data.version?.name || 'Tidak diketahui'}`
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
      [
        'ls-remote',
        `https://github.com/${UPDATE_REPO}.git`,
        `refs/heads/${UPDATE_BRANCH}`
      ],
      { timeout: 15000 }
    );

    const latestCommit = remoteCommit.trim().split(/\s+/)[0];
    if (!latestCommit) return;

    const { stdout: localCommit } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD']
    );

    const { stdout: currentFile } = await execFileAsync(
      'git',
      ['show', 'HEAD:index.js']
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
      await rl.question('Update index.js sekarang? (y/n): ')
    ).trim().toLowerCase();

    rl.close();

    if (answer !== 'y') {
      console.log('Update ditunda.');
      updatePromptActive = false;
      return;
    }

    await execFileAsync('git', ['fetch', 'origin', UPDATE_BRANCH]);

    const { stdout: remoteFile } = await execFileAsync(
      'git',
      ['show', `origin/${UPDATE_BRANCH}:index.js`]
    );

    const fsPromises = await import('node:fs/promises');

    await fsPromises.copyFile('index.js', 'index.js.backup');
    await fsPromises.writeFile('index.js', remoteFile, 'utf8');

    console.log('index.js berhasil diperbarui.');
    console.log('Restart bot untuk menerapkan update.');

    const { spawn } = await import('node:child_process');
    const child = spawn(
      process.execPath,
      ['index.js'],
      { stdio: 'inherit' }
    );

    child.on('error', error => {
      console.error('Gagal restart:', error.message);
    });

    process.exit(0);
  } catch (error) {
    console.error('Updater error:', error.message);
    updatePromptActive = false;
  }
}

setTimeout(checkGitHubUpdate, 5000);
setInterval(checkGitHubUpdate, UPDATE_INTERVAL);

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
          const address = args[1]
            ? args[1]
            : `${SERVER_IP}:${SERVER_PORT}`;

          const label = args[1]
            ? 'SERVER TARGET'
            : SERVER_NAME;

          try {
            balasan = await getPingMessage(address, label);
          } catch (error) {
            console.error('MCStatus.io:', error.message);

            balasan =
              `❌ Gagal mengecek server.\n` +
              `🌐 Alamat: ${address}\n` +
              `API tidak dapat memberikan status. Coba lagi nanti.`;
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
