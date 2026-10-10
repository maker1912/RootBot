
import makeWASocket, {
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

import pino from 'pino';
import readline from 'node:readline/promises';

const BOT_NAME = 'VARZE BOT';
const SERVER_NAME = 'Rootakses SMP';

const SERVER_IP = 'play.example.com';
const SERVER_PORT = 19132;

const OWNER_NUMBER = '6281234567890';

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

        case '/ping':
          balasan =
            `🏓 PING SERVER\n` +
            `Server: ${SERVER_NAME}\n` +
            `Alamat: ${SERVER_IP}:${SERVER_PORT}\n` +
            'Pemeriksaan ping server belum diaktifkan.';
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
