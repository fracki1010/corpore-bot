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

// --- VARIABLES DE ESTADO ---
const historiales = {};
const pausados = new Set(); 
const esperandoNombre = {}; // <--- NUEVA: Para saber a quién le preguntamos el nombre

client.on('message', async (message) => {

    // --- FILTROS ---
    if (message.from === 'status@broadcast') return;

    // TU ID DE ADMIN
    const NUMERO_ADMIN = '140278446997512@lid'; 

    // Obtener número real para uso interno/logs
    let numeroRealDelCliente = "";
    try {
        const contact = await message.getContact();
        numeroRealDelCliente = contact.number; 
    } catch (err) {
        numeroRealDelCliente = message.from.replace(/[^0-9]/g, '');
    }
    // IMPORTANTE: Asegurarnos que el ID interno sea consistente
    const chatId = message.from; 

    // =============================================
    // 🛡️ ZONA DE ADMIN (COMANDOS MANUALES)
    // =============================================
    if (message.from === NUMERO_ADMIN) {
        // !off
        if (message.body.startsWith('!off ')) {
            let rawInput = message.body.split(' ')[1] || "";
            let numeroLimpio = rawInput.replace(/[^0-9]/g, '');
            if (numeroLimpio.length < 5) return;
            pausados.add(numeroLimpio); // Pausamos por número real
            await message.reply(`🛑 Bot PAUSADO manualmente para: ${numeroLimpio}.`);
            return;
        }

        // !on
        if (message.body.startsWith('!on ')) {
            let rawInput = message.body.split(' ')[1] || "";
            let numeroLimpio = rawInput.replace(/[^0-9]/g, '');
            if (numeroLimpio.length < 5) return;
            
            pausados.delete(numeroLimpio);
            
            // Limpiamos estados
            delete esperandoNombre[chatId]; 
            // Limpiamos historial relacionado
            Object.keys(historiales).forEach(key => {
                if(key.includes(numeroLimpio)) delete historiales[key];
            });

            await message.reply(`✅ Bot REACTIVADO para: ${numeroLimpio}.`);
            return;
        }

        // !difusion
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
    // 📝 PASO 2: RECIBIR EL NOMBRE DEL CLIENTE
    // =============================================
    // Si este chat estaba esperando que le dijeran el nombre...
    if (esperandoNombre[chatId]) {
        
        // El mensaje actual ES el nombre
        const nombreCliente = message.body;
        const motivoOriginal = esperandoNombre[chatId].motivo;

        // 1. Te avisamos a ti (ADMIN) con el NÚMERO REAL
        const alertaAdmin = `⚠️ *NUEVO CASO (Humano Requerido)* ⚠️\n\n👤 Nombre: *${nombreCliente}*\n📱 Teléfono: ${numeroRealDelCliente}\n💬 Motivo: "${motivoOriginal}"\n\n🛑 El bot está pausado. Escribe al cliente y cuando termines envía: !on ${numeroRealDelCliente}`;
        
        await client.sendMessage(NUMERO_ADMIN, alertaAdmin);

        // 2. Confirmamos al cliente
        await message.reply(`Gracias ${nombreCliente}. He notificado a un asesor. En breve se comunicarán contigo.`);

        // 3. Limpiamos el estado de espera, PERO mantenemos el bloqueo en 'pausados'
        delete esperandoNombre[chatId];
        
        // Agregamos el número real a la lista de pausados para que la IA no moleste
        pausados.add(numeroRealDelCliente);
        
        return; // Fin del proceso
    }

    // =============================================
    // 🚦 CHECK DE PAUSA
    // =============================================
    if (pausados.has(numeroRealDelCliente)) {
        console.log(`🙊 Chat pausado con ${numeroRealDelCliente}.`);
        return; 
    }

    // =============================================
    // 🕵️ PASO 1: DETECTOR DE FRASE GATILLO
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
        
        // Verificación de Día de Semana (Lunes a Viernes)
        const fechaArgentina = new Date().toLocaleString("en-US", {timeZone: "America/Argentina/Buenos_Aires"});
        const diaSemana = new Date(fechaArgentina).getDay(); 
        const esFinDeSemana = (diaSemana === 0 || diaSemana === 6);

        if (!esFinDeSemana) {
            console.log(`🚨 Solicitud de humano iniciada por: ${numeroRealDelCliente}`);

            // 1. Pausamos la IA inmediatamente para que no responda tonterías
            pausados.add(numeroRealDelCliente);

            // 2. Guardamos el motivo y marcamos que esperamos el nombre
            esperandoNombre[chatId] = { 
                motivo: message.body // Guardamos lo que dijo (ej: "perdí el turno")
            };

            // 3. Pedimos el nombre
            await message.reply("Entendido. Para derivarte con el asesor correcto, por favor **escribe tu nombre completo** a continuación:");
            
            // IMPORTANTE: Quitamos de 'pausados' TEMPORALMENTE solo para permitir que entre el siguiente mensaje (el nombre)
            // La lógica de 'esperandoNombre' arriba interceptará el mensaje antes que la IA.
            pausados.delete(numeroRealDelCliente);

            return; 
        } else {
            // Fin de semana: Dejar pasar a la IA
            console.log(`📅 Pedido de humano en fin de semana. Ignorado.`);
        }
    }

    // =============================================
    // 🧠 PROCESAMIENTO DE IA Y AUDIOS (NORMAL)
    // =============================================
    let mensajeUsuario = message.body;

    if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {
        try {
            const media = await message.downloadMedia();
            const transcripcion = await transcribirAudio(media);
            if (transcripcion) mensajeUsuario = transcripcion; 
            else { await message.reply('🙉 No pude entender el audio.'); return; }
        } catch (err) { console.error(err); return; }
    }

    if (!mensajeUsuario || mensajeUsuario.length === 0) return;

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