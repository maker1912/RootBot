
import makeWASocket, {
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

import pino from 'pino';
import readline from 'node:readline/promises';

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

      const isi =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      if (isi.trim().toLowerCase() === '/ping') {
        await sock.sendMessage(msg.key.remoteJid, {
          text: 'Pong! 🏓'
        });
      }
    }
  });
}

startBot().catch(console.error);
