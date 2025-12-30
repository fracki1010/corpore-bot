async function getNumberContact(input) {
    let num = "";

    // Extraer solo números
    if (typeof input === 'object' && input.from) {
        num = input.from.replace(/\D/g, '');
    } else {
        num = String(input).replace(/\D/g, '');
    }

    // SI EL ID ES MUY LARGO (Caso LID de tus logs)
    // No le aplicamos filtros de Argentina, lo dejamos como viene.
    if (num.length > 13) {
        return num; 
    }

    // SI ES UN NÚMERO ESTÁNDAR (Argentina u otros)
    // Limpieza básica
    if (num.startsWith('0')) num = num.slice(1);
    if (num.startsWith('15')) num = num.slice(2);

    // Estandarizar a 549 si es un número de 10 dígitos (Arg)
    if (num.length === 10 && !num.startsWith('54')) {
        num = '549' + num;
    }
    
    // Si tiene 54 pero no el 9
    if (num.startsWith('54') && num.length === 12) {
        num = '549' + num.slice(2);
    }

    return num;
}

module.exports = { getNumberContact };