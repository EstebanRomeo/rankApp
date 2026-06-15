// ─────────────────────────────────────────────────────────────────────────────
// security.js — importar y aplicar en tu server.js/app.js principal
// npm install helmet express-rate-limit compression node-cache xss-clean
// ─────────────────────────────────────────────────────────────────────────────
const helmet      = require('helmet');
const compression = require('compression');
const NodeCache   = require('node-cache');
const xss         = require('xss-clean');
const { limiterGeneral, limiterAuth, limiterResenas } = require('./rateLimit');

// ── Cache en memoria (TTL en segundos) ────────────────────────────────────────
const cache = new NodeCache({ stdTTL: 60, checkperiod: 90 });

// Middleware de cache para rutas GET públicas
function cacheMiddleware(ttl = 60) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = req.originalUrl;
    const hit = cache.get(key);
    if (hit) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(hit);
    }
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      cache.set(key, data, ttl);
      res.setHeader('X-Cache', 'MISS');
      return originalJson(data);
    };
    next();
  };
}

// ── Función para aplicar todo en tu app Express ───────────────────────────────
function applySecurityMiddleware(app) {

  // 1. Helmet — headers de seguridad HTTP
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // desactivar si tenés frontend separado
  }));

  // 2. Comprimir respuestas (gzip) — reduce el tamaño hasta un 70%
  app.use(compression());

  // 3. Sanitizar inputs XSS — limpia scripts maliciosos en req.body
  app.use(xss());

  // 4. Rate limiting general
  app.use('/api/', limiterGeneral);

  // 5. Rate limiting estricto para auth
  app.use('/api/auth/', limiterAuth);

  // 6. Rate limiting para reseñas
  app.use('/api/resenas', limiterResenas);

  // 7. Headers adicionales de seguridad
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // 8. Validar Content-Type en POST/PUT — evitar payloads malformados
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const ct = req.headers['content-type'] || '';
      if (!ct.includes('application/json') && !ct.includes('multipart/form-data')) {
        return res.status(415).json({ error: 'Content-Type no soportado' });
      }
    }
    next();
  });

  // 9. Limitar tamaño del body — evitar ataques de payload gigante
  // Ya está en express.json({ limit: '10mb' }) — si no, agregar:
  // app.use(express.json({ limit: '5mb' }));

  console.log('✓ Seguridad, compresión y rate limiting activos');
}

module.exports = { applySecurityMiddleware, cacheMiddleware, cache };
