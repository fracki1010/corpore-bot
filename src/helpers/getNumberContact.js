async function getNumberContact(message) {
    
    try {
        const contact = await message.getContact();

        return contact.id.user

    } catch (error) {
        console.error(error);
        
    }

}

module.exports = { getNumberContact };