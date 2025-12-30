/**
 * Normaliza el número de contacto para que siempre sea 549...
 * @param {object} message - El objeto mensaje de whatsapp-web.js
 */
async function getNumberContact(message) {
    let contactNumber = "";
    try {
        const contact = await message.getContact();
        contactNumber = contact.number; // Esto suele devolver "549261..."
    } catch (err) {
        contactNumber = message.from.replace(/\D/g, '');
    }

    // Normalización para Argentina:
    // Si el número empieza con 54 y no tiene el 9 (ej. 54261...), lo insertamos.
    if (contactNumber.startsWith('54') && contactNumber.charAt(2) !== '9') {
        contactNumber = '549' + contactNumber.slice(2);
    }

    return contactNumber.replace(/\D/g, ''); 
}

module.exports = { getNumberContact };