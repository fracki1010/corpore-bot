require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { getChatResponse } = require('./src/services/groqService');
const { transcribirAudio } = require('./src/services/transcriptionService');
const { getNumberContact } = require('./src/helpers/getNumberContact');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/google-chrome-stable',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// --- VARIABLES ---
const historiales = {};
const pausados = new Set();
const esperandoNombre = {};
const NUMEROS_ADMINS = [
    '140278446997512@lid', 
    '5492622586046@c.us', 
    '15152795652173@lid'
];

// Función para normalizar lo que escribes en !on o !off
function normalizarAdminInput(texto) {
    let n = texto.replace(/\D/g, '');
    if (!n.startsWith('549')) {
        if (n.startsWith('54')) n = '549' + n.slice(2);
        else n = '549' + n;
    }
    return n;
}

client.on('qr', (qr) => {
    console.log('⚠️ QR RECIBIDO: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
});

client.on('ready', () => console.log('✅ Bot Conectado'));

client.on('message', async (message) => {
    if (message.from === 'status@broadcast') return;

    // 1. Normalizar el número que entra
    const numeroRealDelCliente = await getNumberContact(message);
    const chatId = message.from;

    // --- ZONA ADMIN ---
    if (NUMEROS_ADMINS.includes(message.from)) {
        
        // 1. COMANDO POR RESPUESTA (Más fácil y seguro)
        // Simplemente responde a un mensaje del cliente con "!off"
        if (message.body === '!off' && message.hasQuotedMsg) {
            const quotedMsg = await message.getQuotedMessage();
            const n = await getNumberContact(quotedMsg);
            pausados.add(n);
            await message.reply(`🛑 Pausado por ID: ${n}`);
            return;
        }

        // 2. COMANDO MANUAL (El que ya tenías)
        if (message.body.startsWith('!off ')) {
            const raw = message.body.split(' ')[1];
            const n = await getNumberContact(raw);
            pausados.add(n);
            await message.reply(`🛑 Pausado manual: ${n}`);
            return;
        }

        if (message.body.startsWith('!on ')) {
            const raw = message.body.split(' ')[1];
            const n = await getNumberContact(raw);
            pausados.delete(n);
            console.log(`[SISTEMA] Eliminado de pausados: ${n}`);
            await message.reply(`✅ Bot ACTIVADO para: ${n}`);
            return;
        }
    }

    // --- VERIFICACIÓN CRÍTICA (DEBUG) ---
    console.log(`[CHECK] ¿Está ${numeroRealDelCliente} en la lista? ${pausados.has(numeroRealDelCliente)}`);

    if (pausados.has(numeroRealDelCliente)) {
        console.log(`[BLOQUEADO] El bot NO responderá a ${numeroRealDelCliente}`);
        return; // Detiene el código aquí
    }

    // --- RECIBIR NOMBRE ---
    if (esperandoNombre[chatId]) {
        const nombreCliente = message.body;
        const { motivo, origen } = esperandoNombre[chatId];
        let titulo = origen === 'cierre_venta' ? '💰 VENTA' : '⚠️ RECLAMO';

        const alerta = `${titulo}\n👤: *${nombreCliente}*\n📱: ${numeroRealDelCliente}\n💬: ${motivo}\n\n🛑 Pausado. (!on ${numeroRealDelCliente} para volver)`;

        for (const admin of NUMEROS_ADMINS) { await client.sendMessage(admin, alerta); }
        await message.reply(`¡Gracias ${nombreCliente}! Ya le avisé al equipo.`);
        
        pausados.add(numeroRealDelCliente);
        delete esperandoNombre[chatId];
        return;
    }

    // --- PROCESAR AUDIO O TEXTO ---
    let mensajeUsuario = message.body;
    if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {
        const media = await message.downloadMedia();
        mensajeUsuario = await transcribirAudio(media);
    }
    if (!mensajeUsuario) return;

    // --- DETECTOR MANUAL ---
    const frasesGatillo = ["hablar con humano", "asesor", "inscripcion", "pagar", "comprar"];
    if (frasesGatillo.some(f => mensajeUsuario.toLowerCase().includes(f))) {
        await iniciarTransferencia(chatId, numeroRealDelCliente, mensajeUsuario, "manual", message);
        return;
    }

    // --- IA GROQ ---
    if (!historiales[chatId]) historiales[chatId] = [];
    historiales[chatId].push({ role: "user", content: mensajeUsuario });

    try {
        let botResponse = await getChatResponse(historiales[chatId]);

        if (botResponse.includes('[TRANSFERIR_HUMANO]')) {
            await iniciarTransferencia(chatId, numeroRealDelCliente, "Interés detectado", "cierre_venta", message);
            return;
        }

        historiales[chatId].push({ role: "assistant", content: botResponse });
        await message.reply(botResponse);
    } catch (e) { console.log("Error IA"); }
});

async function iniciarTransferencia(chatId, numeroReal, motivo, origen, messageObj) {
    esperandoNombre[chatId] = { motivo, origen };
    let msg = origen === 'cierre_venta' 
        ? "¡Genial! Por favor dime tu **nombre completo** para la inscripción:"
        : "Para derivarte con un asesor, por favor dime tu **nombre completo**:";
    await messageObj.reply(msg);
}

// API
const app = express();
app.use(express.json());
app.post('/api/send-message', async (req, res) => {
    const { number, message, apiKey } = req.body;
    if (apiKey !== 'TU_CLAVE_SECRETA_123') return res.status(403).json({ error: 'Key error' });
    const finalId = number.replace(/\D/g, '') + '@c.us';
    await client.sendMessage(finalId, message);
    res.json({ success: true });
});
app.listen(3000);
client.initialize();