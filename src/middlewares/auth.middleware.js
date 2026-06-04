const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticación.
 *
 * No consulta la BD de usuarios. Solo verifica el JWT emitido por el módulo
 * de usuarios usando el secreto compartido (JWT_SECRET). Si el token es válido,
 * adjunta el payload en req.usuario.
 */
const verificarToken = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ ok: false, mensaje: 'Token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded; // ej. { id, email, tipoUsuario, ... }
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, mensaje: 'Token inválido o expirado' });
  }
};

/**
 * Middleware para restringir acceso solo a administradores.
 * Debe usarse DESPUÉS de verificarToken.
 */
const soloAdmin = (req, res, next) => {
  if (req.usuario?.tipoUsuario !== 'admin') {
    return res.status(403).json({ ok: false, mensaje: 'Acceso restringido a administradores' });
  }
  next();
};

/**
 * Middleware para permitir acceso al propio cliente O a un admin.
 * Útil para que un cliente vea/cancele solo sus propias citas.
 * Se asume que el clienteId de la cita viene en req.params.clienteId o en req.body.clienteId.
 */
const propioClienteOAdmin = (req, res, next) => {
  const tipoUsuario = req.usuario?.tipoUsuario;
  const usuarioId = req.usuario?.id;

  // Admins y barberos pasan siempre
  if (tipoUsuario === 'admin' || tipoUsuario === 'barbero') return next();

  // El cliente solo puede operar sobre sus propios recursos
  const clienteIdParam = req.params.clienteId || req.body.clienteId;
  if (usuarioId && clienteIdParam && usuarioId === clienteIdParam) return next();

  return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para esta operación' });
};

module.exports = { verificarToken, soloAdmin, propioClienteOAdmin };
