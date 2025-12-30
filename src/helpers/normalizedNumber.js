/**
 * Extrae el número real y lo normaliza a 549...
 * @param {object|string} input - El mensaje de WA o un string manual
 */
async function normalizeNumber(input) {
    let rawNumber = '';

    // CASO 1: Es el objeto Mensaje de WhatsApp
    if (typeof input === 'object' && input.from) {
        try {
            // Intentamos obtener el contacto vinculado al mensaje
            const contact = await input.getContact();
            // contact.number siempre devuelve el número de teléfono puro (sin @c.us / @lid)
            rawNumber = contact.number; 
        } catch (error) {
            // Si falla getContact, usamos el ID del mensaje como plan B
            rawNumber = input.from.split('@')[0];
        }
    } else {
        // CASO 2: Es un string (ej: lo que escribe el admin en !off)
        rawNumber = String(input);
    }

    // Limpieza de caracteres no numéricos
    let clean = rawNumber.replace(/\D/g, '');

    // --- LÓGICA DE NORMALIZACIÓN ARGENTINA ---
    if (clean.startsWith('0')) clean = clean.slice(1);
    if (clean.startsWith('15')) clean = clean.slice(2);

    // Estandarizar a 549
    if (clean.startsWith('549')) return clean;
    if (clean.startsWith('54') && clean.charAt(2) !== '9') return '549' + clean.slice(2);
    if (!clean.startsWith('54')) return '549' + clean;

    return clean;
}

module.exports = { normalizeNumber };