const base = '/api';
const getToken = () => localStorage.getItem('pg_token');

async function req(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  login: (b) => req('/auth/login', { method: 'POST', body: b }),
  register: (b) => req('/auth/register', { method: 'POST', body: b }),
  me: () => req('/auth/me'),
  submit: (form) => req('/complaints', { method: 'POST', form }),
  validatePlatePhoto: (form) => req('/evidence/validate-plate', { method: 'POST', form }),
  track: (b) => req('/track', { method: 'POST', body: b }),
  list: (qs = '') => req('/complaints' + qs),
  get: (id) => req(`/complaints/${id}`),
  image: (id) => req(`/complaints/${id}/image`),
  setStatus: (id, b) => req(`/complaints/${id}/status`, { method: 'POST', body: b }),
  assign: (id, b) => req(`/complaints/${id}/assign`, { method: 'POST', body: b }),
  action: (id, b) => req(`/complaints/${id}/action`, { method: 'POST', body: b }),
  close: (id, b) => req(`/complaints/${id}/close`, { method: 'POST', body: b || {} }),
  stats: () => req('/stats'),
  officers: () => req('/officers'),
  notifications: () => req('/notifications'),
  readNotifications: () => req('/notifications/read', { method: 'POST' }),
  myComplaints: () => req('/my-complaints'),
  users: () => req('/admin/users'),
  createUser: (b) => req('/admin/users', { method: 'POST', body: b }),
  updateUser: (id, b) => req(`/admin/users/${id}`, { method: 'PATCH', body: b }),
  audit: () => req('/admin/audit'),
  settings: () => req('/admin/settings'),
  saveSettings: (b) => req('/admin/settings', { method: 'PUT', body: b }),
  csv: () => req('/reports/complaints.csv'),
  pdf: () => req('/reports/complaints.pdf'),
  stations: (d = '') => req('/stations' + (d ? `?district=${encodeURIComponent(d)}` : '')),
  nearbyStations: (lat, lng, radiusKm = 25) => req(`/nearby-stations?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radiusKm=${radiusKm}`),
  addStation: (b) => req('/admin/stations', { method: 'POST', body: b }),
  delStation: (id) => req(`/admin/stations/${id}`, { method: 'DELETE' }),
  rewards: () => req('/admin/rewards'),
  reviewReward: (id, b) => req(`/admin/rewards/${id}`, { method: 'PATCH', body: b }),
  slaSweep: () => req('/admin/sla-sweep', { method: 'POST' }),
  breakdown: () => req('/stats/breakdown'),
  map: () => req('/map'),
  addEvidence: (id, form) => req(`/complaints/${id}/evidence`, { method: 'POST', form }),
  evidenceImage: (id, file) => req(`/complaints/${id}/evidence/${file}`),
};
