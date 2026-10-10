import makeWASocket, {
  useMultiFileAuthState,
  downloadMediaMessage,
  Browsers
} from '@whiskeysockets/baileys';


import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import pino from "pino";
import readline from "node:readline/promises";

const execFileAsync = promisify(execFile);

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


async function getMediaBuffer(sock, msg) {
  const jid = msg.key.remoteJid;
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const quotedMessage = context?.quotedMessage;

  let target = msg;

  if (quotedMessage) {
    target = {
      key: {
        remoteJid: jid,
        id: context.stanzaId,
        participant: context.participant,
        fromMe: false
      },
      message: quotedMessage
    };
  }

  const type = Object.keys(target.message || {})
    .find(k => [
      'imageMessage',
      'videoMessage',
      'audioMessage',
      'stickerMessage'
    ].includes(k));

  if (!type) {
    throw new Error('Balas gambar, video, audio, atau stiker.');
  }

  const buffer = await downloadMediaMessage(
    target,
    'buffer',
    {},
    { logger: pino({ level: 'silent' }) }
  );

  return { buffer, type };
}


async function convertMedia(sock, msg, mode) {
  const { buffer, type } = await getMediaBuffer(sock, msg);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varze-'));
  const input = path.join(dir, 'input');
  const output = path.join(dir, 'output');

  try {
    fs.writeFileSync(input, buffer);

    if (mode === 'sticker' && type === 'imageMessage') {
      await execFileAsync('ffmpeg', [
        '-y', '-i', input,
        '-vf',
        'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
        '-vcodec', 'libwebp', '-q:v', '75', '-an',
        output + '.webp'
      ], { timeout: 120000 });

      await sock.sendMessage(msg.key.remoteJid, {
        sticker: fs.readFileSync(output + '.webp')
      }, { quoted: msg });

    } else if (mode === 'animated' && type === 'videoMessage') {
      await execFileAsync('ffmpeg', [
        '-y', '-i', input,
        '-t', '6',
        '-vf',
        'fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
        '-an', '-vcodec', 'libwebp', '-loop', '0',
        '-q:v', '65', output + '.webp'
      ], { timeout: 120000 });

      await sock.sendMessage(msg.key.remoteJid, {
        sticker: fs.readFileSync(output + '.webp'),
        isAnimated: true
      }, { quoted: msg });

    } else if (mode === 'image' && type === 'stickerMessage') {
      await execFileAsync('ffmpeg', [
        '-y', '-i', input, '-frames:v', '1', output + '.png'
      ], { timeout: 120000 });

      await sock.sendMessage(msg.key.remoteJid, {
        image: fs.readFileSync(output + '.png'),
        caption: '✅ Stiker dikonversi menjadi gambar.'
      }, { quoted: msg });

    } else if (
      (mode === 'audio' && type === 'videoMessage') ||
      (mode === 'mp3' && ['audioMessage', 'videoMessage'].includes(type))
    ) {
      await execFileAsync('ffmpeg', [
        '-y', '-i', input, '-vn',
        '-codec:a', 'libmp3lame', '-b:a', '128k',
        output + '.mp3'
      ], { timeout: 120000 });

      await sock.sendMessage(msg.key.remoteJid, {
        audio: fs.readFileSync(output + '.mp3'),
        mimetype: 'audio/mpeg',
        fileName: 'audio.mp3'
      }, { quoted: msg });

    } else {
      throw new Error('Jenis media tidak cocok. Balas media yang sesuai.');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}


async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState('./session');


const sock = makeWASocket({
  auth: state,
  logger: pino({ level: 'silent' }),
  browser: Browsers.ubuntu('Chrome'),
syncFullHistory: false,
  connectTimeoutMs: 60000,
  defaultQueryTimeoutMs: 60000,
  keepAliveIntervalMs: 15000
});

sock.ev.on('group-participants.update', async (update) => {
    try {
        const config = JSON.parse(
            fs.readFileSync('./config.json', 'utf8')
        );

        const metadata = await sock.groupMetadata(update.id);

        for (const item of update.participants) {
            const participant =
                typeof item === 'string' ? item : item.id;

            if (!participant) continue;

            const number = participant.split('@')[0];
            let message = '';

            if (
                update.action === 'add' &&
                config.WELCOME_ENABLED
            ) {
                message = config.WELCOME_MESSAGE ||
                    'Selamat datang @user!';
            } else if (
                update.action === 'remove' &&
                config.GOODBYE_ENABLED
            ) {
                message = config.GOODBYE_MESSAGE ||
                    'Selamat tinggal @user!';
            } else {
                continue;
            }

            message = message
                .replace(/@user/g, `@${number}`)
                .replace(/@group/g, metadata.subject);

            await sock.sendMessage(update.id, {
                text: message,
                mentions: [participant]
            });
        }
    } catch (error) {
        console.error('Welcome/goodbye:', error);
    }
});


 
  sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;

        console.log('❌ Koneksi terputus');
        console.log('Kode:', statusCode);

        if (statusCode === 515) {
            console.log('🔄 WhatsApp meminta restart socket...');
            startBot();
            return;
        }
    }

    if (connection === 'open') {
        console.log('✅ WhatsApp berhasil terhubung!');
    }
});

  
if (!state.creds.registered) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const nomor = (
      await rl.question('Nomor WhatsApp (contoh 62812xxxx): ')
    ).trim().replace(/\D/g, '');

    if (!/^62\d{8,15}$/.test(nomor)) {
      throw new Error('Format nomor tidak valid. Gunakan format 62...');
    }

    console.log('Menghubungkan ke WhatsApp...');

    await new Promise(resolve => setTimeout(resolve, 3000));

    const kode = await sock.requestPairingCode(nomor);

    console.log('\nKode pairing:', kode);
    console.log('Buka WhatsApp > Perangkat tertaut > Tautkan perangkat.');
    console.log('Pilih opsi tautkan dengan nomor telepon, lalu masukkan kode.');
  } catch (error) {
    console.error('Pairing gagal:', error.message);
    console.error('Periksa log koneksi di atas untuk mengetahui penyebabnya.');
  } finally {
    rl.close();
  }
}


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


