require('dotenv').config();
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");
const { buildScheduleContextForAssistant } = require("./openingExceptionsService");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const BUSINESS_TIMEZONE = "America/Argentina/Buenos_Aires";

const WEEKDAY_INDEX = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

function getZonedDateParts(timeZone = BUSINESS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: weekdayMap[map.weekday],
  };
}

function addDaysUTC(baseDate, days) {
  const next = new Date(baseDate);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIsoDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function resolveNextWeekdayIso(dayName, timeZone = BUSINESS_TIMEZONE) {
  const target = WEEKDAY_INDEX[dayName.toLowerCase()];
  if (target === undefined) return null;

  const now = getZonedDateParts(timeZone);
  const baseUTC = new Date(Date.UTC(now.year, now.month - 1, now.day));

  // "jueves que viene" => jueves de la semana siguiente (no el inmediato de esta semana).
  let delta = target - now.weekday;
  if (delta <= 0) delta += 7;
  delta += 7;

  return toIsoDateUTC(addDaysUTC(baseUTC, delta));
}

function resolveThisWeekdayIso(dayName, timeZone = BUSINESS_TIMEZONE) {
  const target = WEEKDAY_INDEX[dayName.toLowerCase()];
  if (target === undefined) return null;

  const now = getZonedDateParts(timeZone);
  const baseUTC = new Date(Date.UTC(now.year, now.month - 1, now.day));

  // "este jueves" => jueves de esta semana; si ya pasó, próximo jueves calendario.
  let delta = target - now.weekday;
  if (delta < 0) delta += 7;

  return toIsoDateUTC(addDaysUTC(baseUTC, delta));
}

function resolveOffsetIso(days, timeZone = BUSINESS_TIMEZONE) {
  const now = getZonedDateParts(timeZone);
  const baseUTC = new Date(Date.UTC(now.year, now.month - 1, now.day));
  return toIsoDateUTC(addDaysUTC(baseUTC, days));
}

function getWeekRangeIso({ nextWeek = false } = {}, timeZone = BUSINESS_TIMEZONE) {
  const now = getZonedDateParts(timeZone);
  const baseUTC = new Date(Date.UTC(now.year, now.month - 1, now.day));
  const daysSinceMonday = (now.weekday + 6) % 7; // lunes=0 ... domingo=6
  let mondayOffset = -daysSinceMonday;
  if (nextWeek) mondayOffset += 7;
  const monday = addDaysUTC(baseUTC, mondayOffset);
  const sunday = addDaysUTC(monday, 6);
  return {
    from: toIsoDateUTC(monday),
    to: toIsoDateUTC(sunday),
  };
}

function detectRelativeDateHints(text) {
  const hints = [];
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

  const dayPattern = "(lunes|martes|miercoles|jueves|viernes|sabado|domingo)";

  const nextDayRegex = new RegExp(`\\b${dayPattern}\\s+que\\s+viene\\b`, "i");
  const thisDayRegex = new RegExp(`\\beste\\s+${dayPattern}\\b`, "i");

  const nextDayMatch = normalized.match(nextDayRegex);
  if (nextDayMatch) {
    const day = nextDayMatch[1];
    const iso = resolveNextWeekdayIso(day);
    if (iso) {
      hints.push(
        `"${nextDayMatch[0]}" corresponde a ${iso} (${BUSINESS_TIMEZONE}).`,
      );
    }
  }

  const thisDayMatch = normalized.match(thisDayRegex);
  if (thisDayMatch) {
    const day = thisDayMatch[1];
    const iso = resolveThisWeekdayIso(day);
    if (iso) {
      hints.push(
        `"${thisDayMatch[0]}" corresponde a ${iso} (${BUSINESS_TIMEZONE}).`,
      );
    }
  }

  if (/\bpasado\s+manana\b/i.test(normalized)) {
    hints.push(`"pasado mañana" corresponde a ${resolveOffsetIso(2)} (${BUSINESS_TIMEZONE}).`);
  } else if (/\bmanana\b/i.test(normalized)) {
    hints.push(`"mañana" corresponde a ${resolveOffsetIso(1)} (${BUSINESS_TIMEZONE}).`);
  }

  if (/\bhoy\b/i.test(normalized)) {
    hints.push(`"hoy" corresponde a ${resolveOffsetIso(0)} (${BUSINESS_TIMEZONE}).`);
  }

  if (/\b(la\s+)?(proxima|pr[oó]xima)\s+semana\b/i.test(normalized) || /\bla\s+semana\s+que\s+viene\b/i.test(normalized)) {
    const range = getWeekRangeIso({ nextWeek: true });
    hints.push(
      `"la semana que viene" corresponde al rango ${range.from} a ${range.to} (${BUSINESS_TIMEZONE}).`,
    );
  } else if (/\besta\s+semana\b/i.test(normalized)) {
    const range = getWeekRangeIso({ nextWeek: false });
    hints.push(
      `"esta semana" corresponde al rango ${range.from} a ${range.to} (${BUSINESS_TIMEZONE}).`,
    );
  }

  return hints;
}

function enrichRelativeDateHints(historialDeChat) {
  if (!Array.isArray(historialDeChat) || historialDeChat.length === 0) {
    return historialDeChat;
  }

  const enriched = [...historialDeChat];
  const lastIndex = enriched.length - 1;
  const lastMessage = enriched[lastIndex];

  if (!lastMessage || lastMessage.role !== "user" || typeof lastMessage.content !== "string") {
    return historialDeChat;
  }

  const text = lastMessage.content;
  const hints = detectRelativeDateHints(text);
  if (hints.length === 0) return historialDeChat;

  const hintBlock = hints.map((line) => `- ${line}`).join("\n");

  enriched[lastIndex] = {
    ...lastMessage,
    content: `${text}\n\n[ACLARACION FECHAS RELATIVAS]\n${hintBlock}\nUsa estas fechas exactas para responder.`,
  };

  return enriched;
}

// Recibimos un ARRAY de mensajes (el historial), no solo un texto
const getChatResponse = async (historialDeChat) => {
  try {
    // 1. Leemos la info del negocio
    const infoPath = path.join(process.cwd(), 'business_info.txt');
    let contextoNegocio = "";
    try {
        contextoNegocio = fs.readFileSync(infoPath, 'utf8');
    } catch (err) {
        contextoNegocio = "Eres un asistente útil.";
    }

    const specialScheduleContext = buildScheduleContextForAssistant();

    // 2. Preparamos el mensaje de sistema (las instrucciones)
    const systemMessage = {
        role: "system",
        content: `${contextoNegocio}\n\n${specialScheduleContext}`
    };

    // 3. Unimos: Instrucciones + Historial de la charla
    // El historial ya viene con el formato [{role: 'user', content: '...'}, ...]
    const enrichedHistory = enrichRelativeDateHints(historialDeChat);
    const messagesToSend = [systemMessage, ...enrichedHistory];

    // 4. Enviamos todo a Groq
    const chatCompletion = await groq.chat.completions.create({
      messages: messagesToSend,
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
      max_tokens: 300,
    });

    return chatCompletion.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("Error en Groq Service:", error);
    return "Lo siento, tuve un pequeño lapso de memoria. ¿Podrías repetirme la pregunta?";
  }
};

module.exports = { getChatResponse };
