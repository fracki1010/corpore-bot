require("dotenv").config();
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { getChatResponse } = require("./src/services/groqService");
const { transcribirAudio } = require("./src/services/transcriptionService");
const { getNumberContact } = require("./src/helpers/getNumberContact");
const { normalizeNumber } = require("./src/helpers/normalizedNumber");

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "/usr/src/app/.wwebjs_auth",
  }),
  // Evitar que falle si WhatsApp actualiza su versión web
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
  puppeteer: {
    headless: true,
    executablePath: "/usr/bin/google-chrome-stable",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-software-rasterizer", // Ayuda con el consumo de CPU
      "--mute-audio", // No necesitamos audio
    ],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  },
});

const historiales = {};
const pausados = new Set();
const esperandoNombre = {};

const NUMEROS_ADMINS = [
  "140278446997512@lid",
  "5492622586046@c.us",
  "15152795652173@lid",
];

let isPaused = false; // Variable de control para el bloqueo

client.on("qr", (qr) => {
  console.log(
    "⚠️ QR: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" +
      encodeURIComponent(qr),
  );

  // Activamos la pausa
  isPaused = true;
  console.log("⏳ Esperando 5 minutos antes de permitir un nuevo QR...");

  // Programamos que se desbloquee en 5 minutos (300,000 milisegundos)
  setTimeout(
    () => {
      isPaused = false;
      console.log("✅ Ya puedes intentar generar otro QR.");
    },
    2 * 60 * 1000,
  );
});

client.on("ready", () => console.log("✅ Bot Conectado"));

client.on("message", async (message) => {
  if (message.from === "status@broadcast") return;

  // 1. OBTENER NÚMERO NORMALIZADO
  const numeroClienteLimpio = await getNumberContact(message);
  const chatId = message.from;

  // --- ZONA ADMIN ---
  if (NUMEROS_ADMINS.includes(message.from)) {
    // COMANDO: !off
    if (message.body.startsWith("!off ")) {
      let targetNumber = message.body.split(" ")[1];
      if (!targetNumber) return;
      targetNumber = normalizeNumber(targetNumber);
      pausados.add(targetNumber);
      // CORREGIDO: Usar sendMessage con sendSeen: false en lugar de reply
      await client.sendMessage(chatId, `🛑 Bot PAUSADO para ${targetNumber}.`, {
        sendSeen: false,
      });
      return;
    }

    // COMANDO: !on
    if (message.body.startsWith("!on ")) {
      let targetNumber = message.body.split(" ")[1];
      if (!targetNumber) return;
      targetNumber = normalizeNumber(targetNumber);
      pausados.delete(targetNumber);
      delete historiales[chatId];
      // CORREGIDO: Usar sendMessage con sendSeen: false
      await client.sendMessage(
        chatId,
        `✅ Bot REACTIVADO para ${targetNumber}.`,
        { sendSeen: false },
      );
      return;
    }
  }

  // --- CHECK DE PAUSA ---
  if (pausados.has(numeroClienteLimpio)) {
    console.log(`🙊 Chat pausado para ${numeroClienteLimpio}`);
    return;
  }

  // --- RECIBIR NOMBRE ---
  if (esperandoNombre[chatId]) {
    const nombreCliente = message.body;
    const { motivo, origen } = esperandoNombre[chatId];
    let titulo = "⚠️ RECLAMO";
    if (origen === "cierre_venta") titulo = "💰 VENTA";
    if (origen === "consulta_admin") titulo = "🏦 ADMINISTRACIÓN";

    const alerta = `${titulo}\n👤: *${nombreCliente}*\n📱: ${numeroClienteLimpio}\n💬: ${motivo}\n\n🛑 Pausado. (!on ${numeroClienteLimpio} para volver)`;

    for (const admin of NUMEROS_ADMINS) {
      // CORREGIDO: Ya tenía sendSeen, mantenemos seguridad
      await client
        .sendMessage(admin, alerta, { sendSeen: false })
        .catch((e) => console.log("Error aviso admin"));
    }

    // CORREGIDO: Usar sendMessage en lugar de reply
    await client.sendMessage(
      chatId,
      `¡Gracias ${nombreCliente}! Ya le avisé al equipo.`,
      { sendSeen: false },
    );

    pausados.add(numeroClienteLimpio);
    delete esperandoNombre[chatId];
    return;
  }

  // --- PROCESAR MENSAJE ---
  let mensajeUsuario = message.body;
  if (
    message.hasMedia &&
    (message.type === "audio" || message.type === "ptt")
  ) {
    const media = await message.downloadMedia();
    mensajeUsuario = await transcribirAudio(media);
  }
  if (!mensajeUsuario) return;

  // --- DETECTOR MANUAL ---
  const frasesGatillo = [
    "hablar con humano",
    "asesor",
    "inscripcion",
    "pagar",
    "comprar",
  ];
  if (frasesGatillo.some((f) => mensajeUsuario.toLowerCase().includes(f))) {
    await iniciarTransferencia(
      chatId,
      numeroClienteLimpio,
      mensajeUsuario,
      "manual",
      message,
    );
    return;
  }

  // --- IA GROQ ---
  if (!historiales[chatId]) historiales[chatId] = [];
  historiales[chatId].push({ role: "user", content: mensajeUsuario });

  try {
    const chat = await message.getChat();
    await chat.sendStateTyping();

    let botResponse = await getChatResponse(historiales[chatId]);

    if (
      botResponse.includes("[TRANSFERIR_HUMANO]") ||
      botResponse.includes("[TRANSFERIR_VENTA]")
    ) {
      await iniciarTransferencia(
        chatId,
        numeroClienteLimpio,
        "IA detectó cierre de venta",
        "cierre_venta",
        message,
      );
      return;
    }

    if (botResponse.includes("[TRANSFERIR_ADMIN]")) {
      await iniciarTransferencia(
        chatId,
        numeroClienteLimpio,
        "IA detectó consulta deuda/admin",
        "consulta_admin",
        message,
      );
      return;
    }

    historiales[chatId].push({ role: "assistant", content: botResponse });

    // CORREGIDO: Asegurar sendSeen false
    await client.sendMessage(chatId, botResponse, { sendSeen: false });

    await chat.clearState();
  } catch (e) {
    console.log("Error IA o Envío");
    console.error(e.message);
  }
});

