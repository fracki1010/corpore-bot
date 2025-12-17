require('dotenv').config();
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function transcribirAudio(media) {
    try {
        // 1. Convertir el base64 de WhatsApp a un Buffer
        const buffer = Buffer.from(media.data, 'base64');

        // 2. Crear un nombre de archivo temporal
        // WhatsApp usa OGG, pero para asegurarnos que Groq lo lea bien, lo guardamos temporalmente
        const tempFilePath = path.join('/tmp', `audio_${Date.now()}.ogg`);

        // 3. Escribir el archivo en el disco
        fs.writeFileSync(tempFilePath, buffer);

        // 4. Enviar a Groq (Modelo Whisper)
        const translationCompletion = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-large-v3",
            language: "es", // Forzamos español para mejor precisión
            response_format: "json",
        });

        // 5. Borrar el archivo temporal (Limpieza)
        fs.unlinkSync(tempFilePath);

        // 6. Devolver el texto
        return translationCompletion.text;

    } catch (error) {
        console.error("❌ Error transcribiendo audio:", error);
        return null;
    }
}

module.exports = { transcribirAudio };