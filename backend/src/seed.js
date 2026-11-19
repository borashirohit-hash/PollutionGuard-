require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./models');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pollutionguard');
  const hash = await bcrypt.hash('Password@123', 10);
  const demo = [
    { name: 'System Admin', email: 'admin@pg.in', role: 'admin' },
    { name: 'RTO Bhopal', email: 'rto@pg.in', role: 'rto', district: 'Bhopal' },
    { name: 'Officer Sharma', email: 'officer@pg.in', role: 'officer', district: 'Bhopal', assignedArea: 'Bhopal Central' },
  ];
  for (const d of demo) await User.findOneAndUpdate({ email: d.email }, { ...d, passwordHash: hash }, { upsert: true });
  console.log('Seeded demo accounts (password: Password@123)');
  process.exit(0);
})();
