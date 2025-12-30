async function obtenerIdDeNumero(numero, client) {
    try {
        
        // El número debe ser string y sin el símbolo '+' (ej: '549261...')
        const idObj = await client.getNumberId(numero);

        if (idObj) {
            return idObj._serialized; // Retorna ej: "549261123456@c.us"
        } else {
            console.log("Este número no tiene WhatsApp registrado.");
            return null;
        }
    } catch (error) {
        console.error("Error buscando ID:", error);
        return null;
    }
}

module.exports = { obtenerIdDeNumero };