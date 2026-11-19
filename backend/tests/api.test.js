process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/pg-test-uploads';
process.env.AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const M = require('../src/models');
const { runSlaSweep } = require('../src/sla');

// 1x1 valid PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const api = request(app);
const S = {}; // shared state across ordered tests

async function login(email) {
  const r = await api.post('/api/auth/login').send({ email, password: 'Password@123' });
  assert.equal(r.status, 200, 'login ' + email);
  return { Authorization: 'Bearer ' + r.body.token };
}
const submit = (fields = {}, headers = {}) => {
  let r = api.post('/api/complaints');
  Object.entries(headers).forEach(([k, v]) => (r = r.set(k, v)));
  Object.entries({ district: 'Bhopal', locationDescription: 'MP Nagar', latitude: '23.23', longitude: '77.43', ...fields }).forEach(([k, v]) => (r = r.field(k, v)));
  return r.attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
};

test.before(async () => {
  await mongoose.connect(process.env.MONGO_TEST_URI || 'mongodb://127.0.0.1:27017/pg_test');
  await mongoose.connection.dropDatabase();
  const passwordHash = await bcrypt.hash('Password@123', 4);
  await M.User.create([
    { name: 'Admin', email: 'admin@t.in', role: 'admin', passwordHash },
    { name: 'RTO', email: 'rto@t.in', role: 'rto', district: 'Bhopal', passwordHash },
    { name: 'Off1', email: 'o1@t.in', role: 'officer', district: 'Bhopal', passwordHash },
    { name: 'Off2', email: 'o2@t.in', role: 'officer', district: 'Bhopal', passwordHash },
    { name: 'Cit', email: 'c@t.in', role: 'citizen', passwordHash },
  ]);
  S.admin = await login('admin@t.in'); S.rto = await login('rto@t.in');
  S.o1 = await login('o1@t.in'); S.o2 = await login('o2@t.in'); S.cit = await login('c@t.in');
});
test.after(async () => { await mongoose.disconnect(); });

