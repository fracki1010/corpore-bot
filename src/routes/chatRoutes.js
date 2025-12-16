const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

// Definimos la ruta POST /
// Cuando alguien acceda aquí, se ejecuta chatController.chat
router.post('/', chatController.chat);

module.exports = router;