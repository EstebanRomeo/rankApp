require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes    = require('./routes/auth');
const baresRoutes   = require('./routes/bares');
const mozosRoutes   = require('./routes/mozos');
const resenasRoutes = require('./routes/resenas');
const alertasRoutes = require('./routes/alertas');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middlewares globales ─────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json());

// ─── Rutas ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/bares',   baresRoutes);
app.use('/api/mozos',   mozosRoutes);
app.use('/api/resenas', resenasRoutes);
app.use('/api/alertas', alertasRoutes);

// Health check — para verificar que el servidor está levantado
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` });
});

// ─── Error handler global ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── Iniciar ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🍺 Mozos API corriendo en http://localhost:${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV || 'development'}\n`);
});
