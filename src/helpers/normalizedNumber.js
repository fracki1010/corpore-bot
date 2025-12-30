/**
 * Extrae y normaliza el número a formato 549XXXXXXXXXX
 * @param {string|object} input - Puede ser el objeto message o un string (número)
 */
const normalizeNumber = (input) => {
    let rawNumber = input;

    // Limpieza básica: dejar solo números
    let clean = rawNumber.replace(/\D/g, '');

    // --- LÓGICA DE NORMALIZACIÓN ARGENTINA (549) ---

    // 1. Quitamos el '0' inicial si existe (ej: 0261 -> 261)
    if (clean.startsWith('0')) clean = clean.slice(1);

    // 2. Quitamos el '15' inicial si existe (ej: 155... -> 5...)
    if (clean.startsWith('15')) clean = clean.slice(2);

    // 3. Si ya tiene el 549 al principio, está perfecto.
    if (clean.startsWith('549')) {
        return clean;
    }

    // 4. Si tiene 54 pero le falta el 9 (ej: 54261...)
    if (clean.startsWith('54') && clean.charAt(2) !== '9') {
        return '549' + clean.slice(2);
    }

    // 5. Si no tiene ni 54 (es un numero local, ej: 261...), le agregamos 549
    if (!clean.startsWith('54')) {
        return '549' + clean;
    }

    return clean;
};

module.exports = { normalizeNumber };