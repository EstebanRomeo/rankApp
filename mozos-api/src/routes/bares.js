const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authAdmin } = require('../middleware/auth');

const router = express.Router();

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
// POST /api/bares/register
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/register',
  [
    body('nombre').trim().isLength({ min: 2 }).withMessage('Nombre demasiado corto'),
    body('apellido').trim().isLength({ min: 2 }).withMessage('Apellido demasiado corto'),
    body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
    body('bar_nombre').trim().isLength({ min: 2 }).withMessage('Nombre del bar demasiado corto'),
  ],
  async (req, res) => {
    if (!validar(req, res)) return;

    const { nombre, apellido, email, password, bar_nombre, bar_descripcion, bar_color } = req.body;

    try {
      const existe = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
      if (existe) return res.status(409).json({ error: 'Ese email ya está registrado' });

      const barExiste = await db.prepare('SELECT id FROM bares WHERE LOWER(nombre) = LOWER(?)').get(bar_nombre);
      if (barExiste) return res.status(409).json({ error: 'Ya existe un bar con ese nombre' });

      const password_hash = await bcrypt.hash(password, 12);

      // Transacción atómica
      const registrar = db.transaction(async () => {
        const resAdmin = await db.prepare(`
          INSERT INTO usuarios (nombre, email, password_hash, rol)
          VALUES (?, ?, ?, 'admin')
        `).run(`${nombre} ${apellido}`, email, password_hash);

        const admin_id = resAdmin.lastInsertRowid;

        const slug = bar_nombre
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '');

        const resBar = await db.prepare(`
          INSERT INTO bares (nombre, descripcion, color, slug, admin_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(bar_nombre, bar_descripcion || null, bar_color || '#1a1a2e', slug, admin_id);

        return { admin_id, bar_id: resBar.lastInsertRowid, slug };
      });

      const { admin_id, bar_id, slug } = await registrar();

      const token = jwt.sign(
        { id: admin_id, email, nombre: `${nombre} ${apellido}`, rol: 'admin', bar_id },
        process.env.JWT_ADMIN_SECRET,
        { expiresIn: process.env.JWT_ADMIN_EXPIRES_IN || '1d' }
      );

      return res.status(201).json({
        token,
        usuario: { id: admin_id, nombre: `${nombre} ${apellido}`, email, rol: 'admin' },
        bar: { id: bar_id, nombre: bar_nombre, descripcion: bar_descripcion || null, color: bar_color || '#1a1a2e', slug, url_publica: `mozos.app/${slug}` }
      });

    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bares/slug/:slug  — ANTES que /:id para evitar conflicto de rutas
// ─────────────────────────────────────────────────────────────────────────────
router.get('/slug/:slug', async (req, res) => {
  try {
    const bar = await db.prepare(`
      SELECT id, nombre, descripcion, logo, color, slug
      FROM bares WHERE slug = ? AND activo = 1
    `).get(req.params.slug);

    if (!bar) return res.status(404).json({ error: 'Bar no encontrado' });

    const mozos = await db.prepare(`
      SELECT m.id, m.nombre, m.foto, m.turno,
             ROUND(AVG((r.atencion + r.amabilidad + r.rapidez + r.actitud) / 4.0), 1) AS promedio,
             COUNT(r.id) AS total_resenas
      FROM mozos m
      LEFT JOIN resenas r ON r.mozo_id = m.id
      WHERE m.bar_id = ? AND m.activo = 1
      GROUP BY m.id
      ORDER BY promedio DESC
    `).all(bar.id);

    return res.json({ bar, mozos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bares/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const bar = await db.prepare(`
      SELECT b.id, b.nombre, b.descripcion, b.logo, b.color, b.slug
      FROM bares b WHERE b.id = ? AND b.activo = 1
    `).get(req.params.id);

    if (!bar) return res.status(404).json({ error: 'Bar no encontrado' });

    const mozos = await db.prepare(`
      SELECT m.id, m.nombre, m.foto, m.turno,
             ROUND(AVG((r.atencion + r.amabilidad + r.rapidez + r.actitud) / 4.0), 1) AS promedio,
             COUNT(r.id) AS total_resenas
      FROM mozos m
      LEFT JOIN resenas r ON r.mozo_id = m.id
      WHERE m.bar_id = ? AND m.activo = 1
      GROUP BY m.id
      ORDER BY promedio DESC
    `).all(bar.id);

    return res.json({ bar, mozos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/bares/:id
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', authAdmin, async (req, res) => {
  try {
    const bar = await db.prepare('SELECT * FROM bares WHERE id = ? AND activo = 1').get(req.params.id);
    if (!bar) return res.status(404).json({ error: 'Bar no encontrado' });
    if (bar.admin_id !== req.usuario.id) return res.status(403).json({ error: 'Sin permiso' });

    const { nombre, descripcion, color } = req.body;
    await db.prepare(`
      UPDATE bares SET
        nombre      = COALESCE(?, nombre),
        descripcion = COALESCE(?, descripcion),
        color       = COALESCE(?, color)
      WHERE id = ?
    `).run(nombre || null, descripcion || null, color || null, bar.id);

    const actualizado = await db.prepare('SELECT * FROM bares WHERE id = ?').get(bar.id);
    return res.json({ bar: actualizado });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
