const express = require('express');
const cors = require('cors');
const chatRoutes = require('./routes/chatRoutes');

const app = express();

// Middlewares
app.use(cors());              // Permite conexiones desde otros dominios
app.use(express.json());      // IMPORTANTE: Permite leer JSON en el body

// Rutas
// La ruta final será: http://localhost:3000/api/chat
app.use('/api/chat', chatRoutes);

// Ruta básica de prueba para ver si el servidor vive
app.get('/', (req, res) => {
  res.send('¡El servidor del Chatbot Groq está funcionando! 🚀');
});

module.exports = app;