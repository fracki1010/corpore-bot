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

client.on('qr', (qr) => {
    console.log('⚠️ QR RECIBIDO');
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    console.log('👇 HAZ CLIC EN ESTE ENLACE PARA VER EL CÓDIGO QR 👇');
    console.log(qrUrl);
});

client.on('ready', () => {
    console.log('✅ ¡El bot de WhatsApp está listo y conectado!');
});

// --- MEMORIA ---
const historiales = {};
const pausados = new Set(); 

client.on('message', async (message) => {

    // --- FILTROS ---
    if (message.from === 'status@broadcast') return;

    // TU ID DE ADMIN
    const NUMERO_ADMIN = '140278446997512@lid'; 

    // 1. Obtener número real del cliente (limpio)
    let numeroRealDelCliente = "";
    try {
        const contact = await message.getContact();
        numeroRealDelCliente = contact.number; 
    } catch (err) {
        numeroRealDelCliente = message.from.replace(/[^0-9]/g, '');
    }

    // =============================================
    // 🛡️ ZONA DE ADMIN (COMANDOS MANUALES)
    // =============================================
    if (message.from === NUMERO_ADMIN) {
        if (message.body.startsWith('!off ')) {
            let rawInput = message.body.split(' ')[1] || "";
            let numeroLimpio = rawInput.replace(/[^0-9]/g, '');
            if (numeroLimpio.length < 5) return;
            pausados.add(numeroLimpio);
            await message.reply(`🛑 Bot PAUSADO manualmente para: ${numeroLimpio}.`);
            return;
        }

        if (message.body.startsWith('!on ')) {
            let rawInput = message.body.split(' ')[1] || "";
            let numeroLimpio = rawInput.replace(/[^0-9]/g, '');
            if (numeroLimpio.length < 5) return;
            pausados.delete(numeroLimpio);
            // Reiniciar memoria
            Object.keys(historiales).forEach(key => {
                if(key.includes(numeroLimpio)) delete historiales[key];
            });
            await message.reply(`✅ Bot REACTIVADO para: ${numeroLimpio}.`);
            return;
        }

        if (message.body.startsWith('!difusion ')) {
            const mensajeParaEnviar = message.body.slice(10);
            let clientes = [];
            try {
                const rawData = fs.readFileSync('clientes.json');
                clientes = JSON.parse(rawData);
            } catch (e) { await message.reply('❌ Error leyendo clientes.json'); return; }

            await message.reply(`📢 Iniciando difusión a ${clientes.length} contactos...`);
            for (const cliente of clientes) {
                try {
                    const dest = cliente.numero.includes('@') ? cliente.numero : `${cliente.numero}@c.us`;
                    await client.sendMessage(dest, mensajeParaEnviar);
                    await new Promise(r => setTimeout(r, Math.random() * 5000 + 5000));
                } catch (e) { console.error('Error envío'); }
            }
            await message.reply('✅ Difusión terminada.');
            return;
        }
    }

    // =============================================
    // 🚦 CHECK DE PAUSA (SI YA ESTÁ PAUSADO)
    // =============================================
    if (pausados.has(numeroRealDelCliente)) {
        console.log(`🙊 Chat pausado con ${numeroRealDelCliente}. (Silencio)`);
        return; 
    }

    // =============================================
    // 🕵️ DETECTOR AUTOMÁTICO DE "HUMANO" / FINALIZAR
    // =============================================
    // Aquí definimos las palabras clave que activan la alarma
    const mensajeTexto = message.body ? message.body.toLowerCase() : "";
    
    const frasesGatillo = [
        "hablar con humano",
        "asesor",
        "hablar con una persona",
        "finalizar inscripcion",   // Lo que pediste
        "perdi el turno",          // Lo que pediste
        "perdí el turno",          // Con tilde
        "finalizada la inscripcion"
    ];

    // Si el mensaje contiene alguna de esas frases...
    if (frasesGatillo.some(frase => mensajeTexto.includes(frase))) {
        console.log(`🚨 DETECTADO PEDIDO DE HUMANO POR: ${numeroRealDelCliente}`);

        // 1. Pausamos al bot automáticamente
        pausados.add(numeroRealDelCliente);

        // 2. Avisamos al cliente
        await message.reply("⏳ Entendido. Te derivo con un asesor humano para que revise tu caso. El bot se ha pausado y te responderemos en breve.");

        // 3. Te avisamos a ti (Admin)
        const alertaAdmin = `⚠️ *ATENCIÓN - INTERVENCIÓN REQUERIDA* ⚠️\n\n👤 Cliente: ${numeroRealDelCliente}\n💬 Dijo: "${message.body}"\n\n🛑 El bot se ha pausado automáticamente. Respondele tú y cuando termines envía: !on ${numeroRealDelCliente}`;
        
        await client.sendMessage(NUMERO_ADMIN, alertaAdmin);
        
        return; // Cortamos aquí para que la IA no responda nada más
    }


    // =============================================
    // 🧠 PROCESAMIENTO DE IA Y AUDIOS (NORMAL)
    // =============================================
    
    let mensajeUsuario = message.body;

    // 🔊 Audios
    if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {
        try {
            const media = await message.downloadMedia();
            const transcripcion = await transcribirAudio(media);
            if (transcripcion) {
                mensajeUsuario = transcripcion; 
            } else {
                await message.reply('🙉 No pude entender el audio.');
                return;
            }
        } catch (err) { console.error(err); return; }
    }

    if (!mensajeUsuario || mensajeUsuario.length === 0) return;

    // --- IA Memoria ---
    const chatId = message.from; 

    if (!historiales[chatId]) historiales[chatId] = [];
    historiales[chatId].push({ role: "user", content: mensajeUsuario });
    if (historiales[chatId].length > 10) historiales[chatId] = historiales[chatId].slice(-10);

    try {
        const chat = await message.getChat();
        await chat.sendStateTyping();

        const botResponse = await getChatResponse(historiales[chatId]);

        historiales[chatId].push({ role: "assistant", content: botResponse });
        await message.reply(botResponse);
        await chat.clearState();

    } catch (error) {
        console.error('Error IA:', error);
        historiales[chatId] = [];
    }
});

// ==========================================
// 🌐 API
// ==========================================
const app = express();
app.use(express.json());
app.post('/api/send-message', async (req, res) => {
    // ... (Tu código API de siempre) ...
    const { number, message, apiKey } = req.body;
    if (apiKey !== 'TU_CLAVE_SECRETA_123') return res.status(403).json({ error: 'Key incorrecta' });
    if (!number || !message) return res.status(400).json({ error: 'Faltan datos' });
    
    try {
        const cleanNumber = number.replace(/\+/g, '').replace(/\s/g, '');
        const finalId = cleanNumber.includes('@c.us') ? cleanNumber : `${cleanNumber}@c.us`;
        await client.sendMessage(finalId, message);
        return res.json({ success: true });
    } catch (error) { return res.status(500).json({ error: error.message }); }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 API lista en puerto ${PORT}`));

client.initialize();