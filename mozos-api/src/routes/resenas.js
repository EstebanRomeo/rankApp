const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authCliente, authAdmin } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

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

// ── Helper: obtener usuario_id si hay token, o null si es anónimo ─────────────
const getUsuarioOpcional = async (req) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    return payload.id;
  } catch { return null; }
};

// ── Helper: obtener o crear usuario anónimo para reseñas sin cuenta ───────────
const getUsuarioAnonimo = async (nombreMostrar) => {
  const nombre = (nombreMostrar || 'Anónimo').trim().slice(0, 50);
  // Buscar si ya existe un usuario anónimo con ese nombre de display
  // Para evitar duplicados usamos un email ficticio basado en timestamp
  const email  = `anonimo_${Date.now()}_${Math.random().toString(36).slice(2)}@rankapp.local`;
  const res    = await db.prepare(`
    INSERT INTO usuarios (nombre, email, rol, activo)
    VALUES (?, ?, 'cliente', 1)
  `).run(nombre, email);
  return res.lastInsertRowid;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/resenas  — Crear reseña (autenticado O anónimo)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', [
  body('mozo_id').isInt({ min: 1 }).withMessage('mozo_id inválido'),
  body('atencion').isInt({ min: 1, max: 5 }).withMessage('atencion debe ser 1-5'),
  body('amabilidad').isInt({ min: 1, max: 5 }).withMessage('amabilidad debe ser 1-5'),
  body('rapidez').isInt({ min: 1, max: 5 }).withMessage('rapidez debe ser 1-5'),
  body('actitud').isInt({ min: 1, max: 5 }).withMessage('actitud debe ser 1-5'),
  body('comentario').optional().isLength({ max: 500 }).withMessage('Comentario demasiado largo'),
  body('nombre_anonimo').optional().isLength({ max: 50 }).withMessage('Nombre demasiado largo'),
], async (req, res) => {
  if (!validar(req, res)) return;

  const { mozo_id, atencion, amabilidad, rapidez, actitud, comentario, volveria, recomendaria, nombre_anonimo } = req.body;
  const ip_address    = req.ip || req.headers['x-forwarded-for'] || null;
  const cooldownHoras = parseInt(process.env.RESENA_COOLDOWN_HORAS || '4');

  try {
    const mozo = await db.prepare('SELECT id, bar_id FROM mozos WHERE id = ? AND activo = 1').get(mozo_id);
    if (!mozo) return res.status(404).json({ error: 'Mozo no encontrado' });

    // Obtener usuario — logueado o crear anónimo
    let usuario_id = await getUsuarioOpcional(req);
    const esAnonimo = !usuario_id;

    if (esAnonimo) {
      // Anti-spam por IP para anónimos — una reseña por IP cada cooldown
      const ultimaPorIp = await db.prepare(`
        SELECT r.fecha FROM resenas r
        JOIN usuarios u ON u.id = r.usuario_id
        WHERE r.mozo_id = ? AND r.ip_address = ?
          AND u.email LIKE '%@rankapp.local'
        ORDER BY r.fecha DESC LIMIT 1
      `).get(mozo_id, ip_address);

      if (ultimaPorIp) {
        const hace = (Date.now() - new Date(ultimaPorIp.fecha).getTime()) / 3600000;
        if (hace < cooldownHoras) {
          const restanMinutos = Math.ceil((cooldownHoras - hace) * 60);
          return res.status(429).json({
            error: `Ya se dejó una reseña desde este dispositivo recientemente. Podés volver en ${restanMinutos} minutos.`
          });
        }
      }
      usuario_id = await getUsuarioAnonimo(nombre_anonimo);
    } else {
      // Anti-spam por usuario registrado
      const ultimaResena = await db.prepare(`
        SELECT fecha FROM resenas WHERE usuario_id = ? AND mozo_id = ?
        ORDER BY fecha DESC LIMIT 1
      `).get(usuario_id, mozo_id);

      if (ultimaResena) {
        const hace = (Date.now() - new Date(ultimaResena.fecha).getTime()) / 3600000;
        if (hace < cooldownHoras) {
          const restanMinutos = Math.ceil((cooldownHoras - hace) * 60);
          return res.status(429).json({
            error: `Ya valoraste a este mozo recientemente. Podés volver en ${restanMinutos} minutos.`
          });
        }
      }
    }

    const resultado = await db.prepare(`
      INSERT INTO resenas (usuario_id, mozo_id, atencion, amabilidad, rapidez, actitud, comentario, volveria, recomendaria, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(usuario_id, mozo_id, atencion, amabilidad, rapidez, actitud, comentario || null, volveria ? 1 : 0, recomendaria ? 1 : 0, ip_address);

    return res.status(201).json({ ok: true, resena_id: resultado.lastInsertRowid });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/resenas/mozo/:mozo_id
router.get('/mozo/:mozo_id', async (req, res) => {
  const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
  const limite = Math.min(20, parseInt(req.query.limite) || 10);
  const offset = (pagina - 1) * limite;
  try {
    const resenas = await db.prepare(`
      SELECT r.id, r.atencion, r.amabilidad, r.rapidez, r.actitud,
             r.comentario, r.volveria, r.recomendaria, r.fecha,
             CASE WHEN u.email LIKE '%@rankapp.local' THEN u.nombre ELSE u.nombre END AS autor,
             CASE WHEN u.email LIKE '%@rankapp.local' THEN 1 ELSE 0 END AS es_anonimo
      FROM resenas r
      JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.mozo_id = ?
      ORDER BY r.fecha DESC
      LIMIT ? OFFSET ?
    `).all(req.params.mozo_id, limite, offset);
    const row = await db.prepare('SELECT COUNT(*) AS n FROM resenas WHERE mozo_id = ?').get(req.params.mozo_id);
    return res.json({ resenas, total: row.n, pagina, paginas: Math.ceil(row.n / limite) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/resenas/bar/:bar_id/recientes  — PÚBLICO, solo comentarios con texto
router.get('/bar/:bar_id/recientes', async (req, res) => {
  const limite = Math.min(10, parseInt(req.query.limite) || 4);
  try {
    const resenas = await db.prepare(`
      SELECT r.comentario, r.fecha,
             u.nombre AS autor, m.nombre AS mozo_nombre, m.foto AS mozo_foto,
             ROUND((r.atencion + r.amabilidad + r.rapidez + r.actitud) / 4.0, 1) AS promedio
      FROM resenas r
      JOIN usuarios u ON u.id = r.usuario_id
      JOIN mozos    m ON m.id = r.mozo_id
      WHERE m.bar_id = ?
        AND r.comentario IS NOT NULL
        AND r.comentario != ''
      ORDER BY r.fecha DESC
      LIMIT ?
    `).all(req.params.bar_id, limite);
    return res.json({ resenas });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/resenas/bar/:bar_id
router.get('/bar/:bar_id', authAdmin, async (req, res) => {
  if (req.usuario.bar_id !== parseInt(req.params.bar_id)) {
    return res.status(403).json({ error: 'Sin permiso' });
  }
  const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
  const limite = Math.min(50, parseInt(req.query.limite) || 20);
  const offset = (pagina - 1) * limite;
  try {
    const resenas = await db.prepare(`
      SELECT r.id, r.atencion, r.amabilidad, r.rapidez, r.actitud,
             r.comentario, r.volveria, r.recomendaria, r.fecha,
             u.nombre AS autor, m.nombre AS mozo_nombre,
             CASE WHEN u.email LIKE '%@rankapp.local' THEN 1 ELSE 0 END AS es_anonimo
      FROM resenas r
      JOIN usuarios u ON u.id = r.usuario_id
      JOIN mozos    m ON m.id = r.mozo_id
      WHERE m.bar_id = ?
      ORDER BY r.fecha DESC
      LIMIT ? OFFSET ?
    `).all(req.params.bar_id, limite, offset);
    const row = await db.prepare(`
      SELECT COUNT(*) AS n FROM resenas r
      JOIN mozos m ON m.id = r.mozo_id WHERE m.bar_id = ?
    `).get(req.params.bar_id);
    return res.json({ resenas, total: row.n, pagina, paginas: Math.ceil(row.n / limite) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
