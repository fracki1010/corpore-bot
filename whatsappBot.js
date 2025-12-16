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
    console.log('⚠️ QR RECIBIDO');
    
    // Convertimos los datos del QR en una URL de imagen
    // Usamos la API de qrserver.com (es gratis y segura para esto)
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    
    console.log('------------------------------------------------');
    console.log('👇 HAZ CLIC EN ESTE ENLACE PARA VER EL CÓDIGO QR 👇');
    console.log(qrUrl);
    console.log('------------------------------------------------');
    console.log('Escanea la imagen que aparece en el enlace con tu WhatsApp.');
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


// --- MODO ADMINISTRADOR: DIFUSIÓN ---
    
    const NUMERO_ADMIN = '5492622517447@c.us'; 

    if (message.from === NUMERO_ADMIN && message.body.startsWith('!difusion ')) {
        // 1. Obtenemos el mensaje a enviar (quitando la palabra !difusion)
        const mensajeParaEnviar = message.body.slice(10);
        
        // 2. Cargamos la lista de clientes
        const fs = require('fs');
        let clientes = [];
        try {
            const rawData = fs.readFileSync('clientes.json');
            clientes = JSON.parse(rawData);
        } catch (e) {
            await message.reply('❌ Error: No pude leer el archivo clientes.json');
            return;
        }

        await message.reply(`📢 Iniciando difusión a ${clientes.length} contactos. Esto tomará un tiempo para evitar bloqueos...`);

        // 3. Bucle de envío con RETRASO (Anti-Ban)
        for (const cliente of clientes) {
            const numeroDestino = cliente.numero + '@c.us';
            
            try {
                // Enviar mensaje
                await client.sendMessage(numeroDestino, mensajeParaEnviar);
                console.log(`✅ Enviado a ${cliente.nombre}`);
                
                // 4. ESPERA ALEATORIA (Entre 10 y 25 segundos)
                // Esto es vital para que WhatsApp no detecte que eres un robot
                const espera = Math.floor(Math.random() * 15000) + 10000; 
                await new Promise(resolve => setTimeout(resolve, espera));

            } catch (error) {
                console.error(`❌ Falló envío a ${cliente.nombre}:`, error);
            }
        }

        await message.reply('✅ ¡Difusión terminada con éxito!');
        return; // Detenemos aquí para que la IA no responda también
    }


// Iniciar el cliente
client.initialize();