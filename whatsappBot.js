require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { getChatResponse } = require("./src/services/groqService");
const { transcribirAudio } = require("./src/services/transcriptionService");
const { getNumberContact } = require("./src/helpers/getNumberContact");
const { normalizeNumber } = require("./src/helpers/normalizedNumber");
const scheduleOverridesRoutes = require("./src/routes/scheduleOverridesRoutes");
const { requireAdminApiKey } = require("./src/middlewares/adminApiKeyMiddleware");

const isProduction = process.env.NODE_ENV === "production";
const defaultAuthPath = isProduction
  ? "/usr/src/app/.wwebjs_auth"
  : path.join(process.cwd(), ".wwebjs_auth");
const authDataPath = process.env.WWEBJS_AUTH_PATH || defaultAuthPath;
const sessionDataPath = path.join(authDataPath, "session");
const webVersionRemotePath =
  process.env.WWEBJS_REMOTE_PATH ||
  "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1036065881-alpha.html";

function safeRemove(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  } catch (_error) {
    // Evitamos romper el arranque si no se puede borrar por permisos.
  }
}

function cleanOrValidateSessionLocks() {
  const lockPath = path.join(sessionDataPath, "SingletonLock");

  try {
    if (fs.existsSync(lockPath)) {
      const linkTarget = fs.readlinkSync(lockPath);
      const pid = Number(String(linkTarget).split("-").pop());

      if (Number.isFinite(pid)) {
        try {
          process.kill(pid, 0);
          console.error(
            `❌ Ya hay una instancia de Chrome usando la sesión (${sessionDataPath}) [PID ${pid}].`,
          );
          console.error("Cerrá la instancia previa del bot antes de iniciar otra.");
          process.exit(1);
        } catch (_notRunning) {
          // PID inexistente: lock stale, limpiamos abajo.
        }
      }
    }
  } catch (_error) {
    // Si falla la validación del symlink, intentamos limpieza de stale locks.
  }

  safeRemove(path.join(sessionDataPath, "SingletonLock"));
  safeRemove(path.join(sessionDataPath, "SingletonSocket"));
  safeRemove(path.join(sessionDataPath, "SingletonCookie"));
  safeRemove(path.join(sessionDataPath, "DevToolsActivePort"));
}

cleanOrValidateSessionLocks();

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: authDataPath,
  }),
  // Fijamos una versión remota vigente para evitar "conecta pero no entrega eventos".
  webVersionCache: {
    type: "remote",
    remotePath: webVersionRemotePath,
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
const hechosConfirmadosPorChat = new Map();
const inboundMessageBuffer = new Map();
let lastQr = null;
let lastQrAt = null;
let botState = "starting";
let lifecycleActionInProgress = false;
let lastInboundMessageAt = null;
let lastOutboundMessageAt = null;
let lastKnownWaState = null;
let lastKnownConnected = null;
const processedMessageIds = new Set();
const BOT_TIMEZONE =
  process.env.BOT_TIMEZONE || "America/Argentina/Buenos_Aires";
const TIEMPO_AGRUPACION_MS = Number(
  process.env.MESSAGE_GROUP_WINDOW_MS ||
    process.env.BOT_MESSAGE_GROUP_DELAY_MS ||
    process.env.BOT_REPLY_DELAY_MS ||
    12000,
);
const TIEMPO_AGRUPACION_SEGURO_MS =
  Number.isFinite(TIEMPO_AGRUPACION_MS) && TIEMPO_AGRUPACION_MS > 0
    ? TIEMPO_AGRUPACION_MS
    : 12000;
const INDEX_TO_WEEKDAY = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];
const MONTH_TO_MM = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  abriel: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

const NUMEROS_ADMINS = [
  "140278446997512@lid",
  "5492622586046@c.us",
  "15152795652173@lid",
];

let isPaused = false; // Variable de control para el bloqueo

