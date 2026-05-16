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
// Crea el admin + el bar en una sola transacción atómica.
// Si algo falla, no queda ningún registro a medias en la BD.
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
  (req, res) => {
    if (!validar(req, res)) return;

    const { nombre, apellido, email, password, bar_nombre, bar_descripcion, bar_color } = req.body;

    // Verificar que el email no esté registrado
    const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existe) {
      return res.status(409).json({ error: 'Ese email ya está registrado' });
    }

    // Verificar que no exista un bar con ese nombre
    const barExiste = db.prepare('SELECT id FROM bares WHERE LOWER(nombre) = LOWER(?)').get(bar_nombre);
    if (barExiste) {
      return res.status(409).json({ error: 'Ya existe un bar con ese nombre' });
    }

    const password_hash = bcrypt.hashSync(password, 12);

    // Transacción: si falla cualquier paso, se revierte todo
    const registrar = db.transaction(() => {
      const resAdmin = db.prepare(`
        INSERT INTO usuarios (nombre, email, password_hash, rol)
        VALUES (?, ?, ?, 'admin')
      `).run(`${nombre} ${apellido}`, email, password_hash);

      const admin_id = resAdmin.lastInsertRowid;

      const resBar = db.prepare(`
        INSERT INTO bares (nombre, descripcion, color, admin_id)
        VALUES (?, ?, ?, ?)
      `).run(
        bar_nombre,
        bar_descripcion || null,
        bar_color || '#1a1a2e',
        admin_id
      );

      const bar_id = resBar.lastInsertRowid;

      return { admin_id, bar_id };
    });

    const { admin_id, bar_id } = registrar();

    // Generar slug para la URL pública del bar
    const slug = bar_nombre
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    // Actualizar el slug en el bar
    db.prepare('UPDATE bares SET slug = ? WHERE id = ?').run(slug, bar_id);

    // Generar token de admin con bar_id incluido
    const token = jwt.sign(
      { id: admin_id, email, nombre: `${nombre} ${apellido}`, rol: 'admin', bar_id },
      process.env.JWT_ADMIN_SECRET,
      { expiresIn: process.env.JWT_ADMIN_EXPIRES_IN || '1d' }
    );

    return res.status(201).json({
      token,
      usuario: {
        id:     admin_id,
        nombre: `${nombre} ${apellido}`,
        email,
        rol:    'admin',
      },
      bar: {
        id:          bar_id,
        nombre:      bar_nombre,
        descripcion: bar_descripcion || null,
        color:       bar_color || '#1a1a2e',
        slug,
        url_publica: `mozos.app/${slug}`,
      }
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bares/:id  — Info pública del bar (para la landing del cliente)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const bar = db.prepare(`
    SELECT b.id, b.nombre, b.descripcion, b.logo, b.color, b.slug
    FROM bares b
    WHERE b.id = ? AND b.activo = 1
  `).get(req.params.id);

  if (!bar) return res.status(404).json({ error: 'Bar no encontrado' });

  // Mozos activos del bar con sus promedios
  const mozos = db.prepare(`
    SELECT
      m.id, m.nombre, m.foto, m.turno,
      ROUND(AVG((r.atencion + r.amabilidad + r.rapidez + r.actitud) / 4.0), 1) AS promedio,
      COUNT(r.id) AS total_resenas
    FROM mozos m
    LEFT JOIN resenas r ON r.mozo_id = m.id
    WHERE m.bar_id = ? AND m.activo = 1
    GROUP BY m.id
    ORDER BY promedio DESC NULLS LAST
  `).all(bar.id);

  return res.json({ bar, mozos });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bares/slug/:slug  — Buscar bar por slug (para la URL pública)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/slug/:slug', (req, res) => {
  const bar = db.prepare(`
    SELECT id, nombre, descripcion, logo, color, slug
    FROM bares WHERE slug = ? AND activo = 1
  `).get(req.params.slug);

  if (!bar) return res.status(404).json({ error: 'Bar no encontrado' });

  const mozos = db.prepare(`
    SELECT
      m.id, m.nombre, m.foto, m.turno,
      ROUND(AVG((r.atencion + r.amabilidad + r.rapidez + r.actitud) / 4.0), 1) AS promedio,
      COUNT(r.id) AS total_resenas
    FROM mozos m
    LEFT JOIN resenas r ON r.mozo_id = m.id
    WHERE m.bar_id = ? AND m.activo = 1
    GROUP BY m.id
    ORDER BY promedio DESC NULLS LAST
  `).all(bar.id);

  return res.json({ bar, mozos });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/bares/:id  — Actualizar datos del bar (solo admin dueño)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', authAdmin, (req, res) => {
  const bar = db.prepare('SELECT * FROM bares WHERE id = ? AND activo = 1').get(req.params.id);
  if (!bar) return res.status(404).json({ error: 'Bar no encontrado' });

  if (bar.admin_id !== req.usuario.id) {
    return res.status(403).json({ error: 'No tenés permiso para editar este bar' });
  }

  const { nombre, descripcion, color } = req.body;

  db.prepare(`
    UPDATE bares SET
      nombre      = COALESCE(?, nombre),
      descripcion = COALESCE(?, descripcion),
      color       = COALESCE(?, color)
    WHERE id = ?
  `).run(nombre || null, descripcion || null, color || null, bar.id);

  const actualizado = db.prepare('SELECT * FROM bares WHERE id = ?').get(bar.id);
  return res.json({ bar: actualizado });
});

module.exports = router;
