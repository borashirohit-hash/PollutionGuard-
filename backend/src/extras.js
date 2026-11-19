const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { PoliceStation, Complaint, RewardRequest, User } = require('./models');
const { auth, allow, audit } = require('./auth');
const { isOverdue } = require('./workflow');
const { runSlaSweep } = require('./sla');
const { scopeFilter } = require('./routes');
const { sortNearbyStations } = require('./geo');

const router = express.Router();
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch((e) => res.status(e.status || 500).json({ error: e.message }));
const staff = [auth, allow('admin', 'rto', 'officer')];

const evidenceUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, 'ev-' + crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG/PNG/WEBP images allowed')),
});

// ---- Public nearby-station finder. Results come only from admin-configured station records. ----
router.get('/nearby-stations', wrap(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const radiusKm = Math.min(Math.max(Number(req.query.radiusKm) || 25, 1), 100);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  const stations = await PoliceStation.find({
    latitude: { $gte: -90, $lte: 90 }, longitude: { $gte: -180, $lte: 180 },
  }).lean();
  const results = sortNearbyStations(stations, lat, lng, radiusKm, 20);
  res.json({ source: 'admin-configured station dataset', radiusKm, count: results.length, stations: results,
    message: results.length ? undefined : 'No configured police stations with coordinates were found in this radius.' });
}));

// ---- Police stations (configured jurisdiction list) ----
router.get('/stations', staff, wrap(async (req, res) =>
  res.json(await PoliceStation.find(req.query.district ? { district: req.query.district } : {}).sort('district name'))));

router.post('/admin/stations', auth, allow('admin'), wrap(async (req, res) => {
  const { name, district, area, latitude, longitude } = req.body;
  if (!name || !district) return res.status(400).json({ error: 'name and district required' });
  const s = await PoliceStation.create({ name, district, area, latitude, longitude });
  audit(req, 'create_station', 'PoliceStation', s._id, { name });
  res.status(201).json(s);
}));

router.delete('/admin/stations/:id', auth, allow('admin'), wrap(async (req, res) => {
  await PoliceStation.findByIdAndDelete(req.params.id);
  audit(req, 'delete_station', 'PoliceStation', req.params.id);
  res.json({ ok: true });
}));

// ---- Reward / recognition review (policy-governed; never guaranteed) ----
router.patch('/admin/rewards/:id', auth, allow('admin'), wrap(async (req, res) => {
  const { eligibilityStatus, reviewStatus, decisionRemarks } = req.body;
  const patch = {};
  if (eligibilityStatus !== undefined) patch.eligibilityStatus = eligibilityStatus;
  if (reviewStatus !== undefined) patch.reviewStatus = reviewStatus;
  if (decisionRemarks !== undefined) patch.decisionRemarks = decisionRemarks;
  const r = await RewardRequest.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (!r) return res.status(404).json({ error: 'Not found' });
  audit(req, 'review_reward', 'RewardRequest', r._id, patch);
  res.json(r);
}));

// ---- SLA sweep on demand (also runs hourly) ----
router.post('/admin/sla-sweep', auth, allow('admin'), wrap(async (req, res) => res.json(await runSlaSweep())));

// ---- Officer evidence attachment ----
router.post('/complaints/:id/evidence', auth, allow('officer'), evidenceUpload.single('image'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  const c = await Complaint.findOne({ complaintId: req.params.id, assignedOfficerId: req.user._id });
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.evidenceFiles.push(req.file.filename);
  await c.save();
  audit(req, 'attach_evidence', 'Complaint', c.complaintId);
  res.status(201).json({ file: req.file.filename });
}));

router.get('/complaints/:id/evidence/:file', staff, wrap(async (req, res) => {
  const c = await Complaint.findOne({ complaintId: req.params.id, ...scopeFilter(req.user) });
  const file = path.basename(req.params.file);
  if (!c || !c.evidenceFiles.includes(file)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(UPLOAD_DIR, file));
}));

// ---- Map data ----
router.get('/map', staff, wrap(async (req, res) => {
  const list = await Complaint.find({ ...scopeFilter(req.user), latitude: { $exists: true, $ne: null } }).select('complaintId latitude longitude status district vehicleNumber slaDueAt');
  const stations = await PoliceStation.find({ latitude: { $exists: true, $ne: null } });
  res.json({
    complaints: list.map((c) => ({ complaintId: c.complaintId, latitude: c.latitude, longitude: c.longitude, status: c.status, district: c.district, vehicleNumber: c.vehicleNumber, overdue: isOverdue(c) })),
    stations,
  });
}));

// ---- Officer-wise / RTO-wise statistics ----
router.get('/stats/breakdown', auth, allow('admin', 'rto'), wrap(async (req, res) => {
  const list = await Complaint.find(scopeFilter(req.user));
  const users = await User.find({ role: { $in: ['officer', 'rto'] } }).select('name role');
  const name = (id) => users.find((u) => String(u._id) === String(id))?.name || 'Unassigned';
  const officers = {}; const rtos = {};
  const done = (c) => ['Resolved', 'Closed'].includes(c.status);
  list.forEach((c) => {
    if (c.assignedOfficerId) { const k = name(c.assignedOfficerId); officers[k] = officers[k] || { assigned: 0, completed: 0 }; officers[k].assigned++; if (done(c)) officers[k].completed++; }
    if (c.assignedRtoId) { const k = name(c.assignedRtoId); rtos[k] = rtos[k] || { handled: 0, resolved: 0 }; rtos[k].handled++; if (done(c)) rtos[k].resolved++; }
  });
  res.json({ officers, rtos });
}));

// ---- PDF report ----
router.get('/reports/complaints.pdf', auth, allow('admin', 'rto'), wrap(async (req, res) => {
  const list = await Complaint.find(scopeFilter(req.user)).sort('-submittedAt').limit(500);
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="complaints.pdf"');
  doc.pipe(res);
  const logoPath = path.resolve(__dirname, '../../assets_logo.png');
  if (fs.existsSync(logoPath)) doc.image(logoPath, 40, 34, { fit: [54, 54] });
  doc.fillColor('#0f766e').fontSize(18).text('POLLUTIONGUARD AI', 105, 40, { continued: false });
  doc.fillColor('#334155').fontSize(11).text('Vehicle Pollution Complaint Report', 105, 64);
  doc.moveDown(2);
  doc.fontSize(9).fillColor('#555').text(`Generated ${new Date().toISOString()} | Total: ${list.length} | Overdue: ${list.filter(isOverdue).length}`);
  doc.moveDown().fillColor('#000').fontSize(9);
  list.forEach((c) => {
    doc.text(`${c.complaintId} | ${c.vehicleNumber || '-'} | ${c.district || '-'} | ${c.status} | due ${c.slaDueAt ? c.slaDueAt.toISOString().slice(0, 10) : '-'}${isOverdue(c) ? ' | OVERDUE' : ''}`);
  });
  doc.moveDown().fontSize(8).fillColor('#555').text('AI results and complaint data are supporting information, not legal proof.');
  doc.end();
  audit(req, 'export_report', 'Report', 'complaints.pdf');
}));

module.exports = router;
