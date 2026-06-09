const Cita = require('../models/cita.model');

/**
 * Verifica si un horario solicitado se traslapa con alguna cita activa del barbero.
 *
 * Dos citas se traslapan cuando:
 *   inicio_A < fin_B  Y  fin_A > inicio_B
 *
 * Se usa aritmética en JS (no $expr en MongoDB) para evitar el bug de la
 * versión anterior que podía no evaluar correctamente el fin calculado.
 *
 * @param {string} barberoId
 * @param {Date}   fechaInicio  - inicio de la cita a crear/actualizar
 * @param {number} duracion     - duración en minutos
 * @param {string} [excluirId]  - ID de la cita actual (para no compararse consigo misma en updates)
 * @returns {object|null} la cita conflictiva o null si no hay traslape
 */
async function buscarTraslape(barberoId, fechaInicio, duracion, excluirId = null) {
  const fechaFin = new Date(fechaInicio.getTime() + duracion * 60000);

  // Traemos solo las citas activas del barbero en una ventana amplia
  // (±24h alrededor del inicio pedido) para no escanear toda la colección.
  const ventanaDesde = new Date(fechaInicio.getTime() - 24 * 60 * 60000);
  const ventanaHasta = new Date(fechaInicio.getTime() + 24 * 60 * 60000);

  const query = {
    barberoId,
    estado: { $in: ['pendiente', 'confirmada'] },
    fechaHora: { $gte: ventanaDesde, $lte: ventanaHasta },
  };
  if (excluirId) query._id = { $ne: excluirId };

  const citasActivas = await Cita.find(query).lean();

  for (const cita of citasActivas) {
    const inicioExistente = new Date(cita.fechaHora);
    const finExistente   = new Date(inicioExistente.getTime() + cita.duracionMinutos * 60000);

    // Condición de traslape: los rangos [A, B) y [C, D) se solapan si A < D && B > C
    const seSolapa = fechaInicio < finExistente && fechaFin > inicioExistente;
    if (seSolapa) return cita;
  }

  return null;
}

/**
 * Verifica que la fechaHora solicitada caiga dentro del horario activo
 * del barbero para ese día de la semana, y que no caiga en un descanso.
 *
 * El módulo de horarios vive en el módulo admin. Lo consultamos vía HTTP
 * usando ADMIN_URL (variable de entorno). Si la variable no está definida
 * o la consulta falla, se omite la validación (fail-open) para no bloquear
 * el sistema si el módulo admin está dormido en Render.
 *
 * @param {string} barberoId
 * @param {Date}   fechaInicio
 * @param {number} duracion  - en minutos (para verificar que la cita entera cabe)
 * @returns {{ valido: boolean, mensaje?: string }}
 */
