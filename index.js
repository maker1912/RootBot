import makeWASocket, {
  useMultiFileAuthState,
  downloadMediaMessage,
  Browsers,
  generateWAMessageFromContent
} from '@whiskeysockets/baileys';

import { plugins } from 'deffa-baileys';
import crypto from 'node:crypto';
import sharp from 'sharp';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import pino from "pino";
import readline from "node:readline/promises";

const execFileAsync = promisify(execFile);

const config = JSON.parse(
  fs.readFileSync('./config.json', 'utf8')
);

const BOT_NAME = config.BOT_NAME;
const OWNER_NAME = config.OWNER_NAME || 'Owner';
const SERVER_NAME = config.SERVER_NAME;
const SERVER_IP = config.SERVER_IP;
const SERVER_PORT = config.SERVER_PORT;
const OWNER_NUMBER = config.OWNER_NUMBER;
const RULES = config.RULES.join('\n');
const ABOUT = config.ABOUT;

const SOCIALS = Object.entries(config.SOCIALS)
  .map(([name, url]) => `${name}: ${url}`)
  .join('\n');

async function downloadVideo(url) {
    const parsed = new URL(url);

    if (parsed.protocol !== 'https:') {
        throw new Error('URL harus menggunakan HTTPS.');
    }

    const allowedHosts = [
        'youtube.com', 'www.youtube.com', 'm.youtube.com',
        'youtu.be', 'music.youtube.com',
        'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
        'instagram.com', 'www.instagram.com',
        'facebook.com', 'www.facebook.com', 'fb.watch',
        'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'
    ];

    if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
        throw new Error('Platform belum didukung.');
    }

    const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'rootbot-dl-')
    );

    try {
        await execFileAsync('yt-dlp', [
            '--no-playlist',
            '-f', 'best[height<=720][ext=mp4]/best[height<=720]/best',
            '--merge-output-format', 'mp4',
            '--max-filesize', '50M',
            '--no-part',
            '-o', path.join(dir, 'video.%(ext)s'),
            url
        ], {
            timeout: 180000,
            maxBuffer: 2 * 1024 * 1024
        });

        const files = fs.readdirSync(dir)
            .filter(name => /\.(mp4|webm|mkv|mov)$/i.test(name));

        if (!files.length) {
            throw new Error('File video tidak ditemukan.');
        }

        const file = path.join(dir, files[0]);
        const stat = fs.statSync(file);

        if (stat.size > 50 * 1024 * 1024) {
            throw new Error('Video melebihi batas 50 MB.');
        }

        return { dir, file };
    } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw error;
    }
}


