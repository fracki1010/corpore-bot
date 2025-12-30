/**
 * Extrae el número real y lo normaliza a 549...
 * @param {object|string} message - El mensaje de WA o un string manual
 */

async function normalizeNumber(message) {

   let numeroReal;
    try {
        // 1. Intentamos obtener el objeto de contacto
        const contacto = await message.getContact();

        // 2. Si existe, obtenemos el número con formato (+54 9 ...)
        numeroReal = await contacto.getFormattedNumber();

    } catch (error) {
        // 3. Si algo falla (ej: es un grupo o error de conexión), 
        // usamos el ID del mensaje limpiando los caracteres no numéricos
        numeroReal = message.from.replace(/[^0-9]/g, '');
    }

    return numeroReal;
}

module.exports = { normalizeNumber };