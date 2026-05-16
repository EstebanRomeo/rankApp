const express = require('express');
const db = require('../db/database');
const { authAdmin } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alertas/:bar_id
// Genera alertas automáticas analizando los datos de las reseñas:
//   - Mozo con caída brusca de puntaje en los últimos 7 días
//   - Mozo con muy pocas reseñas (sin datos suficientes)
//   - Palabras clave negativas frecuentes en comentarios recientes
//   - Mozo que mejoró notablemente (alerta positiva)
//   - Semana con más reseñas que la anterior
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:bar_id', authAdmin, (req, res) => {
  const bar_id = parseInt(req.params.bar_id);

  if (req.usuario.bar_id !== bar_id) {
    return res.status(403).json({ error: 'Sin permiso' });
  }

  const alertas = [];

  // ── 1. Caída brusca: promedio últimos 7 días vs. 7 días anteriores ──────────
  const mozos = db.prepare(`
    SELECT id, nombre FROM mozos WHERE bar_id = ? AND activo = 1
  `).all(bar_id);

  for (const mozo of mozos) {
    const semanaActual = db.prepare(`
      SELECT ROUND(AVG((atencion+amabilidad+rapidez+actitud)/4.0), 2) AS promedio, COUNT(*) AS n
      FROM resenas
      WHERE mozo_id = ? AND fecha >= datetime('now', '-7 days')
    `).get(mozo.id);

    const semanaAnterior = db.prepare(`
      SELECT ROUND(AVG((atencion+amabilidad+rapidez+actitud)/4.0), 2) AS promedio
      FROM resenas
      WHERE mozo_id = ?
        AND fecha >= datetime('now', '-14 days')
        AND fecha < datetime('now', '-7 days')
    `).get(mozo.id);

    const pActual   = semanaActual?.promedio;
    const pAnterior = semanaAnterior?.promedio;

    if (pActual && pAnterior) {
      const diff = pActual - pAnterior;
      if (diff <= -0.5) {
        alertas.push({
          tipo: 'warning',
          mozo_id: mozo.id,
          mozo_nombre: mozo.nombre,
          mensaje: `${mozo.nombre} bajó ${Math.abs(diff).toFixed(1)} puntos esta semana. Promedio actual: ${pActual}`,
        });
      }
      if (diff >= 0.5) {
        alertas.push({
          tipo: 'success',
          mozo_id: mozo.id,
          mozo_nombre: mozo.nombre,
          mensaje: `${mozo.nombre} mejoró ${diff.toFixed(1)} puntos esta semana. Promedio actual: ${pActual}`,
        });
      }
    }

    // Promedio histórico bajo (menor a 3.5) con al menos 5 reseñas
    const historico = db.prepare(`
      SELECT ROUND(AVG((atencion+amabilidad+rapidez+actitud)/4.0), 1) AS promedio, COUNT(*) AS n
      FROM resenas WHERE mozo_id = ?
    `).get(mozo.id);

    if (historico.n >= 5 && historico.promedio < 3.5) {
      alertas.push({
        tipo: 'danger',
        mozo_id: mozo.id,
        mozo_nombre: mozo.nombre,
        mensaje: `${mozo.nombre} tiene un promedio bajo de ${historico.promedio} en ${historico.n} reseñas.`,
      });
    }
  }

  // ── 2. Palabras clave negativas en comentarios de los últimos 3 días ────────
  const palabrasNegativas = ['demora', 'tardó', 'tarde', 'mal', 'horrible', 'pésimo', 'grosero', 'ignoró', 'fría', 'frío'];
  const comentariosRecientes = db.prepare(`
    SELECT r.comentario, m.nombre AS mozo_nombre
    FROM resenas r
    JOIN mozos m ON m.id = r.mozo_id
    WHERE m.bar_id = ?
      AND r.comentario IS NOT NULL
      AND r.fecha >= datetime('now', '-3 days')
  `).all(bar_id);

  const conteoNegativo = {};
  for (const r of comentariosRecientes) {
    const texto = (r.comentario || '').toLowerCase();
    for (const palabra of palabrasNegativas) {
      if (texto.includes(palabra)) {
        conteoNegativo[palabra] = (conteoNegativo[palabra] || 0) + 1;
      }
    }
  }

  const frecuentes = Object.entries(conteoNegativo)
    .filter(([, n]) => n >= 2)
    .map(([p]) => p);

  if (frecuentes.length > 0) {
    alertas.push({
      tipo: 'warning',
      mozo_id: null,
      mozo_nombre: null,
      mensaje: `Muchas menciones sobre "${frecuentes.join('", "')}" en los últimos 3 días.`,
    });
  }

  // ── 3. Semana con más reseñas que la anterior ───────────────────────────────
  const resenasEstaSemana = db.prepare(`
    SELECT COUNT(*) AS n FROM resenas r
    JOIN mozos m ON m.id = r.mozo_id
    WHERE m.bar_id = ? AND r.fecha >= datetime('now', '-7 days')
  `).get(bar_id).n;

  const resenasSemanaPasada = db.prepare(`
    SELECT COUNT(*) AS n FROM resenas r
    JOIN mozos m ON m.id = r.mozo_id
    WHERE m.bar_id = ?
      AND r.fecha >= datetime('now', '-14 days')
      AND r.fecha < datetime('now', '-7 days')
  `).get(bar_id).n;

  if (resenasEstaSemana > 0 && resenasSemanaPasada > 0) {
    const pct = Math.round(((resenasEstaSemana - resenasSemanaPasada) / resenasSemanaPasada) * 100);
    if (pct >= 20) {
      alertas.push({
        tipo: 'info',
        mozo_id: null,
        mozo_nombre: null,
        mensaje: `Se registraron ${resenasEstaSemana} reseñas esta semana, un ${pct}% más que la anterior.`,
      });
    }
  }

  return res.json({ alertas, total: alertas.length });
});

module.exports = router;
