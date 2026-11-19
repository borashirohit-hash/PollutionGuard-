import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [sla, setSla] = useState(7);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'officer', district: '', assignedArea: '' });
  const [msg, setMsg] = useState('');
  const [stations, setStations] = useState([]);
  const [st, setSt] = useState({ name: '', district: '', area: '', latitude: '', longitude: '' });
  const [rewards, setRewards] = useState([]);

  const load = () => { api.stations().then(setStations); api.rewards().then(setRewards); api.users().then(setUsers); api.audit().then(setAudit); api.settings().then((s) => setSla(s.slaDays)); };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault(); setMsg('');
    try { await api.createUser(f); setF({ ...f, name: '', email: '', password: '' }); setMsg('User created'); load(); }
    catch (e2) { setMsg(e2.message); }
  };

  return (
    <>
      <form className="card" onSubmit={create}>
        <h3>Create account</h3>
        <div className="grid">
          <div><label htmlFor="adminpanel-f1">Name</label><input id="adminpanel-f1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          <div><label htmlFor="adminpanel-f2">Email</label><input id="adminpanel-f2" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></div>
          <div><label htmlFor="adminpanel-f3">Password (min 8)</label><input id="adminpanel-f3" type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></div>
          <div><label htmlFor="adminpanel-f4">Role</label><select id="adminpanel-f4" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option>rto</option><option>officer</option><option>admin</option><option>citizen</option></select></div>
          <div><label htmlFor="adminpanel-f5">District</label><input id="adminpanel-f5" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} /></div>
          <div><label htmlFor="adminpanel-f6">Assigned area</label><input id="adminpanel-f6" value={f.assignedArea} onChange={(e) => setF({ ...f, assignedArea: e.target.value })} /></div>
        </div>
        <button style={{ marginTop: 10 }}>Create</button> {msg && <span className="muted">{msg}</span>}
      </form>

      <form className="card" onSubmit={(e) => { e.preventDefault(); const b = { ...st, latitude: st.latitude === '' ? undefined : Number(st.latitude), longitude: st.longitude === '' ? undefined : Number(st.longitude) }; api.addStation(b).then(() => { setSt({ name: '', district: '', area: '', latitude: '', longitude: '' }); load(); }).catch((x) => setMsg(x.message)); }}>
        <h3>Police stations (jurisdiction list)</h3>
        <div className="grid">
          <div><label htmlFor="adminpanel-f7">Name</label><input id="adminpanel-f7" value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })} required /></div>
          <div><label htmlFor="adminpanel-f8">District</label><input id="adminpanel-f8" value={st.district} onChange={(e) => setSt({ ...st, district: e.target.value })} required /></div>
          <div><label htmlFor="adminpanel-f9">Area</label><input id="adminpanel-f9" value={st.area} onChange={(e) => setSt({ ...st, area: e.target.value })} /></div>
          <div><label htmlFor="adminpanel-f10">Latitude</label><input id="adminpanel-f10" value={st.latitude} onChange={(e) => setSt({ ...st, latitude: e.target.value })} /></div>
          <div><label htmlFor="adminpanel-f11">Longitude</label><input id="adminpanel-f11" value={st.longitude} onChange={(e) => setSt({ ...st, longitude: e.target.value })} /></div>
        </div>
        <button style={{ marginTop: 10 }}>Add station</button>
        <table style={{ marginTop: 10 }}><tbody>{stations.map((x) => <tr key={x._id}><td>{x.name}</td><td>{x.district}</td><td>{x.area}</td><td><button type="button" className="secondary" onClick={() => api.delStation(x._id).then(load)}>Remove</button></td></tr>)}</tbody></table>
      </form>

      <div className="card">
        <h3>Recognition requests</h3>
        <p className="muted">Subject to an approved policy. Nothing here guarantees a payment.</p>
        <table>
          <thead><tr><th>Complaint</th><th>Review</th><th>Eligibility</th><th /></tr></thead>
          <tbody>{rewards.map((r) => (
            <tr key={r._id}><td>{r.complaintId}</td><td>{r.reviewStatus}</td><td>{r.eligibilityStatus}</td>
              <td><button className="secondary" onClick={() => api.reviewReward(r._id, { reviewStatus: 'reviewed', eligibilityStatus: 'eligible', decisionRemarks: 'Reviewed by admin' }).then(load)}>Mark eligible</button>{' '}
                <button className="secondary" onClick={() => api.reviewReward(r._id, { reviewStatus: 'reviewed', eligibilityStatus: 'not-eligible', decisionRemarks: 'Reviewed by admin' }).then(load)}>Not eligible</button></td></tr>
          ))}{!rewards.length && <tr><td colSpan="4" className="muted">None</td></tr>}</tbody>
        </table>
      </div>

      <div className="card">
        <h3>SLA target (days)</h3>
        <div className="row"><input type="number" min="1" max="60" style={{ width: 100 }} value={sla} onChange={(e) => setSla(e.target.value)} /><button onClick={() => api.saveSettings({ slaDays: Number(sla) }).then(() => setMsg('SLA saved'))}>Save</button></div>
        <p className="muted">Applies to new complaints. Set per your authority's policy.</p>
        <button className="secondary" onClick={() => api.slaSweep().then((r) => setMsg(`Sweep done: ${r.overdue} overdue, ${r.escalated} newly escalated`))}>Run overdue / escalation check now</button>
      </div>

      <div className="card">
        <h3>Users</h3>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>District</th><th>Status</th><th /></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u._id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.district || '—'}</td><td>{u.accountStatus}</td>
              <td><button className="secondary" onClick={() => api.updateUser(u._id, { accountStatus: u.accountStatus === 'active' ? 'disabled' : 'active' }).then(load)}>{u.accountStatus === 'active' ? 'Disable' : 'Enable'}</button></td></tr>
          ))}</tbody>
        </table>
      </div>

      <div className="card">
        <h3>Audit log (latest 200)</h3>
        <table>
          <thead><tr><th>Time</th><th>Role</th><th>Action</th><th>Resource</th></tr></thead>
          <tbody>{audit.map((a) => (<tr key={a._id}><td>{new Date(a.timestamp).toLocaleString()}</td><td>{a.actorRole}</td><td>{a.action}</td><td>{a.resourceType} {a.resourceId}</td></tr>))}</tbody>
        </table>
      </div>
    </>
  );
}
