require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { User, Complaint, ComplaintHistory, Assignment, Notification, AuditLog, Setting } = require('./models');

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const districts = ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain'];
const statuses = ['Submitted', 'Under Review', 'Verified', 'Assigned to Officer', 'Inspection Pending',
  'Inspection Completed', 'Action Taken', 'Resolved', 'Closed', 'Rejected'];

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pollutionguard');
  const passwordHash = await bcrypt.hash(process.env.DEMO_PASSWORD || 'Password@123', 10);
  const accounts = [
    { name: 'Demo Admin', email: 'admin.demo@pg.in', role: 'admin' },
    { name: 'Demo RTO', email: 'rto.demo@pg.in', role: 'rto', district: 'Bhopal' },
    { name: 'Demo Officer', email: 'officer.demo@pg.in', role: 'officer', district: 'Bhopal', assignedArea: 'Demo Zone' },
    { name: 'Demo Citizen', email: 'citizen.demo@pg.in', role: 'citizen' },
  ];
  for (let i = 1; i <= 30; i++) accounts.push({ name: `Demo Citizen ${i}`, email: `citizen${i}@demo.pg.in`, role: 'citizen', district: districts[i % 5] });
  for (let i = 1; i <= 2; i++) accounts.push({ name: `Demo Admin ${i}`, email: `admin${i}@demo.pg.in`, role: 'admin' });
  for (let i = 1; i <= 5; i++) accounts.push({ name: `Demo RTO ${i}`, email: `rto${i}@demo.pg.in`, role: 'rto', district: districts[(i - 1) % 5] });
  for (let i = 1; i <= 15; i++) accounts.push({ name: `Demo Officer ${i}`, email: `officer${i}@demo.pg.in`, role: 'officer', district: districts[(i - 1) % 5], assignedArea: `Demo Area ${i}` });
  const users = [];
  for (const a of accounts) users.push(await User.findOneAndUpdate({ email: a.email },
    { $set: { ...a, passwordHash, accountStatus: 'active' } }, { upsert: true, new: true, setDefaultsOnInsert: true }));

  const citizenUsers = users.filter(u => u.role === 'citizen');
  const rtoUsers = users.filter(u => u.role === 'rto');
  const officerUsers = users.filter(u => u.role === 'officer');
  for (let i = 1; i <= 100; i++) {
    const complaintId = `PG-DEMO-2026-${String(i).padStart(4, '0')}`;
    const district = districts[(i - 1) % districts.length];
    const status = statuses[(i - 1) % statuses.length];
    const submittedAt = new Date(Date.now() - i * 86400000 / 2);
    const complaint = await Complaint.findOneAndUpdate({ complaintId }, { $set: {
      complaintId, trackingPinHash: sha('123456'), reporterId: citizenUsers[i % citizenUsers.length]._id,
      confidential: i % 7 === 0, demoData: true,
      vehicleNumber: `MP${String(4 + (i % 5)).padStart(2, '0')}AB${String(1000 + i).slice(-4)}`,
      locationDescription: `Demo incident area ${i}`, district, status,
      priority: i % 3 === 0 ? 'high' : (i % 3 === 1 ? 'normal' : 'low'),
      latitude: 23.2 + (i % 20) * 0.002, longitude: 77.3 + (i % 20) * 0.003,
      locationType: 'manual', aiAnalysis: { result: ['Low visual smoke indication', 'Medium visual smoke indication', 'High visual smoke indication'][i % 3], model: 'demo-placeholder', reviewRequired: true },
      ocrResult: { plateNumber: `MP${String(4 + (i % 5)).padStart(2, '0')}AB${String(1000 + i).slice(-4)}`, verificationStatus: 'Pending', demoPlaceholder: true },
      slaDueAt: new Date(submittedAt.getTime() + 7 * 86400000), submittedAt,
      ...(i % 10 >= 3 ? { assignedRtoId: rtoUsers[i % rtoUsers.length]._id } : {}),
      ...(i % 10 >= 3 ? { assignedOfficerId: officerUsers[i % officerUsers.length]._id, policeStation: 'Not configured - demo record' } : {}),
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    await ComplaintHistory.updateOne({ complaintId, newStatus: 'Submitted' }, { $setOnInsert: { complaintId, newStatus: 'Submitted', remarks: 'Seeded demonstration record', timestamp: submittedAt } }, { upsert: true });
    await ComplaintHistory.updateOne({ complaintId, newStatus: status }, { $setOnInsert: { complaintId, newStatus: status, remarks: 'Demo workflow state; not a real enforcement action', timestamp: submittedAt } }, { upsert: true });
    if (complaint.assignedOfficerId) await Assignment.updateOne({ complaintId, assignedTo: complaint.assignedOfficerId }, { $setOnInsert: { complaintId, assignedTo: complaint.assignedOfficerId, assignedBy: complaint.assignedRtoId, assignmentType: 'demo' } }, { upsert: true });
  }
  await Setting.findOneAndUpdate({ key: 'slaDays' }, { value: 7 }, { upsert: true });
  console.log(`Seed complete: ${accounts.length} demo accounts, 100 demo complaints. Demo tracking PIN: 123456.`);
  console.log('No police station records are fabricated; configure verified stations in Admin > Police stations.');
  await mongoose.disconnect();
})().catch(async e => { console.error(e); await mongoose.disconnect(); process.exit(1); });
