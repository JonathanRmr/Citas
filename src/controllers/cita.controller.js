const Cita = require('../models/cita.model');

/**
 * Controlador de Citas.
 * Todas las respuestas usan el formato consistente: { ok, data | mensaje, ... }
 */

// ─────────────────────────────────────────────
// CREATE — Agendar una nueva cita
// ─────────────────────────────────────────────
const crearCita = async (req, res) => {
  try {
    const {
      clienteId,
      barberoId,
      servicioId,
      nombreServicio,
      precioServicio,
      duracionMinutos,
      fechaHora,
      notas,
    } = req.body;

    // Verificar que no exista traslape de horario para el mismo barbero
    const fechaInicio = new Date(fechaHora);
    const fechaFin = new Date(fechaInicio.getTime() + duracionMinutos * 60000);

    const traslape = await Cita.findOne({
      barberoId,
      estado: { $in: ['pendiente', 'confirmada'] },
      $or: [
        // Nueva cita empieza dentro de una existente
        { fechaHora: { $lt: fechaFin }, $expr: {
          $gt: [
            { $add: ['$fechaHora', { $multiply: ['$duracionMinutos', 60000] }] },
            fechaInicio,
          ],
        }},
      ],
    });

    if (traslape) {
      return res.status(409).json({
        ok: false,
        mensaje: 'El barbero ya tiene una cita en ese horario',
        citaExistente: {
          id: traslape._id,
          fechaHora: traslape.fechaHora,
          duracionMinutos: traslape.duracionMinutos,
        },
      });
    }

    const cita = await Cita.create({
      clienteId,
      barberoId,
      servicioId,
      nombreServicio,
      precioServicio,
      duracionMinutos,
      fechaHora: fechaInicio,
      notas,
    });

    return res.status(201).json({ ok: true, data: cita });
  } catch (error) {
    return res
      .status(400)
      .json({ ok: false, mensaje: 'No se pudo crear la cita', error: error.message });
  }
};

