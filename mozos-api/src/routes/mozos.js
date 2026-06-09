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

// GET /api/mozos/:id
router.get('/:id', authOpcional, async (req, res) => {
  try {
    const mozo = await db.prepare(`
      SELECT m.id, m.nombre, m.foto, m.descripcion, m.turno, m.bar_id,
             b.nombre AS bar_nombre
      FROM mozos m
      JOIN bares b ON b.id = m.bar_id
      WHERE m.id = ? AND m.activo = 1
    `).get(req.params.id);

    if (!mozo) return res.status(404).json({ error: 'Mozo no encontrado' });

    const metricas = await db.prepare(`
      SELECT
        ROUND(AVG(atencion),   1) AS atencion,
        ROUND(AVG(amabilidad), 1) AS amabilidad,
        ROUND(AVG(rapidez),    1) AS rapidez,
        ROUND(AVG(actitud),    1) AS actitud,
        ROUND(AVG((atencion + amabilidad + rapidez + actitud) / 4.0), 1) AS promedio,
        COUNT(*) AS total_resenas
      FROM resenas WHERE mozo_id = ?
    `).get(mozo.id);

    const comentarios = await db.prepare(`
      SELECT r.comentario, r.fecha, u.nombre AS autor
      FROM resenas r
      JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.mozo_id = ? AND r.comentario IS NOT NULL AND r.comentario != ''
      ORDER BY r.fecha DESC
      LIMIT 5
    `).all(mozo.id);

    const mes = new Date().toISOString().slice(0, 7);
    const badges = await db.prepare(`
      SELECT ba.nombre, ba.icono
      FROM mozo_badges mb
      JOIN badges ba ON ba.id = mb.badge_id
      WHERE mb.mozo_id = ? AND mb.mes = ?
    `).all(mozo.id, mes);

    return res.json({ mozo, metricas, comentarios, badges });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/mozos
router.post('/', authAdmin, [
  body('nombre').trim().isLength({ min: 2 }).withMessage('Nombre demasiado corto'),
  body('turno').optional().isIn(['Mañana', 'Tarde', 'Noche']).withMessage('Turno inválido'),
], async (req, res) => {
  if (!validar(req, res)) return;
  console.log(req.body);
  const { nombre, descripcion, turno, foto } = req.body;
  const bar_id = req.usuario.bar_id;
  try {
    const bar = await db.prepare('SELECT id FROM bares WHERE id = ? AND admin_id = ?').get(bar_id, req.usuario.id);
    if (!bar) return res.status(403).json({ error: 'No tenés permiso sobre este bar' });

    const resultado = await db.prepare(`
  INSERT INTO mozos (bar_id, nombre, foto, descripcion, turno)
  VALUES (?, ?, ?, ?, ?)
`).run(
  bar_id,
  nombre,
  foto || null,
  descripcion || null,
  turno || null
);

    const mozo = await db.prepare('SELECT * FROM mozos WHERE id = ?').get(resultado.lastInsertRowid);
    return res.status(201).json({ mozo });
  } catch (err) {
  console.error('ERROR CREANDO MOZO:', err);

  return res.status(500).json({
    error: err.message,
    stack: err.stack
  });
}
});

// PUT /api/mozos/:id
router.put('/:id', authAdmin, async (req, res) => {
  try {
    const mozo = await db.prepare(`
      SELECT m.* FROM mozos m
      JOIN bares b ON b.id = m.bar_id
      WHERE m.id = ? AND m.activo = 1 AND b.admin_id = ?
    `).get(req.params.id, req.usuario.id);

    if (!mozo) return res.status(404).json({ error: 'Mozo no encontrado o sin permiso' });

    const { nombre, descripcion, turno, foto } = req.body;
    await db.prepare(`
  UPDATE mozos SET
    nombre      = COALESCE(?, nombre),
    foto        = COALESCE(?, foto),
    descripcion = COALESCE(?, descripcion),
    turno       = COALESCE(?, turno)
  WHERE id = ?
`).run(
  nombre || null,
  foto !== undefined ? foto : null,
  descripcion || null,
  turno || null,
  mozo.id
);

    const actualizado = await db.prepare('SELECT * FROM mozos WHERE id = ?').get(mozo.id);
    return res.json({ mozo: actualizado });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/mozos/:id
router.delete('/:id', authAdmin, async (req, res) => {
  try {
    const mozo = await db.prepare(`
      SELECT m.* FROM mozos m
      JOIN bares b ON b.id = m.bar_id
      WHERE m.id = ? AND m.activo = 1 AND b.admin_id = ?
    `).get(req.params.id, req.usuario.id);

    if (!mozo) return res.status(404).json({ error: 'Mozo no encontrado o sin permiso' });

    await db.prepare('UPDATE mozos SET activo = 0 WHERE id = ?').run(mozo.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
