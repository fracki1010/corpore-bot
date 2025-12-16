const groqService = require('../services/groqService');

const chat = async (req, res) => {
  try {
    const { message } = req.body;

    // 1. Validar que el usuario envió un mensaje
    if (!message) {
      return res.status(400).json({ error: 'El campo "message" es obligatorio.' });
    }

    // 2. Llamar al servicio de IA
    const botResponse = await groqService.getChatResponse(message);

    // 3. Devolver la respuesta en formato JSON
    return res.status(200).json({
      success: true,
      data: botResponse,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Hubo un problema procesando tu solicitud.'
    });
  }
};

module.exports = { chat };