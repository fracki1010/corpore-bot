const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const getChatResponse = async (message) => {
  try {
    // 1. Leemos el archivo de texto en tiempo real
    // 'process.cwd()' busca el archivo en la raiz donde corres el comando node
    const infoPath = path.join(process.cwd(), 'business_info.txt');
    
    let contextoNegocio = "";
    
    try {
        contextoNegocio = fs.readFileSync(infoPath, 'utf8');
    } catch (err) {
        console.error("Error leyendo business_info.txt:", err);
        contextoNegocio = "Eres un asistente útil."; // Fallback por si falla el archivo
    }

    // 2. Enviamos el contenido del archivo como instrucción de sistema
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: contextoNegocio // Aquí va lo que leíste del txt
        },
        {
          role: "user",
          content: message,
        },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
      max_tokens: 300,
    });

    return chatCompletion.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("Error en Groq Service:", error);
    // Si falla Groq, devolvemos un mensaje genérico para que WhatsApp no se quede mudo
    return "Lo siento, estoy procesando muchas consultas. Intenta en un momento.";
  }
};

module.exports = { getChatResponse };