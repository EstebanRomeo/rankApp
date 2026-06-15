// routes/demo.js
// npm install resend
const express = require('express');
const { Resend } = require('resend');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: { error: 'Demasiadas solicitudes de demo. Intentá en una hora.' },
});

// POST /api/demo
router.post('/', limiter, [
  body('nombre').trim().isLength({ min: 2 }).withMessage('Nombre requerido'),
  body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
  body('bar').trim().isLength({ min: 2 }).withMessage('Nombre del local requerido'),
], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(422).json({ error: errores.array()[0].msg });

  const { nombre, email, bar, tel } = req.body;

  try {
    await resend.emails.send({
      from:    'Aureum Demo <onboarding@resend.dev>',   // cambiar por tu dominio verificado
      to:      process.env.DEMO_EMAIL_TO,               // tu email personal
      replyTo: email,
      subject: `🍺 Nueva solicitud de demo — ${bar}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0d0d0d;color:#f3f4f6;padding:32px;border-radius:16px;">
          <h2 style="color:#22d3ee;margin-bottom:4px">Nueva solicitud de demo</h2>
          <p style="color:#9ca3af;margin-top:0">Alguien quiere conocer Aureum 🎉</p>
          <table style="width:100%;border-collapse:collapse;margin-top:20px">
            <tr><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#9ca3af;width:140px">Nombre</td><td style="padding:10px 0;border-bottom:1px solid #1f2937;font-weight:600">${nombre}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#9ca3af">Email</td><td style="padding:10px 0;border-bottom:1px solid #1f2937"><a href="mailto:${email}" style="color:#22d3ee">${email}</a></td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#9ca3af">Local</td><td style="padding:10px 0;border-bottom:1px solid #1f2937;font-weight:600">${bar}</td></tr>
            <tr><td style="padding:10px 0;color:#9ca3af">Teléfono</td><td style="padding:10px 0">${tel || '—'}</td></tr>
          </table>
          <a href="mailto:${email}" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#22d3ee;color:#000;border-radius:40px;font-weight:700;text-decoration:none">
            Responder a ${nombre.split(' ')[0]} →
          </a>
        </div>
      `,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error enviando email de demo:', err);
    return res.status(500).json({ error: 'Error al enviar el email.' });
  }
});

module.exports = router;
