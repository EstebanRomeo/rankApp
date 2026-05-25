const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { authCliente, authAdmin } = require('../middleware/auth');

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

// POST /api/resenas
router.post('/', authCliente, [
  body('mozo_id').isInt({ min: 1 }).withMessage('mozo_id inválido'),
  body('atencion').isInt({ min: 1, max: 5 }).withMessage('atencion debe ser 1-5'),
  body('amabilidad').isInt({ min: 1, max: 5 }).withMessage('amabilidad debe ser 1-5'),
  body('rapidez').isInt({ min: 1, max: 5 }).withMessage('rapidez debe ser 1-5'),
  body('actitud').isInt({ min: 1, max: 5 }).withMessage('actitud debe ser 1-5'),
  body('comentario').optional().isLength({ max: 500 }).withMessage('Comentario demasiado largo'),
], async (req, res) => {
  if (!validar(req, res)) return;

  const { mozo_id, atencion, amabilidad, rapidez, actitud, comentario, volveria, recomendaria } = req.body;
  const usuario_id    = req.usuario.id;
  const cooldownHoras = parseInt(process.env.RESENA_COOLDOWN_HORAS || '4');

  try {
    const mozo = await db.prepare('SELECT id, bar_id FROM mozos WHERE id = ? AND activo = 1').get(mozo_id);
    if (!mozo) return res.status(404).json({ error: 'Mozo no encontrado' });

    const ultimaResena = await db.prepare(`
      SELECT fecha FROM resenas
      WHERE usuario_id = ? AND mozo_id = ?
      ORDER BY fecha DESC LIMIT 1
    `).get(usuario_id, mozo_id);

    if (ultimaResena) {
      const hace = (Date.now() - new Date(ultimaResena.fecha).getTime()) / 3600000;
      if (hace < cooldownHoras) {
        const restanMinutos = Math.ceil((cooldownHoras - hace) * 60);
        return res.status(429).json({
          error: `Ya valoraste a este mozo recientemente. Podés volver a hacerlo en ${restanMinutos} minutos.`
        });
      }
    }

    const ip_address = req.ip || req.headers['x-forwarded-for'] || null;

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
             u.nombre AS autor
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
             u.nombre AS autor, m.nombre AS mozo_nombre
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
