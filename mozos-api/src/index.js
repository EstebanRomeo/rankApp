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

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json());

app.use('/api/auth',    authRoutes);
app.use('/api/bares',   baresRoutes);
app.use('/api/mozos',   mozosRoutes);
app.use('/api/resenas', resenasRoutes);
app.use('/api/alertas', alertasRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`\n🍺 Mozos API corriendo en http://localhost:${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV || 'development'}\n`);
});
