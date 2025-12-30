
const normalizeNumber = async (message) => {

    try {
        
        // 1. Obtenemos el contacto (ahora funcionará tras la actualización)
        const contact = await message.getContact(); 

       console.log("user",contact.id.user);

       return contact.id.user

    } catch (error) {
        console.error(error);
    }
};

module.exports = { normalizeNumber };