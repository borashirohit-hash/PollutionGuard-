require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const { runSlaSweep } = require('./sla');

const port = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pollutionguard').then(() => {
  app.listen(port, () => console.log('API on :' + port));
  setInterval(() => runSlaSweep().catch(console.error), 60 * 60 * 1000);
}).catch((e) => { console.error('Mongo connection failed', e.message); process.exit(1); });
