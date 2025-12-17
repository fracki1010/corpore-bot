require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const { getChatResponse } = require('./src/services/groqService');
const { transcribirAudio } = require('./src/services/transcriptionService');

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

// --- MEMORIA RAM DE CONVERSACIONES ---
const historiales = {};

client.on('message', async (message) => {

    // --- FILTROS BÁSICOS ---
    if (message.from === 'status@broadcast') return;

    // --- MODO DIFUSIÓN (ADMIN) ---
    const NUMERO_ADMIN = '140278446997512@lid'; // Tu ID actual

    if (message.from === NUMERO_ADMIN && message.body.startsWith('!difusion ')) {
        const mensajeParaEnviar = message.body.slice(10);
        let clientes = [];
        
        try {
            const rawData = fs.readFileSync('clientes.json');
            clientes = JSON.parse(rawData);
        } catch (e) { 
            await message.reply('❌ Error: No encontré o no pude leer clientes.json'); 
            return; 
        }

        await message.reply(`📢 Iniciando difusión a ${clientes.length} contactos...`);

        for (const cliente of clientes) {
            try {
                // Formateamos el número
                const numeroDestino = cliente.numero.includes('@c.us') ? cliente.numero : `${cliente.numero}@c.us`;
                
                await client.sendMessage(numeroDestino, mensajeParaEnviar);
                console.log(`✅ Enviado a ${cliente.nombre}`);
                
                // Espera aleatoria para evitar BAN (5 a 10 segundos)
                const espera = Math.floor(Math.random() * 5000) + 5000; 
                await new Promise(r => setTimeout(r, espera));

            } catch (e) { 
                console.error(`❌ Falló envío a ${cliente.nombre}`); 
            }
        }
        await message.reply('✅ Difusión terminada.');
        return; // Detenemos aquí
    }

    // --- PROCESAMIENTO DE AUDIO Y TEXTO ---
    
    let mensajeUsuario = message.body; // Por defecto es el texto

    // 🔊 DETECTAR AUDIOS
    if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {
        console.log('🎤 Audio detectado. Procesando...');
        try {
            const media = await message.downloadMedia();
            const transcripcion = await transcribirAudio(media);
            
            if (transcripcion) {
                console.log(`🗣️ Transcripción: "${transcripcion}"`);
                mensajeUsuario = transcripcion; // Reemplazamos el audio por su texto
            } else {
                await message.reply('🙉 Escuché el audio pero no entendí lo que dijiste.');
                return;
            }
        } catch (err) {
            console.error('Error procesando audio:', err);
            return;
        }
    }

    // Si después de intentar transcribir, el mensaje sigue vacío (ej: una foto sin texto), ignoramos
    if (!mensajeUsuario || mensajeUsuario.length === 0) return;

    // --- LÓGICA DE IA CON MEMORIA ---
    const chatId = message.from;
    console.log(`📩 Chat con ${chatId}: "${mensajeUsuario}"`);

    // 1. Inicializar historial
    if (!historiales[chatId]) historiales[chatId] = [];

    // 2. Agregar mensaje del USUARIO
    historiales[chatId].push({ role: "user", content: mensajeUsuario });

    // 3. Limitar memoria (Últimos 10 mensajes)
    if (historiales[chatId].length > 10) {
        historiales[chatId] = historiales[chatId].slice(-10);
    }

    try {
        const chat = await message.getChat();
        await chat.sendStateTyping(); // Escribiendo...

        // 4. Consultar a Groq con todo el historial
        const botResponse = await getChatResponse(historiales[chatId]);

        // 5. Agregar respuesta del BOT al historial
        historiales[chatId].push({ role: "assistant", content: botResponse });

        await message.reply(botResponse);
        await chat.clearState();

    } catch (error) {
        console.error('Error en IA:', error);
        historiales[chatId] = []; // Reiniciar memoria si falla
    }
});


// ==========================================
// 🌐 SERVIDOR API (EXPRESS)
// ==========================================
const app = express();
app.use(express.json());

app.post('/api/send-message', async (req, res) => {
    const { number, message, apiKey } = req.body;

    if (apiKey !== 'TU_CLAVE_SECRETA_123') {
        return res.status(403).json({ error: 'API Key incorrecta' });
    }

    if (!number || !message) {
        return res.status(400).json({ error: 'Faltan datos' });
    }

    if (!client.info) {
        return res.status(503).json({ error: 'Bot no conectado' });
    }

    try {
        const cleanNumber = number.replace(/\+/g, '').replace(/\s/g, '');
        const finalId = cleanNumber.includes('@c.us') ? cleanNumber : `${cleanNumber}@c.us`;

        await client.sendMessage(finalId, message);
        console.log(`📤 API: Enviado a ${cleanNumber}`);
        return res.json({ success: true });

    } catch (error) {
        console.error('❌ Error API:', error);
        return res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 API lista en puerto ${PORT}`));

client.initialize();