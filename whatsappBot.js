require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { getChatResponse } = require('./src/services/groqService');
const { transcribirAudio } = require('./src/services/transcriptionService');
const { getNumberContact } = require('./src/helpers/getNumberContact');
const { normalizeNumber } = require('./src/helpers/normalizedNumber');

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

// --- VARIABLES ---
const historiales = {};
const pausados = new Set();
const esperandoNombre = {};

const NUMEROS_ADMINS = [
    '140278446997512@lid',
    '5492622586046@c.us',
    '15152795652173@lid'
];



client.on('qr', (qr) => {
    console.log('⚠️ QR RECIBIDO: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
});

client.on('ready', () => console.log('✅ Bot Conectado'));

client.on('message', async (message) => {
    if (message.from === 'status@broadcast') return;

    // Obtenemos el contacto para ver la diferencia entre ID y número real
    const contact = await message.getContact();

    // Creamos un objeto con la info más importante para no saturar la consola
    const infoMensaje = {
        from: message.from,        // El ID de WhatsApp (ej: @c.us o @lid)
        body: message.body,        // El texto que enviaron
        type: message.type,        // Si es chat, audio, etc.
        pushname: message._data.notifyName, // Nombre que tiene el usuario en su WA
        contact: {
            number: contact.number, // <--- ESTE ES EL NÚMERO QUE USAMOS PARA PAUSAR
            name: contact.name,
            isMyContact: contact.isMyContact
        }
    };

    console.log("---------- NUEVO MENSAJE RECIBIDO ----------");
    console.log(JSON.stringify(infoMensaje, null, 2)); // El '2' es para que se vea con sangría (identado)
    console.log("--------------------------------------------");

    // 1. OBTENEMOS EL NÚMERO LIMPIO DE QUIEN ESCRIBE
    // Esto convierte el ID raro de WhatsApp en "5492622522358"
    // 1. IMPORTANTE: Ahora usamos AWAIT porque el helper es asíncrono
    const numeroClienteLimpio = await normalizeNumber(message);
    const chatId = message.from;

    // Log para que veas en Linux cómo se traduce el @lid a número real
    console.log(`[LOG] ID Original: ${chatId} | Número Real: ${numeroClienteLimpio}`);

    // --- ZONA ADMIN ---
    if (NUMEROS_ADMINS.includes(message.from)) {

        if (message.body.startsWith('!off ')) {
            const inputAdmin = message.body.split(' ')[1];
            if (!inputAdmin) return;

            // También usamos await aquí para estandarizar
            const numeroAPausar = await normalizeNumber(inputAdmin);
            pausados.add(numeroAPausar);

            console.log(`[SISTEMA] Pausado: ${numeroAPausar}`);
            await message.reply(`🛑 Pausado: ${numeroAPausar}`);
            return;
        }

        if (message.body.startsWith('!on ')) {
            const inputAdmin = message.body.split(' ')[1];
            if (!inputAdmin) return;

            const numeroAActivar = await normalizeNumber(inputAdmin);
            pausados.delete(numeroAActivar);

            await message.reply(`✅ Reactivado: ${numeroAActivar}`);
            return;
        }
    }

    // --- VERIFICACIÓN DE PAUSA ---
    if (pausados.has(numeroClienteLimpio)) {
        console.log(`[FILTRO] ${numeroClienteLimpio} está pausado. Ignorando.`);
        return;
    }

    // --- VERIFICACIÓN DE PAUSA (COMPARACIÓN CORRECTA) ---
    // Aquí comparamos "Peras con Peras" (Número Limpio vs Número Limpio en lista)
    console.log(numeroClienteLimpio);

    if (pausados.has(numeroClienteLimpio)) {
        console.log(`[SILENCIO] Mensaje ignorado de: ${numeroClienteLimpio}`);
        return;
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