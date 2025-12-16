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
client.on('qr', (qr) => {
    console.log('Escanea este código QR con tu WhatsApp:');
    qrcode.generate(qr, { small: true });
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