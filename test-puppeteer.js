const puppeteer = require('puppeteer');

(async () => {
  console.log('Lanzando navegador...');
  try {
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_BIN || undefined,
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('Navegador lanzado con éxito. Cerrando...');
    await browser.close();
  } catch (error) {
    console.error('Error lanzando puppeteer:', error);
  }
})();
