require('dotenv').config(); // Cargar variables de entorno
const Groq = require('groq-sdk');

// Verificamos que la API KEY exista para evitar errores silenciosos
if (!process.env.GROQ_API_KEY) {
  console.error("ERROR: No se encontró la GROQ_API_KEY en el archivo .env");
  process.exit(1);
}

// Inicializamos el cliente
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

module.exports = groq;