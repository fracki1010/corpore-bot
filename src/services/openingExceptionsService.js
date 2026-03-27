const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(process.cwd(), "opening_exceptions.json");
const BUSINESS_TIMEZONE = "America/Argentina/Buenos_Aires";

function getCurrentDateInTimezone(timeZone = BUSINESS_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isValidIsoDate(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return false;
  }
  const date = new Date(`${dateString}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateString;
}

function ensureDataShape(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.exceptions)) {
    return { exceptions: [] };
  }
  return raw;
}

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { exceptions: [] };
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return ensureDataShape(parsed);
  } catch (_error) {
    return { exceptions: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function listExceptions() {
  const data = readData();
  return data.exceptions.sort((a, b) => a.date.localeCompare(b.date));
}

function upsertException({ date, isOpen, reason }) {
  if (!isValidIsoDate(date)) {
    throw new Error("VALIDATION: date debe tener formato YYYY-MM-DD.");
  }
  if (typeof isOpen !== "boolean") {
    throw new Error("VALIDATION: isOpen debe ser boolean.");
  }

  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  const data = readData();
  const index = data.exceptions.findIndex((item) => item.date === date);
  const payload = {
    date,
    isOpen,
    reason: normalizedReason,
    updatedAt: new Date().toISOString(),
  };

  let created = false;
  if (index >= 0) {
    data.exceptions[index] = payload;
  } else {
    data.exceptions.push(payload);
    created = true;
  }

  data.exceptions.sort((a, b) => a.date.localeCompare(b.date));
  writeData(data);

  return { created, item: payload };
}

function deleteException(date) {
  if (!isValidIsoDate(date)) {
    throw new Error("VALIDATION: date debe tener formato YYYY-MM-DD.");
  }

  const data = readData();
  const next = data.exceptions.filter((item) => item.date !== date);
  const removed = next.length !== data.exceptions.length;

  if (removed) {
    data.exceptions = next;
    writeData(data);
  }

  return removed;
}

function buildScheduleContextForAssistant() {
  const today = getCurrentDateInTimezone();
  const exceptions = listExceptions();

  if (exceptions.length === 0) {
    return [
      "REGLAS DE APERTURA ESPECIALES (ALTA PRIORIDAD):",
      `- Fecha actual de referencia: ${today} (${BUSINESS_TIMEZONE}).`,
      "- No hay excepciones cargadas. Usa solo los horarios base del negocio.",
    ].join("\n");
  }

  const lines = exceptions.map((item) => {
    const status = item.isOpen ? "ABIERTO" : "CERRADO";
    const reasonSuffix = item.reason ? ` Motivo: ${item.reason}.` : "";
    return `- ${item.date}: ${status}.${reasonSuffix}`;
  });

  return [
    "REGLAS DE APERTURA ESPECIALES (ALTA PRIORIDAD):",
    `- Fecha actual de referencia: ${today} (${BUSINESS_TIMEZONE}).`,
    "- Si una fecha aparece aquí, esta regla tiene prioridad sobre horarios generales.",
    ...lines,
  ].join("\n");
}

module.exports = {
  DATA_FILE,
  listExceptions,
  upsertException,
  deleteException,
  buildScheduleContextForAssistant,
};