// ─────────────────────────────────────────────
// READ — Listar citas con filtros y paginación
// ─────────────────────────────────────────────
const obtenerCitas = async (req, res) => {
  try {
    const {
      clienteId,
      barberoId,
      estado,
      desde,    // fecha ISO de inicio del rango
      hasta,    // fecha ISO de fin del rango
      page = 1,
      limit = 10,
    } = req.query;

    const filtro = {};
    if (clienteId) filtro.clienteId = clienteId;
    if (barberoId) filtro.barberoId = barberoId;
    if (estado)    filtro.estado = estado;

    if (desde || hasta) {
      filtro.fechaHora = {};
      if (desde) filtro.fechaHora.$gte = new Date(desde);
      if (hasta) filtro.fechaHora.$lte = new Date(hasta);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [citas, total] = await Promise.all([
      Cita.find(filtro).sort({ fechaHora: 1 }).skip(skip).limit(Number(limit)),
      Cita.countDocuments(filtro),
    ]);

    return res.json({
      ok: true,
      data: citas,
      paginacion: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPaginas: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, mensaje: 'Error al obtener citas', error: error.message });
  }
};

// ─────────────────────────────────────────────
// READ — Obtener una cita por ID
// ─────────────────────────────────────────────
const obtenerCitaPorId = async (req, res) => {
  try {
    const cita = await Cita.findById(req.params.id);
    if (!cita) {
      return res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
    }
    return res.json({ ok: true, data: cita });
  } catch (error) {
    return res.status(400).json({ ok: false, mensaje: 'ID inválido', error: error.message });
  }
};

// ─────────────────────────────────────────────
// UPDATE — Actualizar datos generales de una cita
// (solo si está en estado 'pendiente')
// ─────────────────────────────────────────────
const actualizarCita = async (req, res) => {
  try {
    const cita = await Cita.findById(req.params.id);
    if (!cita) {
      return res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
    }

    if (cita.estado !== 'pendiente') {
      return res.status(400).json({
        ok: false,
        mensaje: `No se puede modificar una cita en estado '${cita.estado}'`,
      });
    }

    // Campos permitidos para actualización general (no el estado)
    const camposPermitidos = [
      'barberoId', 'servicioId', 'nombreServicio',
      'precioServicio', 'duracionMinutos', 'fechaHora', 'notas',
    ];
    const actualizacion = {};
    camposPermitidos.forEach((campo) => {
      if (req.body[campo] !== undefined) actualizacion[campo] = req.body[campo];
    });

    const citaActualizada = await Cita.findByIdAndUpdate(
      req.params.id,
      actualizacion,
      { new: true, runValidators: true }
    );

    return res.json({ ok: true, data: citaActualizada });
  } catch (error) {
    return res
      .status(400)
      .json({ ok: false, mensaje: 'No se pudo actualizar la cita', error: error.message });
  }
};

// ─────────────────────────────────────────────
// DELETE — Eliminar una cita (hard delete, solo admin)
// ─────────────────────────────────────────────
const eliminarCita = async (req, res) => {
  try {
    const cita = await Cita.findByIdAndDelete(req.params.id);
    if (!cita) {
      return res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
    }
    return res.json({ ok: true, mensaje: 'Cita eliminada correctamente' });
  } catch (error) {
    return res
      .status(400)
      .json({ ok: false, mensaje: 'No se pudo eliminar la cita', error: error.message });
  }
};

// ─────────────────────────────────────────────
// PATCH — Confirmar una cita (pendiente → confirmada)
// ─────────────────────────────────────────────
const confirmarCita = async (req, res) => {
  try {
    const cita = await Cita.findById(req.params.id);
    if (!cita) {
      return res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
    }

    if (cita.estado !== 'pendiente') {
      return res.status(400).json({
        ok: false,
        mensaje: `Solo se pueden confirmar citas en estado 'pendiente'. Estado actual: '${cita.estado}'`,
      });
    }

    cita.estado = 'confirmada';
    await cita.save();

    return res.json({ ok: true, mensaje: 'Cita confirmada', data: cita });
  } catch (error) {
    return res
      .status(400)
      .json({ ok: false, mensaje: 'No se pudo confirmar la cita', error: error.message });
  }
};

// ─────────────────────────────────────────────
// PATCH — Cancelar una cita (pendiente | confirmada → cancelada)
// ─────────────────────────────────────────────
const cancelarCita = async (req, res) => {
  try {
    const { motivoCancelacion } = req.body;

    const cita = await Cita.findById(req.params.id);
    if (!cita) {
      return res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
    }

    if (!['pendiente', 'confirmada'].includes(cita.estado)) {
      return res.status(400).json({
        ok: false,
        mensaje: `No se puede cancelar una cita en estado '${cita.estado}'`,
      });
    }

    cita.estado = 'cancelada';
    cita.motivoCancelacion = motivoCancelacion || '';
    await cita.save();

    return res.json({ ok: true, mensaje: 'Cita cancelada', data: cita });
  } catch (error) {
    return res
      .status(400)
      .json({ ok: false, mensaje: 'No se pudo cancelar la cita', error: error.message });
  }
};

// ─────────────────────────────────────────────
// PATCH — Completar una cita (confirmada → completada)
// ─────────────────────────────────────────────
const completarCita = async (req, res) => {
  try {
    const cita = await Cita.findById(req.params.id);
    if (!cita) {
      return res.status(404).json({ ok: false, mensaje: 'Cita no encontrada' });
    }

    if (cita.estado !== 'confirmada') {
      return res.status(400).json({
        ok: false,
        mensaje: `Solo se pueden completar citas en estado 'confirmada'. Estado actual: '${cita.estado}'`,
      });
    }

    cita.estado = 'completada';
    await cita.save();

    return res.json({ ok: true, mensaje: 'Cita marcada como completada', data: cita });
  } catch (error) {
    return res
      .status(400)
      .json({ ok: false, mensaje: 'No se pudo completar la cita', error: error.message });
  }
};

module.exports = {
  crearCita,
  obtenerCitas,
  obtenerCitaPorId,
  actualizarCita,
  eliminarCita,
  confirmarCita,
  cancelarCita,
  completarCita,
};
