require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const { getChatResponse } = require('./src/services/groqService');
const { transcribirAudio } = require('./src/services/transcriptionService');
const { getNumberContact } = require('./src/helpers/getNumberContact');

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

// --- VARIABLES ---
const historiales = {};
const pausados = new Set();
const esperandoNombre = {};

client.on('message', async (message) => {

    if (message.from === 'status@broadcast') return;

    const NUMEROS_ADMINS = [
        '140278446997512@lid',  // Tu admin original
        '5492622586046@c.us',   // Agus
        '5492610000000@c.us'    // Anto
    ];


    const numeroRealDelCliente = await getNumberContact(message);


    const chatId = message.from;

    console.log(chatId);
    

    // --- ZONA ADMIN ---
    if (NUMEROS_ADMINS.includes(message.from)) {
        if (message.body.startsWith('!off ')) {
            let n = message.body.split(' ')[1]?.replace(/[^0-9]/g, '');
            if (n && n.length > 4) { pausados.add(n); await message.reply(`🛑 Pausado: ${n}`); }
            return;
        }
        if (message.body.startsWith('!on ')) {
            let n = message.body.split(' ')[1]?.replace(/[^0-9]/g, '');
            if (n && n.length > 4) {
                pausados.delete(n);
                delete esperandoNombre[chatId];
                Object.keys(historiales).forEach(k => { if (k.includes(n)) delete historiales[k]; });
                await message.reply(`✅ Reactivado: ${n}`);
            }
            return;
        }
        // ... (Mantén tu lógica de difusión aquí si la usas)
    }

    // --- PASO 2: RECIBIR NOMBRE ---
    if (esperandoNombre[chatId]) {
        const nombreCliente = message.body;
        const motivoOriginal = esperandoNombre[chatId].motivo;
        const origen = esperandoNombre[chatId].origen; // "manual" o "cierre_venta"

        // Mensaje diferente para el admin dependiendo si fue cierre de venta o reclamo
        let tituloAlerta = origen === 'cierre_venta' ? '💰 ¡NUEVA VENTA CERRADA!' : '⚠️ NUEVO RECLAMO/CONSULTA';

        const alertaAdmin = `${tituloAlerta}\n\n👤 Nombre: *${nombreCliente}*\n📱 Teléfono: ${numeroRealDelCliente}\n💬 Contexto: "${motivoOriginal}"\n\n🛑 El bot está pausado. ¡Atiéndelo para cerrar! (!on ${numeroRealDelCliente} al terminar)`;

        await client.sendMessage(NUMERO_ADMIN, alertaAdmin);
        await message.reply(`¡Excelente ${nombreCliente}! Ya le avisé al administrador para que finalice tu inscripción. Te escribirá en breve.`);

        delete esperandoNombre[chatId];
        pausados.add(numeroRealDelCliente);
        return;
    }

    if (pausados.has(numeroRealDelCliente)) return;

    // --- PROCESAR MENSAJE ---
    let mensajeUsuario = message.body;
    if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {

        try {
            const media = await message.downloadMedia();
            const t = await transcribirAudio(media);
            if (t) mensajeUsuario = t; else { await message.reply('🙉 Audio no entendido'); return; }
        } catch (e) { return; }
    }
    if (!mensajeUsuario) return;

    // --- DETECTOR MANUAL (Palabras clave) ---
    const frasesGatillo = ["hablar con humano", "asesor", "finalizar inscripcion", "perdi el turno"];
    if (frasesGatillo.some(f => mensajeUsuario.toLowerCase().includes(f))) {
        await iniciarTransferencia(chatId, numeroRealDelCliente, mensajeUsuario, "manual", message);
        return;
    }

    // --- IA CON DETECCIÓN DE CIERRE ---
    if (!historiales[chatId]) historiales[chatId] = [];
    historiales[chatId].push({ role: "user", content: mensajeUsuario });
    if (historiales[chatId].length > 10) historiales[chatId] = historiales[chatId].slice(-10);

    try {
        const chat = await message.getChat();
        await chat.sendStateTyping();

        // Obtenemos respuesta de Groq
        let botResponse = await getChatResponse(historiales[chatId]);

        // 🕵️ DETECTOR DE CIERRE DE VENTA AUTOMÁTICO
        if (botResponse.includes('[TRANSFERIR_HUMANO]')) {
            console.log("💰 INTELIGENCIA ARTIFICIAL DETECTÓ CIERRE DE VENTA");
            // No enviamos la respuesta de la IA (que solo dice [TRANSFERIR...])
            // Iniciamos el flujo de pedir nombre
            await iniciarTransferencia(chatId, numeroRealDelCliente, "Cliente listo para inscribirse/comprar", "cierre_venta", message);
            return;
        }

        // Si no hay cierre, respondemos normal
        historiales[chatId].push({ role: "assistant", content: botResponse });
        await message.reply(botResponse);
        await chat.clearState();

    } catch (error) {
        console.error('Error IA:', error);
        historiales[chatId] = [];
    }
});

// --- FUNCIÓN AUXILIAR PARA NO REPETIR CÓDIGO ---
async function iniciarTransferencia(chatId, numeroReal, motivo, origen, messageObj) {
    const fechaArgentina = new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" });
    const diaSemana = new Date(fechaArgentina).getDay();
    const esFinDeSemana = (diaSemana === 0 || diaSemana === 6);

    if (!esFinDeSemana) {
        esperandoNombre[chatId] = { motivo: motivo, origen: origen };

        let respuestaBot = "";
        if (origen === 'cierre_venta') {
            respuestaBot = "¡Genial! Para dejar asentada tu inscripción, por favor dime **tu nombre completo**:";
        } else {
            respuestaBot = "Entendido. Para derivarte con un asesor, por favor dime **tu nombre completo**:";
        }

        await messageObj.reply(respuestaBot);
    } else {
        // Fin de semana: Si es venta cerrada, igual tomamos el dato pero avisamos
        if (origen === 'cierre_venta') {
            await messageObj.reply("¡Genial! Como es fin de semana, déjame tu nombre y el lunes a primera hora te contactamos para finalizar.");
            // Aquí podrías guardar el nombre directo si quisieras, pero mantenemos la lógica simple
            esperandoNombre[chatId] = { motivo: motivo, origen: origen };
        }
    }
}

// API y Start
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
app.listen(PORT, () => console.log(`🌐 API ${PORT}`));
client.initialize();