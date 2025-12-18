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

    // 1. Obtener número real del cliente
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
    // 🚦 CHECK DE PAUSA
    // =============================================
    if (pausados.has(numeroRealDelCliente)) {
        console.log(`🙊 Chat pausado con ${numeroRealDelCliente}. (Silencio)`);
        return; 
    }

    // =============================================
    // 🕵️ DETECTOR AUTOMÁTICO DE "HUMANO" (SOLO LUNES A VIERNES)
    // =============================================
    const mensajeTexto = message.body ? message.body.toLowerCase() : "";
    
    const frasesGatillo = [
        "hablar con humano",
        "asesor",
        "hablar con una persona",
        "finalizar inscripcion",
        "perdi el turno",
        "perdí el turno",
        "finalizada la inscripcion"
    ];

    if (frasesGatillo.some(frase => mensajeTexto.includes(frase))) {
        
        // --- 📅 NUEVO: VERIFICACIÓN DE DÍA DE SEMANA ---
        // Obtenemos la fecha actual en Argentina
        const fechaArgentina = new Date().toLocaleString("en-US", {timeZone: "America/Argentina/Buenos_Aires"});
        const diaSemana = new Date(fechaArgentina).getDay(); 
        // 0 = Domingo, 6 = Sábado. Los días hábiles son 1, 2, 3, 4, 5.

        const esFinDeSemana = (diaSemana === 0 || diaSemana === 6);

        if (!esFinDeSemana) {
            // SI ES DÍA DE SEMANA (Lunes a Viernes) -> ACTIVAMOS LA ALERTA
            console.log(`🚨 DETECTADO PEDIDO DE HUMANO POR: ${numeroRealDelCliente}`);

            pausados.add(numeroRealDelCliente);

            await message.reply("⏳ Entendido. Te derivo con un asesor humano para que revise tu caso. El bot se ha pausado y te responderemos en breve.");

            const alertaAdmin = `⚠️ *ATENCIÓN (Día Hábil)* ⚠️\n\n👤 Cliente: ${numeroRealDelCliente}\n💬 Dijo: "${message.body}"\n\n🛑 El bot se ha pausado. Respondele tú y envía !on ${numeroRealDelCliente} al terminar.`;
            
            await client.sendMessage(NUMERO_ADMIN, alertaAdmin);
            
            return; // Cortamos aquí
        } else {
            // SI ES FIN DE SEMANA -> NO HACEMOS NADA
            console.log(`📅 Pedido de humano detectado, pero es Fin de Semana. Dejamos que la IA responda.`);
            // No hacemos return, dejamos que el código siga hacia abajo y la IA responda normalmente.
        }
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