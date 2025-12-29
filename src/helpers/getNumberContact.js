
export const getNumberContact = async (message) => {
    let numeroRealDelCliente = "";
    try {
        const contact = await message.getContact();
        numeroRealDelCliente = contact.number;
    } catch (err) {
        numeroRealDelCliente = message.from.replace(/[^0-9]/g, '');
    }
    return numeroRealDelCliente;
}