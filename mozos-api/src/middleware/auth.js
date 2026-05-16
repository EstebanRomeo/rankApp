const jwt = require('jsonwebtoken');

// ─── Verificar token de cliente ───────────────────────────────────────────────
function authCliente(req, res, next) {
  const token = extraerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: tokenError(err) });
  }
}

// ─── Verificar token de admin ────────────────────────────────────────────────
function authAdmin(req, res, next) {
  const token = extraerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
    if (payload.rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso solo para administradores' });
    }
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: tokenError(err) });
  }
}

// ─── Opcional: adjunta usuario si hay token, pero no bloquea si no hay ───────
function authOpcional(req, res, next) {
  const token = extraerToken(req);
  if (token) {
    try {
      req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // token inválido → continúa sin usuario
    }
  }
  next();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extraerToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
}

function tokenError(err) {
  if (err.name === 'TokenExpiredError') return 'Sesión expirada, volvé a iniciar sesión';
  if (err.name === 'JsonWebTokenError')  return 'Token inválido';
  return 'Error de autenticación';
}

module.exports = { authCliente, authAdmin, authOpcional };
