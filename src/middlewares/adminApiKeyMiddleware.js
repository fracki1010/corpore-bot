function requireAdminApiKey(req, res, next) {
  const expectedKey = process.env.ADMIN_API_KEY;

  // Si no está configurada la key, no bloqueamos el endpoint.
  if (!expectedKey) {
    return next();
  }

  const providedKey = req.header("x-admin-key");
  if (providedKey !== expectedKey) {
    return res.status(403).json({
      success: false,
      error: "No autorizado.",
    });
  }

  return next();
}

module.exports = { requireAdminApiKey };