function normalizeTxt(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatDate(dd, mm, yyyy) {
  return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${yyyy}`;
}

function dayOfWeekIndex(dd, mm, yyyy) {
  const date = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: BOT_TIMEZONE,
    weekday: "short",
  })
    .format(date)
    .toLowerCase();
  const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[weekday] ?? 0;
}

function getTodayInBotTimezone() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("es-AR", {
    timeZone: BOT_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const weekday =
    (parts.find((p) => p.type === "weekday")?.value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") || "desconocido";
  const day = Number(parts.find((p) => p.type === "day")?.value || "0");
  const month = Number(parts.find((p) => p.type === "month")?.value || "0");
  const year = Number(parts.find((p) => p.type === "year")?.value || "0");
  return { weekday, day, month, year };
}

function getCurrentYearInBotTimezone() {
  return getTodayInBotTimezone().year || new Date().getUTCFullYear();
}

function extraerFeriadosConfirmados(texto) {
  const textoLower = normalizeTxt(texto);
  if (!textoLower.includes("feriado")) return [];

  const patrones = [
    /(\d{1,2})\s*y\s*(\d{1,2})\s*de\s*([a-záéíóú]+)/g,
    /(\d{1,2})\s*de\s*([a-záéíóú]+)/g,
  ];
  const encontrados = [];

  for (const patron of patrones) {
    let match;
    while ((match = patron.exec(textoLower)) !== null) {
      if (match.length === 4) {
        const d1 = String(Number(match[1])).padStart(2, "0");
        const d2 = String(Number(match[2])).padStart(2, "0");
        const mm = MONTH_TO_MM[normalizeTxt(match[3] || "")];
        if (mm) encontrados.push(`${d1}-${mm}`, `${d2}-${mm}`);
      } else if (match.length === 3) {
        const dd = String(Number(match[1])).padStart(2, "0");
        const mm = MONTH_TO_MM[normalizeTxt(match[2] || "")];
        if (mm) encontrados.push(`${dd}-${mm}`);
      }
    }
  }

  return [...new Set(encontrados)];
}

function registrarHechosUsuario(chatId, textoUsuario) {
  const hechos = hechosConfirmadosPorChat.get(chatId) || { feriados: new Set() };
  const feriados = extraerFeriadosConfirmados(textoUsuario);
  for (const fecha of feriados) hechos.feriados.add(fecha);
  hechosConfirmadosPorChat.set(chatId, hechos);
}

function construirContextoDinamico(chatId) {
  const hechos = hechosConfirmadosPorChat.get(chatId);
  const today = getTodayInBotTimezone();
  const fechaActual = today.day
    ? `${today.weekday} ${formatDate(today.day, today.month, today.year)}`
    : "";
  if ((!hechos || hechos.feriados.size === 0) && !fechaActual) return "";

  const lines = [];
  if (fechaActual) lines.push(`- Fecha actual (${BOT_TIMEZONE}): ${fechaActual}.`);

  if (hechos && hechos.feriados.size > 0) {
    const year = getCurrentYearInBotTimezone();
    const feriados = [...hechos.feriados]
      .sort()
      .map((f) => {
        const [dd, mm] = f.split("-").map(Number);
        const dow = INDEX_TO_WEEKDAY[dayOfWeekIndex(dd, mm, year)];
        return `${formatDate(dd, mm, year)} (${dow})`;
      })
      .join(", ");
    lines.push(`- Feriados mencionados por el usuario: ${feriados}.`);
  }

  return [
    "HECHOS CONFIRMADOS POR EL USUARIO (NO CONTRADECIR):",
    ...lines,
    "- Si el usuario corrige una fecha o feriado, se toma su correccion como valida.",
    "- No inventes el dia de semana de una fecha si no estas 100% seguro.",
  ].join("\n");
}

function detectarConsultaHorarioPorDiaSemana(texto) {
  const text = normalizeTxt(texto);
  const regex =
    /(abre|abren|abierto|abierta|esta abierto|esta abierta|estamos abiertos|estamos abiertas).{0,24}?\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/;
  const match = text.match(regex);
  if (!match) return null;
  return match[2];
}

function detectarContradiccionDiaFecha(texto) {
  const text = normalizeTxt(texto);
  const regex =
    /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b.{0,10}?(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?/;
  const match = text.match(regex);
  if (!match) return null;

  const weekdayInformado = match[1];
  const dd = Number(match[2]);
  const mm = Number(MONTH_TO_MM[match[3]] || 0);
  const yyyy = Number(match[4] || getCurrentYearInBotTimezone());
  if (!dd || !mm || !yyyy) return null;

  const weekdayReal = INDEX_TO_WEEKDAY[dayOfWeekIndex(dd, mm, yyyy)];
  if (weekdayReal === weekdayInformado) return null;

  return { weekdayInformado, weekdayReal, dd, mm, yyyy };
}

function resolverReglaDeterministica(chatId, mensajeUsuario) {
  const text = normalizeTxt(mensajeUsuario);

  if (
    /(que dia es hoy|que fecha es hoy|hoy que dia es|hoy que fecha es|que dia es|que fecha es)/.test(
      text,
    )
  ) {
    const today = getTodayInBotTimezone();
    if (today.day && today.month && today.year) {
      return `Hoy es ${today.weekday} ${formatDate(today.day, today.month, today.year)} (${BOT_TIMEZONE}).`;
    }
  }

  const contradiction = detectarContradiccionDiaFecha(mensajeUsuario);
  if (contradiction) {
    return `Ojo: ${formatDate(contradiction.dd, contradiction.mm, contradiction.yyyy)} cae ${contradiction.weekdayReal}, no ${contradiction.weekdayInformado}.`;
  }

  const weekdayConsultado = detectarConsultaHorarioPorDiaSemana(mensajeUsuario);
  if (!weekdayConsultado) return null;

  const hechos = hechosConfirmadosPorChat.get(chatId);
  if (!hechos || hechos.feriados.size === 0) return null;

  const year = getCurrentYearInBotTimezone();
  const feriadosQueCaenEseDia = [...hechos.feriados]
    .map((f) => {
      const [dd, mm] = f.split("-").map(Number);
      const dow = INDEX_TO_WEEKDAY[dayOfWeekIndex(dd, mm, year)];
      return { dd, mm, dow };
    })
    .filter((f) => f.dow === weekdayConsultado);

  if (feriadosQueCaenEseDia.length === 0) return null;

  const fechas = feriadosQueCaenEseDia
    .map((f) => formatDate(f.dd, f.mm, year))
    .join(", ");

  return `No, este ${weekdayConsultado} estamos cerrados por feriado (${fechas}). Abrimos de lunes a viernes excepto feriados.`;
}

async function refreshConnectionSnapshot(trigger) {
  let waState = null;
  try {
    waState = await client.getState();
  } catch (_error) {
    waState = null;
  }

  const normalizedWaState = waState ? String(waState).toLowerCase() : null;
  const wid = client?.info?.wid?._serialized || null;
  const isConnected =
    normalizedWaState === "connected" ||
    normalizedWaState === "open" ||
    normalizedWaState === "ready";

  if (isConnected) {
    botState = normalizedWaState || "connected";
    lastQr = null;
  } else if (normalizedWaState) {
    botState = normalizedWaState;
  }

  if (lastKnownWaState !== normalizedWaState) {
    console.log(
      `🔄 Snapshot [${trigger}] -> state=${normalizedWaState || "null"} wid=${wid || "null"} connected=${isConnected}`,
    );
    lastKnownWaState = normalizedWaState;
  }

  if (lastKnownConnected !== isConnected) {
    if (isConnected) {
      console.log("✅ Bot Conectado");
    } else if (lastKnownConnected !== null) {
      console.log("❌ Bot Desconectado");
    }
    lastKnownConnected = isConnected;
  }

  return { waState: normalizedWaState, wid, isConnected };
}

client.on("qr", (qr) => {
  lastQr = qr;
  lastQrAt = new Date().toISOString();
  botState = "qr";
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

  refreshConnectionSnapshot("qr").catch(() => {});
});

client.on("ready", () => {
  refreshConnectionSnapshot("ready").catch(() => {});
});

client.on("authenticated", () => {
  botState = "authenticated";
  lastQr = null;
  console.log("🔐 WhatsApp autenticado correctamente.");
  refreshConnectionSnapshot("authenticated").catch(() => {});
});

client.on("loading_screen", () => {
  botState = "loading";
  console.log("⏳ Estado WhatsApp: loading");
  refreshConnectionSnapshot("loading_screen").catch(() => {});
});

client.on("change_state", async (state) => {
  if (state) {
    botState = String(state).toLowerCase();
    console.log(`🔄 Estado WhatsApp cambiado a: ${botState}`);
  }
  await refreshConnectionSnapshot("change_state");
});

client.on("disconnected", async (reason) => {
  botState = "disconnected";
  console.log(`⚠️ Evento disconnected. reason=${reason || "unknown"}`);
  await refreshConnectionSnapshot("disconnected");
});

client.on("auth_failure", () => {
  botState = "auth_failure";
  refreshConnectionSnapshot("auth_failure").catch(() => {});
});

async function handleIncomingMessage(message, source = "message") {
  try {
    const msgId = message?.id?._serialized || `${source}-${Date.now()}`;
    if (processedMessageIds.has(msgId)) return;
    processedMessageIds.add(msgId);
    if (processedMessageIds.size > 2000) processedMessageIds.clear();

    const preview =
      typeof message.body === "string" ? message.body.slice(0, 60) : "<sin-texto>";
    console.log(
      `🧪 ${source} fromMe=${Boolean(message.fromMe)} from=${message.from} type=${message.type} body="${preview}"`,
    );

    if (message.from === "status@broadcast") return;
    if (message.fromMe) {
      console.log("↩️ Mensaje propio detectado (fromMe=true). No se responde para evitar loops.");
      return;
    }
    lastInboundMessageAt = new Date().toISOString();
    console.log(`📩 Mensaje entrante desde ${message.from} (${message.type})`);

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
      lastOutboundMessageAt = new Date().toISOString();
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
      lastOutboundMessageAt = new Date().toISOString();
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
    lastOutboundMessageAt = new Date().toISOString();

    pausados.add(numeroClienteLimpio);
    delete esperandoNombre[chatId];
    return;
  }

  // --- PROCESAR MENSAJE (AGRUPADO POR TIEMPO) ---
  let mensajeUsuario = message.body;
  if (
    message.hasMedia &&
    (message.type === "audio" || message.type === "ptt")
  ) {
    const media = await message.downloadMedia();
    mensajeUsuario = await transcribirAudio(media);
  }
  if (!mensajeUsuario) return;
  encolarMensajeEntrante(chatId, numeroClienteLimpio, mensajeUsuario, message);
  } catch (error) {
    console.error("❌ Error procesando mensaje entrante:", error?.message || error);
  }
}

function encolarMensajeEntrante(chatId, numeroClienteLimpio, mensajeUsuario, messageRef) {
  const existente = inboundMessageBuffer.get(chatId) || {
    numeroClienteLimpio,
    messages: [],
    timer: null,
    processing: false,
    lastMessageRef: null,
  };

  existente.numeroClienteLimpio = numeroClienteLimpio;
  existente.messages.push(mensajeUsuario);
  existente.lastMessageRef = messageRef;

  if (existente.timer) clearTimeout(existente.timer);
  existente.timer = setTimeout(
    () => procesarBufferEntrante(chatId),
    TIEMPO_AGRUPACION_SEGURO_MS,
  );

  inboundMessageBuffer.set(chatId, existente);
}

async function procesarBufferEntrante(chatId) {
  const buffer = inboundMessageBuffer.get(chatId);
  if (!buffer) return;

  if (buffer.processing) {
    buffer.timer = setTimeout(
      () => procesarBufferEntrante(chatId),
      TIEMPO_AGRUPACION_SEGURO_MS,
    );
    return;
  }

  if (buffer.messages.length === 0) {
    inboundMessageBuffer.delete(chatId);
    return;
  }

  const numeroClienteLimpio = buffer.numeroClienteLimpio;
  const messageRef = buffer.lastMessageRef;
  const mensajeUsuario = buffer.messages.join("\n");
  buffer.messages = [];
  buffer.timer = null;
  buffer.processing = true;

  try {
    await procesarMensajeAgrupado(
      chatId,
      numeroClienteLimpio,
      mensajeUsuario,
      messageRef,
    );
  } finally {
    buffer.processing = false;

    if (buffer.messages.length > 0) {
      buffer.timer = setTimeout(
        () => procesarBufferEntrante(chatId),
        TIEMPO_AGRUPACION_SEGURO_MS,
      );
      return;
    }

    inboundMessageBuffer.delete(chatId);
  }
}

async function procesarMensajeAgrupado(
  chatId,
  numeroClienteLimpio,
  mensajeUsuario,
  messageRef,
) {
  if (pausados.has(numeroClienteLimpio)) return;

  registrarHechosUsuario(chatId, mensajeUsuario);
  const respuestaDeterministica = resolverReglaDeterministica(chatId, mensajeUsuario);

  if (!historiales[chatId]) historiales[chatId] = [];
  historiales[chatId].push({ role: "user", content: mensajeUsuario });

  if (respuestaDeterministica) {
    historiales[chatId].push({ role: "assistant", content: respuestaDeterministica });
    await client.sendMessage(chatId, respuestaDeterministica, { sendSeen: false });
    lastOutboundMessageAt = new Date().toISOString();
    return;
  }

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
      messageRef,
    );
    return;
  }

  try {
    const chat = await messageRef.getChat();
    await chat.sendStateTyping();

    const contextoDinamico = construirContextoDinamico(chatId);
    let botResponse = await getChatResponse(historiales[chatId], {
      dynamicContext: contextoDinamico,
    });

    if (
      botResponse.includes("[TRANSFERIR_HUMANO]") ||
      botResponse.includes("[TRANSFERIR_VENTA]")
    ) {
      await iniciarTransferencia(
        chatId,
        numeroClienteLimpio,
        "IA detectó cierre de venta",
        "cierre_venta",
        messageRef,
      );
      return;
    }

    if (botResponse.includes("[TRANSFERIR_ADMIN]")) {
      await iniciarTransferencia(
        chatId,
        numeroClienteLimpio,
        "IA detectó consulta deuda/admin",
        "consulta_admin",
        messageRef,
      );
      return;
    }

    historiales[chatId].push({ role: "assistant", content: botResponse });
    await client.sendMessage(chatId, botResponse, { sendSeen: false });
    lastOutboundMessageAt = new Date().toISOString();
    await chat.clearState();
  } catch (e) {
    console.log("Error IA o Envío");
    console.error(e.message);
  }
}

client.on("message", async (message) => {
  await handleIncomingMessage(message, "message");
});

client.on("message_create", async (message) => {
  await handleIncomingMessage(message, "message_create");
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
  lastOutboundMessageAt = new Date().toISOString();
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
      lastOutboundMessageAt = new Date().toISOString();
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

    // Si quedan mensajes, esperamos entre 300  y 600 segundos (promedio 450s)
    if (messageQueue.length > 0) {
      const delay = Math.floor(Math.random() * (600000 - 300000 + 1)) + 300000;
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
const corsOrigin = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const corsConfig = {
  origin: corsOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
};

app.use(cors(corsConfig));
app.use(express.json());
app.use("/api/schedule-overrides", scheduleOverridesRoutes);

async function getStatusPayload() {
  const snapshot = await refreshConnectionSnapshot("status_api");
  const normalizedWaState = snapshot.waState;
  const isReadyByState = ["connected", "open", "ready"].includes(normalizedWaState);
  const isReadyByLifecycle = ["ready", "connected", "open"].includes(botState);
  const isReady = snapshot.isConnected || isReadyByState || isReadyByLifecycle;

  if (isReady) {
    lastQr = null;
  }

  return {
    state: normalizedWaState || botState,
    internalState: botState,
    isReady,
    hasQr: Boolean(lastQr),
    qr: lastQr,
    lastQrAt,
    wid: snapshot.wid,
    waState: normalizedWaState,
    lastInboundMessageAt,
    lastOutboundMessageAt,
    queueLength: messageQueue.length,
    authDataPath,
  };
}

async function startWhatsappClient() {
  botState = "starting";
  await client.initialize();
}

async function stopWhatsappClient() {
  botState = "stopping";
  await client.destroy();
  botState = "stopped";
  lastQr = null;
}

app.get("/api/admin/whatsapp/status", requireAdminApiKey, async (_req, res) => {
  return res.status(200).json({
    success: true,
    data: await getStatusPayload(),
  });
});

app.post("/api/admin/whatsapp/start", requireAdminApiKey, async (_req, res) => {
  if (lifecycleActionInProgress) {
    return res.status(409).json({ success: false, error: "Hay una acción en progreso." });
  }

  if (botState === "ready" || botState === "qr" || botState === "loading") {
    return res.status(200).json({
      success: true,
      message: "El bot ya está activo.",
      data: await getStatusPayload(),
    });
  }

  lifecycleActionInProgress = true;
  try {
    await startWhatsappClient();
    return res.status(200).json({
      success: true,
      message: "Inicio solicitado.",
      data: await getStatusPayload(),
    });
  } catch (error) {
    botState = "error";
    return res.status(500).json({
      success: false,
      error: error.message || "No se pudo iniciar el bot.",
    });
  } finally {
    lifecycleActionInProgress = false;
  }
});

app.post("/api/admin/whatsapp/stop", requireAdminApiKey, async (_req, res) => {
  if (lifecycleActionInProgress) {
    return res.status(409).json({ success: false, error: "Hay una acción en progreso." });
  }

  lifecycleActionInProgress = true;
  try {
    await stopWhatsappClient();
    return res.status(200).json({
      success: true,
      message: "Bot detenido.",
      data: await getStatusPayload(),
    });
  } catch (error) {
    botState = "error";
    return res.status(500).json({
      success: false,
      error: error.message || "No se pudo detener el bot.",
    });
  } finally {
    lifecycleActionInProgress = false;
  }
});

app.post("/api/admin/whatsapp/restart", requireAdminApiKey, async (_req, res) => {
  if (lifecycleActionInProgress) {
    return res.status(409).json({ success: false, error: "Hay una acción en progreso." });
  }

  lifecycleActionInProgress = true;
  try {
    try {
      await stopWhatsappClient();
    } catch (_error) {
      // Si ya estaba detenido, continuamos.
    }
    await startWhatsappClient();
    return res.status(200).json({
      success: true,
      message: "Bot reiniciado.",
      data: await getStatusPayload(),
    });
  } catch (error) {
    botState = "error";
    return res.status(500).json({
      success: false,
      error: error.message || "No se pudo reiniciar el bot.",
    });
  } finally {
    lifecycleActionInProgress = false;
  }
});

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
  console.log(`API corriendo... (WA Web: ${webVersionRemotePath})`),
);

startWhatsappClient().catch((error) => {
  botState = "error";
  console.error("❌ Error iniciando WhatsApp:", error.message);
});
