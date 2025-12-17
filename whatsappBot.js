require('dotenv').config();
const express = require('express');
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

// --- MEMORIA RAM DE CONVERSACIONES ---
// Guardará los últimos mensajes de cada número
const historiales = {};

client.on('message', async (message) => {

    // --- FILTROS ---
    if (message.from === 'status@broadcast') return;
    if (!message.body || message.body.length === 0) return;

    // --- MODO DIFUSIÓN (Tu código de admin) ---
    const NUMERO_ADMIN = '140278446997512@lid'; // <--- ASEGÚRATE QUE ESTE SEA TU ID

    if (message.from === NUMERO_ADMIN && message.body.startsWith('!difusion ')) {
        // ... (Copia aquí tu lógica de difusión que ya funcionaba) ...
        // (Por brevedad no la repito toda, pero mantén tu bloque de difusión aquí)
        // Si no lo tienes a mano, avísame y te lo paso completo de nuevo.
        const mensajeParaEnviar = message.body.slice(10);
        let clientes = [];
        try {
            const rawData = fs.readFileSync('clientes.json');
            clientes = JSON.parse(rawData);
        } catch (e) { await message.reply('❌ Error leyendo clientes.json'); return; }

        await message.reply(`📢 Iniciando difusión...`);
        for (const cliente of clientes) {
            try {
                await client.sendMessage(cliente.numero + '@c.us', mensajeParaEnviar);
                await new Promise(r => setTimeout(r, Math.random() * 5000 + 5000));
            } catch (e) { console.error('Falló uno'); }
        }
        await message.reply('✅ Difusión terminada.');
        return;
    }

    // --- LÓGICA DE IA CON MEMORIA ---

    const chatId = message.from;
    console.log(`📩 Mensaje de ${chatId}: ${message.body}`);

    // 1. Inicializar historial si es nuevo
    if (!historiales[chatId]) {
        historiales[chatId] = [];
    }

    // 2. Agregar mensaje del USUARIO al historial
    historiales[chatId].push({
        role: "user",
        content: message.body
    });

    // 3. Limitar memoria (Solo recordamos los últimos 10 mensajes para no saturar)
    if (historiales[chatId].length > 10) {
        historiales[chatId] = historiales[chatId].slice(-10);
    }

    try {
        const chat = await message.getChat();
        await chat.sendStateTyping();

        // 4. Enviamos EL HISTORIAL COMPLETO a la IA (no solo el mensaje actual)
        const botResponse = await getChatResponse(historiales[chatId]);

        // 5. Agregar respuesta del BOT al historial
        historiales[chatId].push({
            role: "assistant",
            content: botResponse
        });

        await message.reply(botResponse);
        await chat.clearState();

    } catch (error) {
        console.error('Error procesando mensaje:', error);
        // Si falla, borramos el historial por si acaso se corrompió
        historiales[chatId] = [];
    }
});


// ==========================================
// 🌐 SERVIDOR API (PARA ENVIAR MENSAJES)
// ==========================================
const app = express();
app.use(express.json()); // Permite recibir JSON

// Endpoint para enviar mensaje
// Se llama con POST a: /api/send-message
app.post('/api/send-message', async (req, res) => {
    const { number, message, apiKey } = req.body;

    // 1. Seguridad básica (API KEY)
    // Cambia '12345' por una clave secreta difícil
    if (apiKey !== 'TU_CLAVE_SECRETA_123') {
        return res.status(403).json({ error: 'Acceso denegado: API Key incorrecta' });
    }

    // 2. Validaciones
    if (!number || !message) {
        return res.status(400).json({ error: 'Faltan datos: number o message' });
    }

    if (!client.info) {
        return res.status(503).json({ error: 'El bot de WhatsApp aún no está listo/conectado' });
    }

    try {
        // 3. Formatear número (Agregar @c.us si falta)
        // Eliminamos el '+' si viene, y quitamos espacios
        const cleanNumber = number.replace(/\+/g, '').replace(/\s/g, '');
        const finalId = cleanNumber.includes('@c.us') ? cleanNumber : `${cleanNumber}@c.us`;

        // 4. Enviar mensaje
        await client.sendMessage(finalId, message);

        console.log(`📤 API: Mensaje enviado a ${cleanNumber}`);
        return res.json({ success: true, status: 'Mensaje enviado correctamente' });

    } catch (error) {
        console.error('❌ Error en API:', error);
        return res.status(500).json({ error: 'Error interno enviando mensaje', details: error.message });
    }
});

// Iniciar servidor web en el puerto que asigne Railway (o 3000)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor API escuchando en el puerto ${PORT}`);
});
// ==========================================

client.initialize();