test('auth: bad password rejected, citizen registration works, short password rejected', async () => {
  assert.equal((await api.post('/api/auth/login').send({ email: 'admin@t.in', password: 'nope' })).status, 401);
  assert.equal((await api.post('/api/auth/register').send({ name: 'N', email: 'n@t.in', password: 'short' })).status, 400);
  const r = await api.post('/api/auth/register').send({ name: 'New', email: 'new@t.in', password: 'Password@123' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'citizen');
  assert.equal((await api.post('/api/auth/register').send({ name: 'New', email: 'new@t.in', password: 'Password@123' })).status, 409);
});

test('submission validation: missing image, bad vehicle number, non-image file', async () => {
  assert.equal((await api.post('/api/complaints').field('district', 'Bhopal')).status, 400);
  assert.equal((await submit({ vehicleNumber: '!!' })).status, 400);
  const r = await api.post('/api/complaints').attach('image', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' });
  assert.equal(r.status, 400);
});

test('anonymous submission calls the real AI service and returns ID + PIN', async () => {
  const r = await submit({ vehicleNumber: 'mp04 ab 1234', rewardRequested: 'true' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.complaintId, /^PG\d{4}[0-9A-F]{6}$/);
  assert.match(r.body.trackingPin, /^\d{6}$/);
  assert.equal(r.body.ai.success, true, 'AI service must respond: ' + JSON.stringify(r.body.ai));
  assert.equal(r.body.ai.review_required, true);
  S.id = r.body.complaintId; S.pin = r.body.trackingPin;
  const c = await M.Complaint.findOne({ complaintId: S.id }).select('+reporterId');
  assert.equal(c.vehicleNumber, 'MP04AB1234');
  assert.equal(c.reporterId, undefined, 'anonymous: no reporter stored');
  assert.ok(c.slaDueAt > new Date());
  assert.equal(await M.RewardRequest.countDocuments({ complaintId: S.id }), 1);
});

test('manual location fallback: district and description permit complaint without GPS', async () => {
  const r = await api.post('/api/complaints').field('vehicleNumber', 'MP04AB5678')
    .field('district', 'Ratlam').field('locationDescription', 'Near bus stand')
    .field('locationType', 'manual');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = await M.Complaint.findOne({ complaintId: r.body.complaintId });
  assert.equal(c.district, 'Ratlam');
  assert.equal(c.locationType, 'manual');
  assert.equal(c.latitude, undefined);
  assert.equal(c.longitude, undefined);
});

test('tracking: correct PIN works, wrong PIN fails, no identity or evidence leaked', async () => {
  assert.equal((await api.post('/api/track').send({ complaintId: S.id, pin: '000000' })).status, 404);
  const r = await api.post('/api/track').send({ complaintId: S.id, pin: S.pin });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'Submitted');
  assert.equal(r.body.history.length, 1);
  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes('reporter') && !raw.includes('imageReference') && !raw.includes('PinHash'));
});

test('logged-in citizen: non-anonymous complaint is listed, anonymous one is not', async () => {
  const a = await submit({ anonymous: 'false' }, S.cit);
  const b = await submit({ anonymous: 'true' }, S.cit);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  const my = await api.get('/api/my-complaints').set(S.cit);
  const ids = my.body.map((x) => x.complaintId);
  assert.ok(ids.includes(a.body.complaintId)); assert.ok(!ids.includes(b.body.complaintId));
});

test('access control: staff endpoints need auth and correct role', async () => {
  assert.equal((await api.get('/api/complaints')).status, 401);
  assert.equal((await api.get('/api/complaints').set({ Authorization: 'Bearer garbage' })).status, 401);
  assert.equal((await api.get('/api/complaints').set(S.cit)).status, 403);
  assert.equal((await api.get('/api/admin/users').set(S.rto)).status, 403);
  assert.equal((await api.get('/api/admin/audit').set(S.o1)).status, 403);
  assert.equal((await api.post(`/api/complaints/${S.id}/assign`).set(S.o1).send({})).status, 403);
  assert.equal((await api.get(`/api/complaints/${S.id}/image`).set(S.cit)).status, 403);
});

test('RTO sees complaint without reporter identity; evidence image is served to staff', async () => {
  const r = await api.get(`/api/complaints/${S.id}`).set(S.rto);
  assert.equal(r.status, 200);
  assert.equal(r.body.reporterId, undefined);
  assert.equal(r.body.trackingPinHash, undefined);
  const img = await api.get(`/api/complaints/${S.id}/image`).set(S.rto);
  assert.equal(img.status, 200);
  assert.match(img.headers['content-type'], /image\/png/);
});

test('workflow: invalid transitions blocked, reject needs remarks', async () => {
  assert.equal((await api.post(`/api/complaints/${S.id}/status`).set(S.rto).send({ status: 'Closed' })).status, 400);
  assert.equal((await api.post(`/api/complaints/${S.id}/status`).set(S.rto).send({ status: 'Verified' })).status, 400);
  assert.equal((await api.post(`/api/complaints/${S.id}/status`).set(S.rto).send({ status: 'Rejected' })).status, 400);
  assert.equal((await api.post(`/api/complaints/${S.id}/status`).set(S.rto).send({ status: 'Under Review' })).status, 200);
  assert.equal((await api.post(`/api/complaints/${S.id}/status`).set(S.rto).send({ status: 'Verified' })).status, 200);
});

test('assignment: station list enforced, officer scoping, reassignment', async () => {
  const st = await api.post('/api/admin/stations').set(S.admin).send({ name: 'MP Nagar PS', district: 'Bhopal', latitude: 23.23, longitude: 77.43 });
  assert.equal(st.status, 201);
  assert.equal((await api.post('/api/admin/stations').set(S.rto).send({ name: 'x', district: 'y' })).status, 403);
  assert.equal((await api.get('/api/stations').set(S.rto)).body.length, 1);
  const officers = (await api.get('/api/officers').set(S.rto)).body;
  const o1 = officers.find((o) => o.name === 'Off1'), o2 = officers.find((o) => o.name === 'Off2');
  assert.equal((await api.post(`/api/complaints/${S.id}/assign`).set(S.rto).send({ officerId: o1._id, policeStation: 'Fake PS' })).status, 400);
  assert.equal((await api.post(`/api/complaints/${S.id}/assign`).set(S.rto).send({ officerId: 'bad' })).status, 400);
  let r = await api.post(`/api/complaints/${S.id}/assign`).set(S.rto).send({ officerId: o1._id, policeStation: 'MP Nagar PS', priority: 'high' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'Assigned to Officer');
  // officer scoping
  assert.equal((await api.get(`/api/complaints/${S.id}`).set(S.o1)).status, 200);
  assert.equal((await api.get(`/api/complaints/${S.id}`).set(S.o2)).status, 404);
  assert.equal((await api.get('/api/complaints').set(S.o2)).body.length, 0);
  // reassign to o2 then back to o1
  r = await api.post(`/api/complaints/${S.id}/assign`).set(S.rto).send({ officerId: o2._id, policeStation: 'MP Nagar PS' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await api.get(`/api/complaints/${S.id}`).set(S.o1)).status, 404);
  r = await api.post(`/api/complaints/${S.id}/assign`).set(S.rto).send({ officerId: o1._id, policeStation: 'MP Nagar PS' });
  assert.equal(r.status, 200);
  assert.equal(await M.Assignment.countDocuments({ complaintId: S.id }), 3);
  S.o1id = o1._id;
});

test('officer: cannot act on others, records inspection, attaches evidence, challan status', async () => {
  assert.equal((await api.post(`/api/complaints/${S.id}/action`).set(S.o2).send({ inspectionResult: 'x' })).status, 404);
  assert.equal((await api.post(`/api/complaints/${S.id}/action`).set(S.o1).send({})).status, 400);
  assert.equal((await api.post(`/api/complaints/${S.id}/status`).set(S.o1).send({ status: 'Closed' })).status, 403);
  const ev = await api.post(`/api/complaints/${S.id}/evidence`).set(S.o1).attach('image', PNG, { filename: 'e.png', contentType: 'image/png' });
  assert.equal(ev.status, 201);
  assert.equal((await api.get(`/api/complaints/${S.id}/evidence/${ev.body.file}`).set(S.rto)).status, 200);
  assert.equal((await api.get(`/api/complaints/${S.id}/evidence/../../etc/passwd`).set(S.rto)).status, 404);
  const r = await api.post(`/api/complaints/${S.id}/action`).set(S.o1).send({
    inspectionResult: 'Smoke observed, PUC expired', actionTaken: 'Notice issued', challanReference: 'CH-1', challanStatus: 'Issued in official system', complianceObservation: 'Non-compliant' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'Challan Status Updated');
  const d = await api.get(`/api/complaints/${S.id}`).set(S.rto);
  assert.equal(d.body.resolutionDetails.challanReference, 'CH-1');
  assert.equal(d.body.evidenceFiles.length, 1);
});

test('RTO notified of action; closure produces Resolved then Closed with full history', async () => {
  const notes = await api.get('/api/notifications').set(S.rto);
  assert.ok(notes.body.some((n) => n.complaintId === S.id && n.title === 'Action report'));
  const c = await api.post(`/api/complaints/${S.id}/close`).set(S.rto).send({ remarks: 'Reviewed' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.status, 'Closed');
  const t = await api.post('/api/track').send({ complaintId: S.id, pin: S.pin });
  assert.deepEqual(t.body.history.map((h) => h.status),
    ['Submitted', 'Under Review', 'Verified', 'Assigned to Officer', 'Assigned to Officer', 'Assigned to Officer', 'Inspection Pending', 'Inspection Completed', 'Action Taken', 'Challan Status Updated', 'Resolved', 'Closed']);
  assert.equal((await api.post(`/api/complaints/${S.id}/status`).set(S.rto).send({ status: 'Under Review' })).status, 400);
});

test('reject path with remarks notifies logged-in reporter', async () => {
  const s = await submit({ anonymous: 'false' }, S.cit);
  await api.post(`/api/complaints/${s.body.complaintId}/status`).set(S.rto).send({ status: 'Under Review' });
  const r = await api.post(`/api/complaints/${s.body.complaintId}/status`).set(S.rto).send({ status: 'Rejected', remarks: 'Image unclear' });
  assert.equal(r.status, 200);
  const n = await api.get('/api/notifications').set(S.cit);
  assert.ok(n.body.some((x) => x.message.includes('Rejected')));
  await api.post('/api/notifications/read').set(S.cit);
  assert.ok((await api.get('/api/notifications').set(S.cit)).body.every((x) => x.readStatus));
});

test('SLA: overdue detection, escalation to admin once, configurable days', async () => {
  const s = await submit({});
  const id = s.body.complaintId;
  await M.Complaint.updateOne({ complaintId: id }, { slaDueAt: new Date(Date.now() - 86400000) });
  const od = await api.get('/api/complaints?overdue=true').set(S.admin);
  assert.ok(od.body.some((c) => c.complaintId === id && c.overdue));
  const r1 = await api.post('/api/admin/sla-sweep').set(S.admin);
  assert.equal(r1.status, 200); assert.ok(r1.body.escalated >= 1);
  assert.equal((await M.Complaint.findOne({ complaintId: id })).escalated, true);
  const n = await api.get('/api/notifications').set(S.admin);
  assert.ok(n.body.some((x) => x.title === 'Escalation' && x.complaintId === id));
  const r2 = await runSlaSweep();
  assert.equal(r2.escalated, 0, 'no repeat escalation');
  assert.equal((await api.put('/api/admin/settings').set(S.admin).send({ slaDays: 0 })).status, 400);
  assert.equal((await api.put('/api/admin/settings').set(S.admin).send({ slaDays: 5 })).status, 200);
  const s2 = await submit({});
  const due = new Date((await M.Complaint.findOne({ complaintId: s2.body.complaintId })).slaDueAt);
  assert.ok(Math.abs(due - Date.now() - 5 * 86400000) < 60000);
});

test('stats, breakdown, search/filter (regex-safe), CSV, PDF, map', async () => {
  const st = await api.get('/api/stats').set(S.admin);
  assert.ok(st.body.total >= 6 && st.body.byStatus.Closed >= 1 && st.body.overdue >= 1);
  assert.ok(st.body.avgResolutionDays !== null);
  const bd = await api.get('/api/stats/breakdown').set(S.admin);
  assert.equal(bd.body.officers.Off1.completed, 1);
  assert.equal((await api.get('/api/stats/breakdown').set(S.o1)).status, 403);
  assert.ok((await api.get('/api/complaints?search=MP04AB').set(S.admin)).body.length >= 1);
  assert.equal((await api.get('/api/complaints?search=(((').set(S.admin)).status, 200);
  assert.ok((await api.get('/api/complaints?status=Closed').set(S.admin)).body.every((c) => c.status === 'Closed'));
  const csv = await api.get('/api/reports/complaints.csv').set(S.admin);
  assert.equal(csv.status, 200); assert.match(csv.text, /^complaintId,/); assert.ok(csv.text.split('\n').length >= 7);
  assert.equal((await api.get('/api/reports/complaints.csv').set(S.o1)).status, 403);
  const pdf = await api.get('/api/reports/complaints.pdf').set(S.admin).buffer(true).parse((res, cb) => { const d = []; res.on('data', (x) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.slice(0, 4).toString(), '%PDF');
  const map = await api.get('/api/map').set(S.rto);
  assert.ok(map.body.complaints.length >= 1 && map.body.stations.length === 1);
});

test('admin: user create/disable blocks login, audit log records actions, reward review', async () => {
  const cr = await api.post('/api/admin/users').set(S.admin).send({ name: 'Temp', email: 'temp@t.in', password: 'Password@123', role: 'officer', district: 'Indore' });
  assert.equal(cr.status, 201);
  assert.equal((await api.post('/api/admin/users').set(S.admin).send({ name: 'X', email: 'x@t.in', password: 'Password@123', role: 'god' })).status, 400);
  await login('temp@t.in');
  assert.equal((await api.patch(`/api/admin/users/${cr.body.id}`).set(S.admin).send({ accountStatus: 'disabled' })).status, 200);
  assert.equal((await api.post('/api/auth/login').send({ email: 'temp@t.in', password: 'Password@123' })).status, 401);
  const audit = await api.get('/api/admin/audit').set(S.admin);
  const actions = audit.body.map((a) => a.action);
  for (const a of ['login', 'assign', 'status_change', 'officer_action', 'create_user', 'update_user', 'export_report']) assert.ok(actions.includes(a), 'audit has ' + a);
  const rw = await api.get('/api/admin/rewards').set(S.admin);
  assert.equal(rw.body.length, 1);
  const up = await api.patch(`/api/admin/rewards/${rw.body[0]._id}`).set(S.admin).send({ reviewStatus: 'reviewed', eligibilityStatus: 'not-eligible', decisionRemarks: 'Policy not yet approved' });
  assert.equal(up.status, 200); assert.equal(up.body.reviewStatus, 'reviewed');
});
