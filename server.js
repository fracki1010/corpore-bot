require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`--- Servidor corriendo ---`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🤖 Modelo Groq listo para recibir mensajes`);
});