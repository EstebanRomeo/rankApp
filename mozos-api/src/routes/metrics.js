const express = require('express');
const db      = require('../db/database');
const { authAdmin } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/metrics/:bar_id
// Devuelve todos los KPIs y métricas para el dashboard admin
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:bar_id', authAdmin, async (req, res) => {
  const bar_id = parseInt(req.params.bar_id);
  if (req.usuario.bar_id !== bar_id) {
    return res.status(403).json({ error: 'Sin permiso' });
  }

  try {
    // ── 1. KPIs generales ────────────────────────────────────────────────────
    const kpis = await db.prepare(`
      SELECT
        COUNT(r.id)                                                        AS total_resenas,
        ROUND(AVG((r.atencion+r.amabilidad+r.rapidez+r.actitud)/4.0), 2)  AS promedio_general,
        COUNT(DISTINCT r.usuario_id)                                       AS clientes_unicos
      FROM resenas r
      JOIN mozos m ON m.id = r.mozo_id
      WHERE m.bar_id = ? AND m.activo = 1
    `).get(bar_id);

    // ── 2. Reseñas esta semana vs semana anterior ─────────────────────────────
    const semanaActual = await db.prepare(`
      SELECT COUNT(*) AS n
      FROM resenas r JOIN mozos m ON m.id = r.mozo_id
      WHERE m.bar_id = ? AND r.fecha >= datetime('now', '-7 days')
    `).get(bar_id);

    const semanaAnterior = await db.prepare(`
      SELECT COUNT(*) AS n
      FROM resenas r JOIN mozos m ON m.id = r.mozo_id
      WHERE m.bar_id = ?
        AND r.fecha >= datetime('now', '-14 days')
        AND r.fecha <  datetime('now', '-7 days')
    `).get(bar_id);

    // ── 3. Ranking de mozos ───────────────────────────────────────────────────
    const rankingMozos = await db.prepare(`
      SELECT
        m.id, m.nombre, m.turno,
        ROUND(AVG((r.atencion+r.amabilidad+r.rapidez+r.actitud)/4.0), 1) AS promedio,
        ROUND(AVG(r.atencion),   1) AS atencion,
        ROUND(AVG(r.amabilidad), 1) AS amabilidad,
        ROUND(AVG(r.rapidez),    1) AS rapidez,
        ROUND(AVG(r.actitud),    1) AS actitud,
        COUNT(r.id)                  AS total_resenas
      FROM mozos m
      LEFT JOIN resenas r ON r.mozo_id = m.id
      WHERE m.bar_id = ? AND m.activo = 1
      GROUP BY m.id
      ORDER BY promedio DESC NULLS LAST
    `).all(bar_id);

    // ── 4. Evolución semanal (últimas 8 semanas) ──────────────────────────────
    const evolucion = await db.prepare(`
      SELECT
        strftime('%Y-W%W', r.fecha) AS semana,
        ROUND(AVG((r.atencion+r.amabilidad+r.rapidez+r.actitud)/4.0), 2) AS promedio,
        COUNT(*) AS total
      FROM resenas r
      JOIN mozos m ON m.id = r.mozo_id
      WHERE m.bar_id = ? AND r.fecha >= datetime('now', '-56 days')
      GROUP BY semana
      ORDER BY semana ASC
    `).all(bar_id);

    // ── 5. Satisfacción por día (últimos 7 días) ──────────────────────────────
    const porDia = await db.prepare(`
      SELECT
        strftime('%w', r.fecha) AS dia_num,
        strftime('%d/%m', r.fecha) AS dia_label,
        ROUND(AVG((r.atencion+r.amabilidad+r.rapidez+r.actitud)/4.0), 2) AS promedio,
        COUNT(*) AS total
      FROM resenas r
      JOIN mozos m ON m.id = r.mozo_id
      WHERE m.bar_id = ? AND r.fecha >= datetime('now', '-7 days')
      GROUP BY strftime('%Y-%m-%d', r.fecha)
      ORDER BY r.fecha ASC
    `).all(bar_id);

    // ── 6. Distribución de puntajes (1 a 5 estrellas) ────────────────────────
    const distribucion = await db.prepare(`
      SELECT
        ROUND((atencion+amabilidad+rapidez+actitud)/4.0) AS estrellas,
        COUNT(*) AS cantidad
      FROM resenas r
      JOIN mozos m ON m.id = r.mozo_id
      WHERE m.bar_id = ?
      GROUP BY estrellas
      ORDER BY estrellas
    `).all(bar_id);

    // ── 7. Últimas 5 reseñas ──────────────────────────────────────────────────
    const ultimasResenas = await db.prepare(`
      SELECT
        r.comentario, r.fecha,
        ROUND((r.atencion+r.amabilidad+r.rapidez+r.actitud)/4.0, 1) AS promedio,
        u.nombre AS autor,
        m.nombre AS mozo_nombre
      FROM resenas r
      JOIN usuarios u ON u.id = r.usuario_id
      JOIN mozos    m ON m.id = r.mozo_id
      WHERE m.bar_id = ?
      ORDER BY r.fecha DESC
      LIMIT 5
    `).all(bar_id);

    return res.json({
      kpis: {
        total_resenas:    kpis.total_resenas    || 0,
        promedio_general: kpis.promedio_general || 0,
        clientes_unicos:  kpis.clientes_unicos  || 0,
        resenas_semana:   semanaActual.n        || 0,
        resenas_semana_anterior: semanaAnterior.n || 0,
        mejor_mozo: rankingMozos[0] || null,
        peor_mozo:  rankingMozos[rankingMozos.length - 1] || null,
      },
      ranking_mozos:  rankingMozos,
      evolucion,
      por_dia:        porDia,
      distribucion,
      ultimas_resenas: ultimasResenas,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