async function verificarHorarioBarbero(barberoId, fechaInicio, duracion) {
  const adminUrl = process.env.ADMIN_URL;
  if (!adminUrl) return { valido: true }; // sin configurar → omitir validación

  try {
    const diaSemana = fechaInicio.getDay(); // 0=Dom … 6=Sáb
    const url = `${adminUrl}/api/admin/horarios/barberos?barberoId=${barberoId}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return { valido: true }; // error al consultar → omitir

    const json = await resp.json();
    const horarios = json.data || [];

    // Buscar el horario para ese día de la semana
    const horarioDia = horarios.find(
      (h) => h.diaSemana === diaSemana && h.activo !== false
    );

    if (!horarioDia) {
      return {
        valido: false,
        mensaje: `El barbero no trabaja ese día (${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][diaSemana]})`,
      };
    }

    // Convertir horaInicio/horaFin ("HH:mm") a minutos desde medianoche
    const toMin = (hhmm) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };

    const citaInicioMin = fechaInicio.getHours() * 60 + fechaInicio.getMinutes();
    const citaFinMin    = citaInicioMin + duracion;
    const turnoInicioMin = toMin(horarioDia.horaInicio);
    const turnoFinMin    = toMin(horarioDia.horaFin);

    if (citaInicioMin < turnoInicioMin || citaFinMin > turnoFinMin) {
      return {
        valido: false,
        mensaje: `La cita está fuera del horario del barbero (${horarioDia.horaInicio} – ${horarioDia.horaFin})`,
      };
    }

    // Verificar que la cita no caiga en un descanso
    for (const descanso of (horarioDia.descansos || [])) {
      const descansoInicioMin = toMin(descanso.inicio);
      const descansoFinMin    = toMin(descanso.fin);

      // Traslape entre cita y descanso
      if (citaInicioMin < descansoFinMin && citaFinMin > descansoInicioMin) {
        return {
          valido: false,
          mensaje: `La cita coincide con el descanso del barbero (${descanso.inicio} – ${descanso.fin})`,
        };
      }
    }

    return { valido: true };
  } catch {
    // Timeout u otro error de red → omitir validación (fail-open)
    return { valido: true };
  }
}

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

    if (!clienteId || !barberoId || !servicioId || !fechaHora || !duracionMinutos) {
      return res.status(400).json({
        ok: false,
        mensaje: 'clienteId, barberoId, servicioId, fechaHora y duracionMinutos son obligatorios',
      });
    }

    const fechaInicio = new Date(fechaHora);
    if (isNaN(fechaInicio.getTime())) {
      return res.status(400).json({ ok: false, mensaje: 'fechaHora no es una fecha válida' });
    }

    // 1. Verificar que la cita esté dentro del horario del barbero
    const horario = await verificarHorarioBarbero(barberoId, fechaInicio, duracionMinutos);
    if (!horario.valido) {
      return res.status(400).json({ ok: false, mensaje: horario.mensaje });
    }

    // 2. Verificar traslape con otras citas del mismo barbero
    const traslape = await buscarTraslape(barberoId, fechaInicio, duracionMinutos);
    if (traslape) {
      const finTraslape = new Date(
        new Date(traslape.fechaHora).getTime() + traslape.duracionMinutos * 60000
      );
      return res.status(409).json({
        ok: false,
        mensaje: 'El barbero ya tiene una cita en ese horario',
        citaExistente: {
          id:              traslape._id,
          fechaHora:       traslape.fechaHora,
          duracionMinutos: traslape.duracionMinutos,
          finEstimado:     finTraslape,
          nombreServicio:  traslape.nombreServicio,
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
      desde,
      hasta,
      page  = 1,
      limit = 10,
    } = req.query;

    const filtro = {};
    if (clienteId) filtro.clienteId = clienteId;
    if (barberoId) filtro.barberoId = barberoId;
    if (estado)    filtro.estado    = estado;

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
        page:        Number(page),
        limit:       Number(limit),
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

    const camposPermitidos = [
      'barberoId', 'servicioId', 'nombreServicio',
      'precioServicio', 'duracionMinutos', 'fechaHora', 'notas',
    ];
    const actualizacion = {};
    camposPermitidos.forEach((campo) => {
      if (req.body[campo] !== undefined) actualizacion[campo] = req.body[campo];
    });

    // Si se cambia fecha/hora o duración, re-validar horario y traslapes
    const nuevaFecha    = actualizacion.fechaHora    ? new Date(actualizacion.fechaHora)    : cita.fechaHora;
    const nuevaDuracion = actualizacion.duracionMinutos ?? cita.duracionMinutos;
    const nuevoBarbero  = actualizacion.barberoId   ?? cita.barberoId;

    if (actualizacion.fechaHora || actualizacion.duracionMinutos || actualizacion.barberoId) {
      const horario = await verificarHorarioBarbero(nuevoBarbero, nuevaFecha, nuevaDuracion);
      if (!horario.valido) {
        return res.status(400).json({ ok: false, mensaje: horario.mensaje });
      }

      const traslape = await buscarTraslape(nuevoBarbero, nuevaFecha, nuevaDuracion, req.params.id);
      if (traslape) {
        const finTraslape = new Date(
          new Date(traslape.fechaHora).getTime() + traslape.duracionMinutos * 60000
        );
        return res.status(409).json({
          ok: false,
          mensaje: 'El barbero ya tiene una cita en ese horario',
          citaExistente: {
            id:              traslape._id,
            fechaHora:       traslape.fechaHora,
            duracionMinutos: traslape.duracionMinutos,
            finEstimado:     finTraslape,
            nombreServicio:  traslape.nombreServicio,
          },
        });
      }
    }

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