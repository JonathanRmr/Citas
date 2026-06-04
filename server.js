require('dotenv').config();

const app = require('./src/app');
const conectarDB = require('./src/config/db');

const PORT = process.env.PORT || 4003;

// Primero conecta a la BD, luego levanta el servidor
conectarDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Módulo de citas escuchando en el puerto ${PORT}`);
  });
});
