const mongoose = require('mongoose');

/**
 * Modelo de Cita.
 *
 * Guarda referencias a IDs de otros microservicios (no hace populate cross-service).
 * - clienteId   → ID del usuario del módulo de usuarios
 * - servicioId  → ID del servicio del módulo de servicios
 * - barberoId   → ID del barbero/empleado (módulo de usuarios, rol barbero)
 */
const citaSchema = new mongoose.Schema(
  {
    clienteId: {
      type: String,
      required: [true, 'El ID del cliente es obligatorio'],
      trim: true,
    },
    barberoId: {
      type: String,
      required: [true, 'El ID del barbero es obligatorio'],
      trim: true,
    },
    servicioId: {
      type: String,
      required: [true, 'El ID del servicio es obligatorio'],
      trim: true,
    },

    // Snapshot del servicio al momento de agendar (evita inconsistencias si el precio cambia)
    nombreServicio: {
      type: String,
      required: [true, 'El nombre del servicio es obligatorio'],
      trim: true,
    },
    precioServicio: {
      type: Number,
      required: [true, 'El precio del servicio es obligatorio'],
      min: [0, 'El precio no puede ser negativo'],
    },
    duracionMinutos: {
      type: Number,
      required: [true, 'La duración del servicio es obligatoria'],
      min: [1, 'La duración debe ser al menos 1 minuto'],
    },

    // Fecha y hora de inicio de la cita
    fechaHora: {
      type: Date,
      required: [true, 'La fecha y hora de la cita son obligatorias'],
    },

    // Estado de la cita
    estado: {
      type: String,
      enum: {
        values: ['pendiente', 'confirmada', 'cancelada', 'completada'],
        message: 'Estado inválido. Valores permitidos: pendiente, confirmada, cancelada, completada',
      },
      default: 'pendiente',
    },

    // Razón de cancelación (solo aplica cuando estado === 'cancelada')
    motivoCancelacion: {
      type: String,
      trim: true,
      default: '',
    },

    // Notas adicionales del cliente o del barbero
    notas: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true } // agrega createdAt y updatedAt
);

// Índice compuesto para consultas de disponibilidad por barbero y fecha
citaSchema.index({ barberoId: 1, fechaHora: 1 });
// Índice para consultas por cliente
citaSchema.index({ clienteId: 1, fechaHora: -1 });

module.exports = mongoose.model('Cita', citaSchema);
