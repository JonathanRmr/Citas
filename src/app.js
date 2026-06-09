const express = require('express');
const cors = require('cors');
const path = require('path');

const citaRoutes = require('./routes/cita.routes');

const app = express();

// CORS con variable de entorno
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : '*';

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Health check — requerido por Render en esta ruta exacta
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Citas API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        serviciosUrl: process.env.SERVICIOS_URL || 'no configurado',
    });
});

// Mantener /api/salud por compatibilidad
app.get('/api/salud', (req, res) => {
    res.json({ ok: true, servicio: 'modulo-citas', estado: 'activo' });
});

// Rutas del módulo
app.use('/api/citas', citaRoutes);

// Swagger — usar path.join para que funcione independientemente
// del directorio de trabajo en producción
try {
    const swaggerUi = require('swagger-ui-express');
    const fs = require('fs');
    const YAML = require('js-yaml');
    const swaggerPath = path.join(__dirname, 'docs', 'swagger.yaml');
    const swaggerDoc = YAML.load(fs.readFileSync(swaggerPath, 'utf8'));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
    console.log('📄 Swagger disponible en /api/docs');
} catch (e) {
    console.warn('⚠️  Swagger no disponible:', e.message);
}

// 404 handler
app.use((req, res) => {
    res.status(404).json({ ok: false, mensaje: 'Ruta no encontrada' });
});

module.exports = app;