function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

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

    let rl;

    try {
        const repoUrl = `https://github.com/${UPDATE_REPO}.git`;

        const { stdout: remoteCommit } = await execFileAsync(
            'git',
            ['ls-remote', repoUrl, `refs/heads/${UPDATE_BRANCH}`],
            { timeout: 15000 }
        );

        const latestCommit = remoteCommit.trim().split(/\s+/)[0];
        if (!latestCommit || latestCommit === ignoredUpdateCommit) return;

        const { stdout: localCommit } = await execFileAsync(
            'git',
            ['rev-parse', 'HEAD'],
            { timeout: 10000 }
        );

        if (latestCommit === localCommit.trim()) return;

        updatePromptActive = true;

        console.log('\n🔔 UPDATE TERSEDIA!');
        console.log('Commit lokal :', localCommit.trim().slice(0, 7));
        console.log('Commit GitHub:', latestCommit.slice(0, 7));

        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const answer = (
            await rl.question('Update index.js sekarang? (y/n): ')
        ).trim().toLowerCase();

        rl.close();
        rl = null;

        if (answer !== 'y') {
            ignoredUpdateCommit = latestCommit;
            console.log('Update ditunda.');
            return;
        }

        await execFileAsync(
            'git',
            ['fetch', repoUrl, `refs/heads/${UPDATE_BRANCH}`],
            { timeout: 30000 }
        );

        const { stdout: remoteFile } = await execFileAsync(
            'git',
            ['show', 'FETCH_HEAD:index.js'],
            { maxBuffer: 10 * 1024 * 1024 }
        );

        const backupDir = path.resolve('backups');
        fs.mkdirSync(backupDir, { recursive: true });

        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, '-');

        const backupPath = path.join(
            backupDir,
            `index-${timestamp}.js`
        );

        const tempPath = path.resolve('index.update.tmp.js');
        const currentPath = path.resolve('index.js');

        fs.copyFileSync(currentPath, backupPath);
        fs.writeFileSync(tempPath, remoteFile, 'utf8');

        try {
            await execFileAsync(
                process.execPath,
                ['--check', tempPath],
                { timeout: 15000 }
            );
        } catch (error) {
            fs.rmSync(tempPath, { force: true });
            throw new Error(
                `Sintaks update tidak valid. Backup lama: ${backupPath}`
            );
        }

        fs.renameSync(tempPath, currentPath);

        console.log('✅ index.js berhasil diperbarui.');
        console.log('📦 Backup:', backupPath);
        console.log('🔄 Menjalankan ulang bot...');

        const { spawn } = await import('node:child_process');

        const child = spawn(
            process.execPath,
            ['index.js'],
            { stdio: 'inherit' }
        );

        child.on('error', error => {
            console.error('Gagal menjalankan bot baru:', error.message);
        });

        process.exit(0);

    } catch (error) {
        console.error('❌ Updater error:', error.message);
    } finally {
        rl?.close();
        updatePromptActive = false;
    }
}


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

            const user = `@${participant.split('@')[0]}`;
            const group = metadata.subject;

            const isWelcome = update.action === 'add';
            const isGoodbye =
                update.action === 'remove' ||
                update.action === 'leave';

            if (isWelcome && config.WELCOME_ENABLED === false) continue;
            if (isGoodbye && config.GOODBYE_ENABLED === false) continue;
            if (!isWelcome && !isGoodbye) continue;

            const message = (
                isWelcome
                    ? config.WELCOME_MESSAGE
                    : config.GOODBYE_MESSAGE
            ) || (isWelcome
                ? `Selamat datang di ${group}, ${user}!`
                : `${user} telah meninggalkan ${group}.`);

            const banner = isWelcome
                ? config.WELCOME_BANNER
                : config.GOODBYE_BANNER;

            const text = message
                .replace(/\{user\}/g, user)
                .replace(/\{group\}/g, group);

            const confirm = isWelcome
                ? config.WELCOME_CONFIRM
                : config.GOODBYE_CONFIRM;

            const caption = confirm
                ? `${text}\n\n— VARZE BOT`
                : text;

            if (banner && banner.startsWith('https://')) {
                await sock.sendMessage(update.id, {
                    image: { url: banner },
                    caption,
                    mentions: [participant]
                });
            } else {
                await sock.sendMessage(update.id, {
                    text: caption,
                    mentions: [participant]
                });
            }
        }
    } catch (error) {
        console.error('Welcome/Goodbye error:', error);
    }
});




 
  sock.ev.on('creds.update', saveCreds);


sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
        console.log('✅ WhatsApp terhubung!');
        return;
    }

    if (connection !== 'close') return;

    const statusCode = lastDisconnect?.error?.output?.statusCode;

    console.log('❌ Koneksi terputus. Kode:', statusCode);

    if (statusCode === 401 || statusCode === 403) {
        console.log('⚠️ Sesi ditolak atau akses ditolak.');
        console.log('Periksa autentikasi WhatsApp sebelum mencoba lagi.');
        return;
    }

    if (statusCode === 515) {
        console.log('🔄 WhatsApp meminta socket dibuat ulang.');
    }

    setTimeout(() => {
        startBot().catch(error => {
            console.error('Reconnect gagal:', error);
        });
    }, 5000);
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

    const kode = await sock.requestPairingCode(nomor);

    console.log('\nKode pairing:', kode);
    console.log('Buka WhatsApp > Perangkat tertaut > Tautkan perangkat.');
  } catch (error) {
    console.error('Pairing gagal:', error.message);
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
    `╭━━〔 OVERVIEW 〕\n` +
    `┃ Bot: ${BOT_NAME}\n` +
    `┃ Owner: ${OWNER_NAME}\n` +
    '┃\n'+
    '┃ Nama : \n'+
    '┃ Role : \n'+
    '┣━━〔 MENU UTAMA 〕\n' +
    '┃ /menu \n' +
    '┃ /ping \n' +
    '┃ /aturan \n' +
    '┃ /tentang \n' +
    '┃ /sosials\n' +
    '┃ /swgc\n' +
    '┣━━〔 CONVERTER 〕\n' +
    '┃ /sticker\n' +
    '┃ /s\n' +
    '┃ /toimg\n' +
    '┃ /tovideo\n' +
    '┃ /toaudio\n' +
    '┃ /tomp3\n' +
    '┃ /brat\n'+
    '┃ /bratvid \n'+
    '┣━━〔 DOWNLOADER 〕\n' +
    '┣━━〔 GAMES 〕\n' +
    '┣━━〔 SHOPS 〕\n' +
    '┣━━〔 ADMIN 〕\n' +
    '┃ /admin \n' +
    '┃ /settings \n' +
    '┃ /setadmin \n' +
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
    balasan = '❌ Gunakan command ini di dalam grup.';
    break;
  }

  const statusText = isi.slice(cmd.length).trim();

  if (!statusText) {
    balasan = 'Gunakan: /swgc teks status kamu';
    break;
  }

  try {
    const messageSecret = crypto.randomBytes(32);

    const generated = generateWAMessageFromContent(
      jid,
      {
        messageContextInfo: {
          messageSecret
        },
        groupStatusMessageV2: {
          message: {
            extendedTextMessage: {
              text: statusText,
              contextInfo: {
                isGroupStatus: true
              }
            },
            messageContextInfo: {
              messageSecret
            }
          }
        }
      },
      {
        userJid: sock.user.id
      }
    );

    await sock.relayMessage(
      jid,
      generated.message,
      { messageId: generated.key.id }
    );

  } catch (error) {
    console.error('SWGC error:', error);

    balasan = `❌ Gagal mengirim Status Grup: ${error.message}`;
    break;
  }

  continue;
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


case 'tt':
case 'yt':
case 'ig':
case 'fb':
case 'x':
case 'media': {
    const url = isi.trim().split(/\s+/)[1];

    if (!url) {
        await sock.sendMessage(chatId, {
            text: `Contoh penggunaan:\n/tt https://...\n/yt https://...\n/ig https://...\n/fb https://...\n/x https://...`
        }, { quoted: msg });
        break;
    }

    let result;

    try {
        await sock.sendMessage(chatId, {
            text: '⏳ Sedang memproses video...'
        }, { quoted: msg });

        result = await downloadVideo(url);

        await sock.sendMessage(chatId, {
            video: { url: result.file },
            mimetype: 'video/mp4',
            caption: '✅ Video berhasil diproses oleh VARZE BOT.'
        }, { quoted: msg });

    } catch (error) {
        console.error('Downloader error:', error);

        await sock.sendMessage(chatId, {
            text: `❌ Gagal mengunduh video.\n${error.message || 'Coba URL lain.'}`
        }, { quoted: msg });

    } finally {
        if (result?.dir) {
            fs.rmSync(result.dir, {
                recursive: true,
                force: true
            });
        }
    }

    break;
}


case '/brat':
case '/bratvid': {
    const textBrat = isi.slice(cmd.length).trim();

    if (!textBrat) {
        balasan = `Gunakan: ${cmd} teks kamu`;
        break;
    }

    if (textBrat.length > 200) {
        balasan = '❌ Maksimal 200 karakter.';
        break;
    }

    try {
        await sock.sendMessage(jid, {
            text: '⏳ Membuat stiker Brat...'
        }, { quoted: msg });

        const result = cmd === '/brat'
            ? await plugins.brat({ text: textBrat })
            : await plugins.bratvid({ text: textBrat });

        if (!result?.ok || !result.result) {
            throw new Error(
                result?.message || 'Generator tidak menghasilkan stiker.'
            );
        }

        await sock.sendMessage(jid, {
            sticker: { url: result.result },
            ...(cmd === '/bratvid' ? { isAnimated: true } : {})
        }, { quoted: msg });

    } catch (error) {
        console.error(`${cmd} error:`, error);

        await sock.sendMessage(jid, {
            text: `❌ ${cmd} gagal. Coba lagi nanti.`
        }, { quoted: msg });
    }

    continue;
}


        default:
          continue;
      }

      await sock.sendMessage(jid, { text: balasan });
    }
  });
}

startBot().catch(console.error);
