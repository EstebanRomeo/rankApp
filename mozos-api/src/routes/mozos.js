const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authAdmin, authOpcional } = require('../middleware/auth');

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
// GET /api/mozos/:id  — Perfil público de un mozo
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', authOpcional, (req, res) => {
  const mozo = db.prepare(`
    SELECT m.id, m.nombre, m.foto, m.descripcion, m.turno, m.bar_id,
           b.nombre AS bar_nombre
    FROM mozos m
    JOIN bares b ON b.id = m.bar_id
    WHERE m.id = ? AND m.activo = 1
  `).get(req.params.id);

  if (!mozo) return res.status(404).json({ error: 'Mozo no encontrado' });

  // Métricas promedio
  const metricas = db.prepare(`
    SELECT
      ROUND(AVG(atencion),   1) AS atencion,
      ROUND(AVG(amabilidad), 1) AS amabilidad,
      ROUND(AVG(rapidez),    1) AS rapidez,
      ROUND(AVG(actitud),    1) AS actitud,
      ROUND(AVG((atencion + amabilidad + rapidez + actitud) / 4.0), 1) AS promedio,
      COUNT(*) AS total_resenas
    FROM resenas WHERE mozo_id = ?
  `).get(mozo.id);

  // Últimos 5 comentarios
  const comentarios = db.prepare(`
    SELECT r.comentario, r.fecha,
           u.nombre AS autor
    FROM resenas r
    JOIN usuarios u ON u.id = r.usuario_id
    WHERE r.mozo_id = ? AND r.comentario IS NOT NULL AND r.comentario != ''
    ORDER BY r.fecha DESC
    LIMIT 5
  `).all(mozo.id);

  // Badges del mes actual
  const mes = new Date().toISOString().slice(0, 7);
  const badges = db.prepare(`
    SELECT ba.nombre, ba.icono
    FROM mozo_badges mb
    JOIN badges ba ON ba.id = mb.badge_id
    WHERE mb.mozo_id = ? AND mb.mes = ?
  `).all(mozo.id, mes);

  return res.json({ mozo, metricas, comentarios, badges });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mozos  — Agregar mozo (solo admin del bar)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/',
  authAdmin,
  [
    body('nombre').trim().isLength({ min: 2 }).withMessage('Nombre demasiado corto'),
    body('turno').optional().isIn(['Mañana', 'Tarde', 'Noche']).withMessage('Turno inválido'),
  ],
  (req, res) => {
    if (!validar(req, res)) return;

    const { nombre, descripcion, turno } = req.body;
    const bar_id = req.usuario.bar_id;

    // Verificar que el bar le pertenece
    const bar = db.prepare('SELECT id FROM bares WHERE id = ? AND admin_id = ?').get(bar_id, req.usuario.id);
    if (!bar) return res.status(403).json({ error: 'No tenés permiso sobre este bar' });

    const resultado = db.prepare(`
      INSERT INTO mozos (bar_id, nombre, descripcion, turno)
      VALUES (?, ?, ?, ?)
    `).run(bar_id, nombre, descripcion || null, turno || null);

    const mozo = db.prepare('SELECT * FROM mozos WHERE id = ?').get(resultado.lastInsertRowid);
    return res.status(201).json({ mozo });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/mozos/:id  — Editar mozo
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', authAdmin, (req, res) => {
  const mozo = db.prepare(`
    SELECT m.* FROM mozos m
    JOIN bares b ON b.id = m.bar_id
    WHERE m.id = ? AND m.activo = 1 AND b.admin_id = ?
  `).get(req.params.id, req.usuario.id);

  if (!mozo) return res.status(404).json({ error: 'Mozo no encontrado o sin permiso' });

  const { nombre, descripcion, turno } = req.body;

  db.prepare(`
    UPDATE mozos SET
      nombre      = COALESCE(?, nombre),
      descripcion = COALESCE(?, descripcion),
      turno       = COALESCE(?, turno)
    WHERE id = ?
  `).run(nombre || null, descripcion || null, turno || null, mozo.id);

  const actualizado = db.prepare('SELECT * FROM mozos WHERE id = ?').get(mozo.id);
  return res.json({ mozo: actualizado });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/mozos/:id  — Desactivar mozo (soft delete)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', authAdmin, (req, res) => {
  const mozo = db.prepare(`
    SELECT m.* FROM mozos m
    JOIN bares b ON b.id = m.bar_id
    WHERE m.id = ? AND m.activo = 1 AND b.admin_id = ?
  `).get(req.params.id, req.usuario.id);

  if (!mozo) return res.status(404).json({ error: 'Mozo no encontrado o sin permiso' });

  db.prepare('UPDATE mozos SET activo = 0 WHERE id = ?').run(mozo.id);
  return res.json({ ok: true });
});

module.exports = router;
