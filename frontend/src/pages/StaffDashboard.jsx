import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const STATUSES = ['', 'Submitted', 'Under Review', 'Verified', 'Rejected', 'Assigned to Officer', 'Inspection Pending', 'Inspection Completed', 'Action Taken', 'Challan Status Updated', 'Resolved', 'Closed', 'Returned for Clarification'];

export default function StaffDashboard({ user }) {
  const [stats, setStats] = useState(null);
  const [list, setList] = useState([]);
  const [q, setQ] = useState({ status: '', search: '', overdue: false });
  const [notes, setNotes] = useState([]);
  const [err, setErr] = useState('');
  const [bd, setBd] = useState(null);

  const load = () => {
    const p = new URLSearchParams();
    if (q.status) p.set('status', q.status);
    if (q.search) p.set('search', q.search);
    if (q.overdue) p.set('overdue', 'true');
    api.list('?' + p.toString()).then(setList).catch((e) => setErr(e.message));
  };
  useEffect(() => { api.stats().then(setStats).catch((e) => setErr(e.message)); api.notifications().then(setNotes); if (user.role !== 'officer') api.breakdown().then(setBd).catch(() => {}); }, []);
  useEffect(load, [q.status, q.overdue]);

  const exportCsv = async () => {
    const blob = await api.csv();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'complaints.csv'; a.click();
  };

  const exportPdf = async () => {
    const blob = await api.pdf();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'complaints.pdf'; a.click();
  };

  const unread = notes.filter((n) => !n.readStatus).length;
  return (
    <>
      <section className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
        <h2>{({ admin: 'Administration Control Center', rto: 'RTO Verification & Assignment Desk', officer: 'Field Enforcement Workspace' })[user.role]} {unread > 0 && <span className="badge warn">{unread} new notifications</span>}</h2>
        <p className="muted">{({ admin: 'Manage system operations, user access, audit activity and statewide monitoring.', rto: 'Review jurisdiction cases, verify evidence, assign field officers and monitor service deadlines.', officer: 'Work only on cases assigned to you, record field inspections and submit action reports for RTO review.' })[user.role]}</p>
      </section>
      {err && <div className="err">{err}</div>}
      {stats && (
        <div className="grid" style={{ marginBottom: 16 }}>
          <div className="stat"><b>{stats.total}</b>Total</div>
          <div className="stat"><b>{stats.pending}</b>Pending review</div>
          <div className="stat"><b>{(stats.byStatus['Assigned to Officer'] || 0) + (stats.byStatus['Inspection Pending'] || 0)}</b>In field</div>
          <div className="stat"><b>{(stats.byStatus.Resolved || 0) + (stats.byStatus.Closed || 0)}</b>Completed</div>
          <div className="stat"><b>{stats.byStatus.Rejected || 0}</b>Rejected</div>
          <div className="stat"><b style={{ color: stats.overdue ? 'var(--bad)' : undefined }}>{stats.overdue}</b>Overdue</div>
          <div className="stat"><b>{stats.avgResolutionDays == null ? '—' : stats.avgResolutionDays.toFixed(1)}</b>Avg days to resolve</div>
        </div>
      )}
      {stats && (
        <div className="card">
          <h3>Complaints by district / month</h3>
          <p className="muted">{Object.entries(stats.byDistrict).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'No data'}</p>
          <p className="muted">{Object.entries(stats.monthly).map(([k, v]) => `${k}: ${v}`).join(' · ') || ''}</p>
        </div>
      )}
      {bd && (
        <div className="card">
          <h3>Officer-wise &amp; RTO-wise</h3>
          <p className="muted">{Object.entries(bd.officers).map(([k, v]) => `${k}: ${v.assigned} assigned / ${v.completed} completed`).join(' · ') || 'No assignments yet'}</p>
          <p className="muted">{Object.entries(bd.rtos).map(([k, v]) => `${k}: ${v.handled} handled / ${v.resolved} resolved`).join(' · ')}</p>
        </div>
      )}
      <div className="card">
        <div className="row"><h3 style={{ marginRight: 'auto' }}>Notifications</h3><button className="secondary" onClick={() => api.readNotifications().then(() => api.notifications().then(setNotes))}>Mark all read</button></div>
        {notes.slice(0, 6).map((n) => <p key={n._id} className="muted" style={{ fontWeight: n.readStatus ? 400 : 700, margin: '4px 0' }}>{n.title}: {n.message}</p>)}
        {!notes.length && <p className="muted">No notifications</p>}
      </div>
      <div className="card">
        <div className="row">
          <select style={{ width: 'auto' }} value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}</select>
          <input style={{ width: 200 }} placeholder="Search ID / vehicle" value={q.search} onChange={(e) => setQ({ ...q, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={q.overdue} onChange={(e) => setQ({ ...q, overdue: e.target.checked })} /> Overdue only</label>
          <button className="secondary" onClick={load}>Search</button>
          {user.role !== 'officer' && <button className="secondary" onClick={exportCsv}>Export CSV</button>}
          {user.role !== 'officer' && <button className="secondary" onClick={exportPdf}>Export PDF</button>}
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>ID</th><th>Vehicle</th><th>District</th><th>Status</th><th>Due</th><th /></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.complaintId}>
                <td>{c.complaintId}</td><td>{c.vehicleNumber || '—'}</td><td>{c.district || '—'}</td>
                <td><span className="badge">{c.status}</span> {c.overdue && <span className="badge bad">Overdue</span>}</td>
                <td>{c.slaDueAt ? new Date(c.slaDueAt).toLocaleDateString() : ''}</td>
                <td><Link to={`/staff/${c.complaintId}`}>Open</Link></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan="6" className="muted">No complaints</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
