const express = require('express');
const router = express.Router();

const {
  crearCita,
  obtenerCitas,
  obtenerCitaPorId,
  actualizarCita,
  eliminarCita,
  confirmarCita,
  cancelarCita,
  completarCita,
} = require('../controllers/cita.controller');

const { verificarToken, soloAdmin } = require('../middlewares/auth.middleware');

// ──────────────────────────────────────────────────────
// CRUD base — todas requieren token
// ──────────────────────────────────────────────────────

// Listar citas (admin y barbero ven todo; el cliente filtra por su clienteId)
router.get('/', verificarToken, obtenerCitas);

// Ver una cita específica
router.get('/:id', verificarToken, obtenerCitaPorId);

// Agendar nueva cita (cualquier usuario autenticado)
router.post('/', verificarToken, crearCita);

// Actualizar datos de la cita (solo si está pendiente)
router.put('/:id', verificarToken, actualizarCita);

// Eliminar cita (solo admin — hard delete)
router.delete('/:id', verificarToken, soloAdmin, eliminarCita);

// ──────────────────────────────────────────────────────
// Acciones de estado — rutas PATCH semánticas
// ──────────────────────────────────────────────────────

// Confirmar cita: pendiente → confirmada (barbero o admin)
router.patch('/:id/confirmar', verificarToken, confirmarCita);

// Cancelar cita: pendiente|confirmada → cancelada (cliente dueño, barbero o admin)
router.patch('/:id/cancelar', verificarToken, cancelarCita);

// Completar cita: confirmada → completada (barbero o admin)
router.patch('/:id/completar', verificarToken, completarCita);

module.exports = router;
