require('dotenv').config();
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

    // 2. Preparamos el mensaje de sistema (las instrucciones)
    const systemMessage = {
        role: "system",
        content: contextoNegocio
    };

    // 3. Unimos: Instrucciones + Historial de la charla
    // El historial ya viene con el formato [{role: 'user', content: '...'}, ...]
    const messagesToSend = [systemMessage, ...historialDeChat];

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