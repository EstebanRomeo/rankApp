require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const compression = require('compression');
const xss        = require('xss-clean');
const rateLimit  = require('express-rate-limit');
const NodeCache  = require('node-cache');

const authRoutes    = require('./routes/auth');
const baresRoutes   = require('./routes/bares');
const mozosRoutes   = require('./routes/mozos');
const resenasRoutes = require('./routes/resenas');
const alertasRoutes = require('./routes/alertas');
const metricsRoutes = require('./routes/metrics');

const app   = express();
const PORT  = process.env.PORT || 3001;

// ── Cache en memoria ──────────────────────────────────────────────────────────
const cache = new NodeCache({ stdTTL: 60, checkperiod: 90 });

function cacheMiddleware(ttl = 60) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = req.originalUrl;
    const hit  = cache.get(key);
    if (hit) { res.setHeader('X-Cache', 'HIT'); return res.json(hit); }
    const orig = res.json.bind(res);
    res.json = (data) => { cache.set(key, data, ttl); res.setHeader('X-Cache', 'MISS'); return orig(data); };
    next();
  };
}



// ── Rate limiters ─────────────────────────────────────────────────────────────
const limiterGeneral = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intentá en unos minutos.' },
});
const limiterAuth = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Demasiados intentos. Esperá 15 minutos.' },
});
const limiterResenas = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  message: { error: 'Demasiadas reseñas en poco tiempo.' },
});

// ── Seguridad ─────────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(compression());
app.use(xss());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


// ── Envio de mails ─────────────────────────────────────────────────────────────
const demoRoutes = require('./routes/demo');
app.use('/api/demo', demoRoutes);

// ── Rate limiting por ruta ────────────────────────────────────────────────────
app.use('/api/',        limiterGeneral);
app.use('/api/auth',    limiterAuth);
app.use('/api/resenas', limiterResenas);

// ── Rutas con cache en endpoints públicos pesados ─────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/bares',   cacheMiddleware(60),  baresRoutes);
app.use('/api/mozos',   cacheMiddleware(30),  mozosRoutes);
app.use('/api/resenas', resenasRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/metrics', cacheMiddleware(120), metricsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` });
});
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`\n🍺 Mozos API corriendo en http://localhost:${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   ✓ Seguridad, rate limiting y cache activos\n`);
});
