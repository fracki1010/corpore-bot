require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// IMPORTANTE: Ajusta esta ruta a donde tengas tu lógica de Groq
// Si tu groqService exporta una función, úsala aquí.
// Asumiré que exportas la función 'getChatResponse'
const { getChatResponse } = require('./src/services/groqService'); 

// Configuración del cliente para Linux (especialmente si es servidor sin pantalla)
// const client = new Client({
//     authStrategy: new LocalAuth(), // Esto guarda la sesión para no escanear QR siempre
//     puppeteer: {
//         args: ['--no-sandbox', '--disable-setuid-sandbox'], // Necesario para root/linux server
//     }
// });


const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/google-chrome-stable', // Ruta de Chrome en Docker
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
    }
});

// 1. Generar el QR
client.on('qr', async (qr) => {
    // Escribe aquí TU número de teléfono al que quieres conectar el bot
    // Formato: CodigoPais + CodigoArea + Numero (Sin + ni espacios)
    const miNumero = '549xxxxxxxxxx'; // <--- ¡CAMBIA ESTO!

    console.log('⚠️ QR Recibido. Generando código de vinculación para:', miNumero);

    try {
        // Generamos el código (ej: K2J-4L1)
        const code = await client.requestPairingCode(miNumero);
        console.log('------------------------------------------------');
        console.log('🔒 TU CÓDIGO DE VINCULACIÓN:', code);
        console.log('------------------------------------------------');
        console.log('1. Ve a WhatsApp en tu celular > Dispositivos vinculados');
        console.log('2. Toca en "Vincular un dispositivo"');
        console.log('3. Toca abajo donde dice "Vincular con el número de teléfono"');
        console.log('4. Escribe el código de arriba.');
    } catch (err) {
        console.error('Error pidiendo código:', err.message);
    }
});

// 2. Confirmación de conexión
client.on('ready', () => {
    console.log('✅ ¡El bot de WhatsApp está listo y conectado!');
});

// 3. Escuchar mensajes
client.on('message', async (message) => {

    // 1. Ignorar Estados/Historias (¡CRUCIAL!)
    if (message.from === 'status@broadcast') {
        return;
    }

    // 2. (Opcional) Ignorar Grupos (Recomendado para evitar caos)
    // Si quieres que responda en grupos, borra estas 3 líneas:
    if (message.from.includes('@g.us')) {
        return; 
    }

    // 3. Ignorar mensajes vacíos o medios sin texto
    if (!message.body || message.body.length === 0) return;

    // Evitar responder a estados o grupos si no quieres
    if (message.body.length === 0) return;

    console.log(`📩 Mensaje recibido de ${message.from}: ${message.body}`);

    try {
        // A. Mostrar que el bot está "escribiendo..."
        const chat = await message.getChat();
        await chat.sendStateTyping();

        // B. Llamar a TU servicio de Groq (el que ya arreglamos con Llama 3.3)
        const botResponse = await getChatResponse(message.body);

        // C. Responder en WhatsApp
        await message.reply(botResponse);
        
        // Limpiar estado de escribiendo
        await chat.clearState();

    } catch (error) {
        console.error('Error procesando mensaje:', error);
        await message.reply('Lo siento, tuve un error interno procesando tu mensaje.');
    }
});

// Iniciar el cliente
client.initialize();