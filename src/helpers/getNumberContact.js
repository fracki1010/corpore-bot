async function getNumberContact(input) {
    let num = "";

    // Si es el objeto mensaje, extraemos el ID del emisor
    if (typeof input === 'object' && input.from) {
        num = input.from.replace(/\D/g, '');
    } else {
        // Si es texto manual (del comando !off)
        num = String(input).replace(/\D/g, '');
    }

    // Normalización Argentina
    // 1. Quitar 54 si ya lo tiene para estandarizar la base
    if (num.startsWith('54')) num = num.slice(2);
    // 2. Quitar el 9 si lo tiene (ej: 9261...)
    if (num.startsWith('9')) num = num.slice(1);
    // 3. Quitar el 15 si lo tiene
    if (num.startsWith('15')) num = num.slice(2);
    // 4. Quitar el 0 inicial
    if (num.startsWith('0')) num = num.slice(1);

    // Al final, devolvemos SIEMPRE: 549 + el número limpio de 10 dígitos
    // Esto garantiza que no importa cómo entre, termine igual.
    return '549' + num;
}

module.exports = { getNumberContact };