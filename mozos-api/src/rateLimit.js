const rateLimit = require('express-rate-limit');

// Límite general para todas las rutas
const limiterGeneral = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intentá en unos minutos.' },
});

// Límite estricto para auth (login/register)
const limiterAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de autenticación. Esperá 15 minutos.' },
});

// Límite para crear reseñas
const limiterResenas = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20,
  message: { error: 'Demasiadas reseñas en poco tiempo.' },
});

module.exports = { limiterGeneral, limiterAuth, limiterResenas };