async function iniciarTransferencia(
  chatId,
  numeroReal,
  motivo,
  origen,
  messageObj,
) {
  esperandoNombre[chatId] = { motivo, origen };
  let respuestaBot = "Para derivarte, dime tu **nombre completo**:";
  if (origen === "cierre_venta") {
    respuestaBot = "¡Genial! Para la inscripción, dime tu **nombre completo**:";
  } else if (origen === "consulta_admin") {
    respuestaBot =
      "Entendido, dime tu **nombre completo** para avisar a administración:";
  }

  // CORREGIDO: Usar sendMessage con sendSeen: false
  await client.sendMessage(chatId, respuestaBot, { sendSeen: false });
}

// --- SISTEMA DE COLA PARA EVITAR SPAM/BLOQUEOS ---
const messageQueue = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue || messageQueue.length === 0) return;
  isProcessingQueue = true;

  console.log(
    `🚀 Iniciando procesamiento de cola. Mensajes pendientes: ${messageQueue.length}`,
  );

  while (messageQueue.length > 0) {
    const { number, message, resolve, reject } = messageQueue[0];

    try {
      const finalId = number.replace(/\D/g, "") + "@c.us";
      await client.sendMessage(finalId, message, { sendSeen: false });
      console.log(
        `✅ Mensaje enviado a ${number}. Restantes: ${messageQueue.length - 1}`,
      );

      // Notificamos éxito si hay una promesa esperando (opcional para uso interno)
      if (resolve) resolve({ success: true, number });
    } catch (e) {
      console.error(`❌ Error enviando a ${number}:`, e.message);
      if (reject) reject(e);
    }

    // Quitamos el mensaje procesado
    messageQueue.shift();

    // Si quedan mensajes, esperamos entre 35 y 45 segundos (promedio 40s)
    if (messageQueue.length > 0) {
      const delay = Math.floor(Math.random() * (45000 - 35000 + 1)) + 35000;
      console.log(
        `⏳ Esperando ${Math.round(delay / 1000)}s para el siguiente mensaje...`,
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  isProcessingQueue = false;
  console.log("🏁 Cola vacía. Procesamiento finalizado.");
}

// API
const app = express();
app.use(express.json());

app.post("/api/send-message", async (req, res) => {
  try {
    const { number, message, apiKey } = req.body;
    if (apiKey !== "TU_CLAVE_SECRETA_123") {
      return res.status(403).json({ error: "Key error" });
    }

    if (!number || !message) {
      return res.status(400).json({ error: "Faltan datos (number o message)" });
    }

    // Encolar el mensaje
    messageQueue.push({ number, message });

    // Iniciar el procesador si no está corriendo
    processQueue();

    res.json({
      success: true,
      status: "Encolado",
      message:
        "El mensaje se enviará respetando el intervalo de seguridad (40s).",
      queuePosition: messageQueue.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () =>
  console.log("API corriendo..."),
);

client.initialize();