case '/sticker':
case '/s':
case '/toimg':
case '/tovideo':
case '/toaudio':
case '/tomp3': {
  const modes = {
    '/sticker': 'sticker',
    '/s': 'sticker',
    '/toimg': 'image',
    '/tovideo': 'animated',
    '/toaudio': 'audio',
    '/tomp3': 'mp3'
  };

  try {
    await convertMedia(sock, msg, modes[cmd]);
  } catch (error) {
    console.error('Converter:', error.message);
    await sock.sendMessage(jid, {
      text: `❌ Converter gagal: ${error.message}`
    }, { quoted: msg });
  }

  continue;
}


          
case '/swgc': {
  if (!jid.endsWith('@g.us')) {
    balasan = '❌ Command ini hanya bisa digunakan di grup.';
    break;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const admins = metadata.participants
      .filter(p => p.admin)
      .map(p => `• @${p.id.split('@')[0]}`);

    balasan =
      `📊 STATUS GRUP\n\n` +
      `👥 Nama: ${metadata.subject}\n` +
      `🆔 ID: ${metadata.id}\n` +
      `👤 Anggota: ${metadata.participants.length}\n` +
      `📝 Deskripsi: ${metadata.desc || 'Belum ada'}\n\n` +
      `🛡️ Admin:\n${admins.join('\n') || 'Tidak diketahui'}`;

    await sock.sendMessage(jid, {
      text: balasan,
      mentions: metadata.participants
        .filter(p => p.admin)
        .map(p => p.id)
    }, { quoted: msg });

    continue;
  } catch (error) {
    balasan = '❌ Gagal mengambil informasi grup.';
  }

  break;
}


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
