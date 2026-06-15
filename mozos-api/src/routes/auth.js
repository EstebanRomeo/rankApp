const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');

const router = express.Router();

// ─── Rate limiting ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Esperá 15 minutos e intentá de nuevo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const validarEmail = body('email').isEmail().withMessage('Email inválido').normalizeEmail();
const validarPassword = body('password').isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres');

function generarTokenCliente(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: 'cliente' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function generarTokenAdmin(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: 'admin', bar_id: usuario.bar_id },
    process.env.JWT_ADMIN_SECRET,
    { expiresIn: process.env.JWT_ADMIN_EXPIRES_IN || '1d' }
  );
}

function validar(req, res) {
  const errores = validationResult(req);
  if (!errores.isEmpty()) {
    res.status(422).json({
      error: 'Datos inválidos',
      campos: errores.array().map(e => ({ campo: e.path, mensaje: e.msg }))
    });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, [validarEmail, validarPassword], async (req, res) => {
  if (!validar(req, res)) return;
  const { email, password } = req.body;

  try {
    const usuario = await db.prepare(`
      SELECT id, nombre, email, password_hash, foto, rol, activo
      FROM usuarios WHERE email = ? AND activo = 1
    `).get(email);

    if (!usuario || !usuario.password_hash) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const passwordOk = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    await db.prepare(`UPDATE usuarios SET ultimo_login = datetime('now') WHERE id = ?`).run(usuario.id);

    const token = generarTokenCliente(usuario);
    return res.json({
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, foto: usuario.foto, rol: usuario.rol }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/admin/login
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/login', loginLimiter, [validarEmail, validarPassword], async (req, res) => {
  if (!validar(req, res)) return;
  const { email, password } = req.body;

  try {
    const admin = await db.prepare(`
      SELECT u.id, u.nombre, u.email, u.password_hash, u.foto, u.rol, u.activo,
             b.id AS bar_id, b.nombre AS bar_nombre
      FROM usuarios u
      LEFT JOIN bares b ON b.admin_id = u.id AND b.activo = 1
      WHERE u.email = ? AND u.rol = 'admin' AND u.activo = 1
    `).get(email);

    if (!admin || !admin.password_hash) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const passwordOk = await bcrypt.compare(password, admin.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    await db.prepare(`UPDATE usuarios SET ultimo_login = datetime('now') WHERE id = ?`).run(admin.id);

    const token = generarTokenAdmin(admin);
    return res.json({
      token,
      usuario: { id: admin.id, nombre: admin.nombre, email: admin.email, foto: admin.foto, rol: 'admin', bar_id: admin.bar_id, bar_nombre: admin.bar_nombre }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────
router.post('/register', loginLimiter, [
  body('nombre').trim().isLength({ min: 2 }).withMessage('Nombre demasiado corto'),
  validarEmail,
  validarPassword,
], async (req, res) => {
  if (!validar(req, res)) return;
  const { nombre, email, password } = req.body;

  try {
    const existe = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existe) {
      return res.status(409).json({ error: 'No se pudo completar el registro' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const resultado = await db.prepare(`
      INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'cliente')
    `).run(nombre, email, password_hash);

    const usuario = await db.prepare('SELECT id, nombre, email, rol FROM usuarios WHERE id = ?').get(resultado.lastInsertRowid);
    const token = generarTokenCliente(usuario);

    return res.status(201).json({ token, usuario });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = auth.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    try {
      payload = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  }

  try {
    const usuario = await db.prepare(`
      SELECT id, nombre, email, foto, rol FROM usuarios WHERE id = ? AND activo = 1
    `).get(payload.id);

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json({ usuario });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/codigos/generar  — Solo vos podés usar esto (con ADMIN_SECRET)
// Body: { admin_secret, cantidad, notas, dias_expiracion }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/codigos/generar', async (req, res) => {
  const { admin_secret, cantidad = 1, notas = '', dias_expiracion } = req.body;

  // Validar que es el dueño del sistema
  if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Sin permiso.' });
  }

  const crypto = require('crypto');
  const codigos = [];

  try {
    for (let i = 0; i < Math.min(cantidad, 50); i++) {
      // Formato: AUR-XXXX-XXXX (fácil de dictar por teléfono)
      const parte1 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const parte2 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const codigo = `AUR-${parte1}-${parte2}`;

      const expira_en = dias_expiracion
        ? new Date(Date.now() + dias_expiracion * 86400000).toISOString()
        : null;

      await db.prepare(`
        INSERT INTO codigos_invitacion (codigo, notas, expira_en)
        VALUES (?, ?, ?)
      `).run(codigo, notas || null, expira_en);

      codigos.push({ codigo, expira_en });
    }

    return res.json({ ok: true, codigos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error generando códigos.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/codigos  — Ver todos los códigos (con ADMIN_SECRET)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/codigos', async (req, res) => {
  const admin_secret = req.query.admin_secret;
  if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Sin permiso.' });
  }
  try {
    const codigos = await db.prepare(`
      SELECT c.codigo, c.usado, c.notas, c.creado_en, c.expira_en, c.usado_en,
             u.nombre AS usado_por_nombre, u.email AS usado_por_email
      FROM codigos_invitacion c
      LEFT JOIN usuarios u ON u.id = c.usado_por
      ORDER BY c.creado_en DESC
    `).all();
    return res.json({ codigos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error.' });
  }
});

module.exports = router;
