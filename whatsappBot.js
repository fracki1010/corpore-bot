require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs'); // <--- Movido aquí arriba para que funcione siempre
const { getChatResponse } = require('./src/services/groqService');

// Configuración del cliente
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/google-chrome-stable',
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

// 1. Sistema de QR con Link
client.on('qr', (qr) => {
    console.log('⚠️ QR RECIBIDO');
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    console.log('------------------------------------------------');
    console.log('👇 HAZ CLIC EN ESTE ENLACE PARA VER EL CÓDIGO QR 👇');
    console.log(qrUrl);
    console.log('------------------------------------------------');
});

// 2. Confirmación de conexión
client.on('ready', () => {
    console.log('✅ ¡El bot de WhatsApp está listo y conectado!');
});

// 3. Escuchar mensajes (AQUÍ EMPIEZA LA FUNCIÓN PRINCIPAL)
client.on('message', async (message) => {

    // --- FILTROS BÁSICOS ---
    if (message.from === 'status@broadcast') return; // Ignorar estados
    
    // Ignorar mensajes vacíos
    if (!message.body || message.body.length === 0) return;

    // --- MODO ADMINISTRADOR: DIFUSIÓN (ESTO DEBE IR AQUÍ ADENTRO) ---
    const NUMERO_ADMIN = '5492622517447@c.us'; 

    if (message.from === NUMERO_ADMIN && message.body.startsWith('!difusion ')) {
        // 1. Obtenemos el mensaje a enviar
        const mensajeParaEnviar = message.body.slice(10);
        
        // 2. Cargamos la lista de clientes
        let clientes = [];
        try {
            const rawData = fs.readFileSync('clientes.json');
            clientes = JSON.parse(rawData);
        } catch (e) {
            await message.reply('❌ Error: No pude leer el archivo clientes.json. ¿Existe?');
            return;
        }

        await message.reply(`📢 Iniciando difusión a ${clientes.length} contactos...`);

        // 3. Bucle de envío con RETRASO (Anti-Ban)
        for (const cliente of clientes) {
            const numeroDestino = cliente.numero + '@c.us';
            
            try {
                // Enviar mensaje
                await client.sendMessage(numeroDestino, mensajeParaEnviar);
                console.log(`✅ Enviado a ${cliente.nombre}`);
                
                // 4. ESPERA ALEATORIA (10 a 25 segundos)
                const espera = Math.floor(Math.random() * 15000) + 10000; 
                await new Promise(resolve => setTimeout(resolve, espera));

            } catch (error) {
                console.error(`❌ Falló envío a ${cliente.nombre}:`, error);
            }
        }

        await message.reply('✅ ¡Difusión terminada con éxito!');
        return; // <--- IMPORTANTE: Return para que NO siga hacia la IA
    }

    // --- IA GROQ (Solo se ejecuta si NO es difusión) ---
    console.log(`📩 Mensaje recibido de ${message.from}: ${message.body}`);

    try {
        const chat = await message.getChat();
        await chat.sendStateTyping();

        const botResponse = await getChatResponse(message.body);

        await message.reply(botResponse);
        await chat.clearState();

    } catch (error) {
        console.error('Error procesando mensaje:', error);
    }
}); // <--- AQUÍ SE CIERRA LA FUNCIÓN DE MENSAJES

// Iniciar el cliente
client.initialize();