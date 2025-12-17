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

// 1. Sistema de QR
client.on('qr', (qr) => {
    console.log('⚠️ QR RECIBIDO');
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    console.log('👇 HAZ CLIC EN ESTE ENLACE PARA VER EL CÓDIGO QR 👇');
    console.log(qrUrl);
});

// 2. Confirmación
client.on('ready', () => {
    console.log('✅ ¡El bot de WhatsApp está listo y conectado!');
});

// --- MEMORIA RAM ---
const historiales = {};
// AHORA guardaremos solo los NÚMEROS LIMPIOS (ej: "549261...")
const pausados = new Set(); 

client.on('message', async (message) => {

    // --- FILTROS BÁSICOS ---
    if (message.from === 'status@broadcast') return;

    // Tu ID de Admin (el que sale en el log, aunque sea LID)
    const NUMERO_ADMIN = '140278446997512@lid'; 

    // =============================================
    // 🛡️ ZONA DE COMANDOS DE ADMINISTRADOR
    // =============================================
    if (message.from === NUMERO_ADMIN) {
        
        // COMANDO: !off NUMERO (Pausar bot para un cliente)
        if (message.body.startsWith('!off ')) {
            // Limpiamos el número: quitamos espacios, +, @c.us, etc. Solo dejamos dígitos.
            let rawInput = message.body.split(' ')[1] || "";
            let numeroLimpio = rawInput.replace(/[^0-9]/g, '');

            if (numeroLimpio.length < 5) return; // Validación básica
            
            pausados.add(numeroLimpio);
            await message.reply(`🛑 Bot PAUSADO para el número: ${numeroLimpio}.`);
            return;
        }

        // COMANDO: !on NUMERO (Reactivar bot)
        if (message.body.startsWith('!on ')) {
            let rawInput = message.body.split(' ')[1] || "";
            let numeroLimpio = rawInput.replace(/[^0-9]/g, '');

            if (numeroLimpio.length < 5) return;

            pausados.delete(numeroLimpio);
            
            // Borramos la memoria de ese número (usando lógica aproximada) para reiniciar
            // (Iteramos para encontrar si había un historial con ese número)
            Object.keys(historiales).forEach(key => {
                if(key.includes(numeroLimpio)) delete historiales[key];
            });

            await message.reply(`✅ Bot REACTIVADO para el número: ${numeroLimpio}.`);
            return;
        }

        // COMANDO: !difusion
        if (message.body.startsWith('!difusion ')) {
            // ... (Tu lógica de difusión, mantenla igual) ...
            const mensajeParaEnviar = message.body.slice(10);
            let clientes = [];
            try {
                const rawData = fs.readFileSync('clientes.json');
                clientes = JSON.parse(rawData);
            } catch (e) { await message.reply('❌ Error leyendo clientes.json'); return; }

            await message.reply(`📢 Iniciando difusión...`);
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
    // 🚦 CHECK DE PAUSA INTELIGENTE (FIX LIDs)
    // =============================================
    // Obtenemos el contacto real para ver su número verdadero, 
    // sin importar si viene como LID o C.US
    let numeroRealDelCliente = "";
    
    try {
        const contact = await message.getContact();
        numeroRealDelCliente = contact.number; // Esto devuelve el número "549..." limpio
    } catch (err) {
        // Si falla, intentamos limpiar el ID manualmente
        numeroRealDelCliente = message.from.replace(/[^0-9]/g, '');
    }

    // Verificamos si ese número real está en la lista negra
    if (pausados.has(numeroRealDelCliente)) {
        console.log(`🙊 Chat pausado para ${numeroRealDelCliente}. (Silencio)`);
        return; // IMPORTANTE: Cortamos aquí
    }


    // =============================================
    // 🧠 PROCESAMIENTO DE IA Y AUDIOS
    // =============================================
    
    let mensajeUsuario = message.body;

    // 🔊 DETECTAR AUDIOS
    if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {
        console.log('🎤 Audio detectado...');
        try {
            const media = await message.downloadMedia();
            const transcripcion = await transcribirAudio(media);
            
            if (transcripcion) {
                console.log(`🗣️ Transcripción: "${transcripcion}"`);
                mensajeUsuario = transcripcion; 
            } else {
                await message.reply('🙉 No pude entender el audio.');
                return;
            }
        } catch (err) {
            console.error('Error audio:', err);
            return;
        }
    }

    if (!mensajeUsuario || mensajeUsuario.length === 0) return;

    // --- IA CON MEMORIA ---
    const chatId = message.from; // Usamos el ID original para guardar el historial (sea LID o C.US)
    console.log(`📩 Chat (${numeroRealDelCliente}): "${mensajeUsuario}"`);

    if (!historiales[chatId]) historiales[chatId] = [];

    historiales[chatId].push({ role: "user", content: mensajeUsuario });

    if (historiales[chatId].length > 10) {
        historiales[chatId] = historiales[chatId].slice(-10);
    }

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
// 🌐 SERVIDOR API
// ==========================================
const app = express();
app.use(express.json());

app.post('/api/send-message', async (req, res) => {
    const { number, message, apiKey } = req.body;

    if (apiKey !== 'TU_CLAVE_SECRETA_123') return res.status(403).json({ error: 'Key incorrecta' });
    if (!number || !message) return res.status(400).json({ error: 'Faltan datos' });
    if (!client.info) return res.status(503).json({ error: 'Bot offline' });

    try {
        const cleanNumber = number.replace(/\+/g, '').replace(/\s/g, '');
        const finalId = cleanNumber.includes('@c.us') ? cleanNumber : `${cleanNumber}@c.us`;
        await client.sendMessage(finalId, message);
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 API lista en puerto ${PORT}`));

client.initialize();