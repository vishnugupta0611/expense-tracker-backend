const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

let client = null;
let qrCodeDataUrl = '';
let connectionStatus = 'disconnected'; // disconnected | connecting | qr_ready | connected | failed

const initWhatsApp = () => {
  if (client) return;

  connectionStatus = 'connecting';
  qrCodeDataUrl = '';

  try {
    client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'job-tracker-session',
        dataPath: './.wwebjs_auth'
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    client.on('qr', async (qr) => {
      console.log('WhatsApp QR Code received');
      connectionStatus = 'qr_ready';
      try {
        qrCodeDataUrl = await qrcode.toDataURL(qr);
      } catch (err) {
        console.error('Failed to generate QR data URL:', err);
      }
    });

    client.on('ready', () => {
      console.log('WhatsApp Client is ready!');
      connectionStatus = 'connected';
      qrCodeDataUrl = '';
    });

    client.on('authenticated', () => {
      console.log('WhatsApp Client authenticated');
    });

    client.on('auth_failure', (msg) => {
      console.error('WhatsApp Auth failure:', msg);
      connectionStatus = 'disconnected';
      client = null;
    });

    client.on('disconnected', (reason) => {
      console.log('WhatsApp Client disconnected:', reason);
      connectionStatus = 'disconnected';
      qrCodeDataUrl = '';
      client = null;
    });

    client.initialize().catch((err) => {
      console.error('Failed to initialize WhatsApp client:', err);
      connectionStatus = 'failed';
      client = null;
    });
  } catch (err) {
    console.error('WhatsApp Service creation failed:', err);
    connectionStatus = 'failed';
    client = null;
  }
};

const getStatus = () => {
  return {
    status: connectionStatus,
    qrCode: qrCodeDataUrl
  };
};

const sendWhatsAppMessage = async (number, text) => {
  if (connectionStatus !== 'connected' || !client) {
    throw new Error('WhatsApp client is not connected.');
  }

  let formattedNumber = number.replace(/[+\s-]/g, '');
  if (!formattedNumber.endsWith('@c.us')) {
    if (formattedNumber.length === 10) {
      formattedNumber = '91' + formattedNumber;
    }
    formattedNumber = formattedNumber + '@c.us';
  }

  try {
    const response = await client.sendMessage(formattedNumber, text);
    return response;
  } catch (err) {
    console.error(`Failed to send WhatsApp message to ${number}:`, err);
    throw err;
  }
};

const logoutWhatsApp = async () => {
  if (client) {
    try {
      await client.destroy();
    } catch (err) {
      console.error('Error destroying client:', err);
    }
    client = null;
    connectionStatus = 'disconnected';
    qrCodeDataUrl = '';
  }
};

module.exports = {
  initWhatsApp,
  getStatus,
  sendWhatsAppMessage,
  logoutWhatsApp
};
