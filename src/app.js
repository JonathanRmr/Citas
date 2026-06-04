const express = require('express');
const cors = require('cors');

const citaRoutes = require('./routes/cita.routes');

const app = express();

// Middlewares globales
app.use(cors());
app.use(express.json());

// Ruta de salud (health check)
app.get('/api/salud', (req, res) => {
  res.json({ ok: true, servicio: 'modulo-citas', estado: 'activo' });
});

// Rutas del módulo
app.use('/api/citas', citaRoutes);

const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const YAML = require('js-yaml');

const swaggerDoc = YAML.load(fs.readFileSync('./src/docs/swagger.yaml', 'utf8'));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));

// Ruta no encontrada (404)
app.use((req, res) => {
  res.status(404).json({ ok: false, mensaje: 'Ruta no encontrada' });
});

module.exports = app;
