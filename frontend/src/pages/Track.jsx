import React, { useState } from 'react';
import { api } from '../api.js';

export default function Track() {
  const [f, setF] = useState({ complaintId: '', pin: '' });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const go = async (e) => {
    e.preventDefault();
    setErr(''); setData(null);
    try { setData(await api.track({ complaintId: f.complaintId.trim().toUpperCase(), pin: f.pin.trim() })); }
    catch (e2) { setErr(e2.message); }
  };

  return (
    <>
      <form className="card" onSubmit={go}>
        <h2>Track complaint</h2>
        <label htmlFor="track-f1">Complaint ID</label>
        <input id="track-f1" value={f.complaintId} onChange={(e) => setF({ ...f, complaintId: e.target.value })} required />
        <label htmlFor="track-f2">Tracking PIN</label>
        <input id="track-f2" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} required />
        {err && <div className="err">{err}</div>}
        <button style={{ marginTop: 12 }}>Track</button>
      </form>
      {data && (
        <div className="card">
          <h3>{data.complaintId} — <span className="badge">{data.status}</span></h3>
          <p className="muted">Vehicle: {data.vehicleNumber || 'not recorded'} · Target date: {new Date(data.slaDueAt).toLocaleDateString()}</p>
          <div className="tl">
            {data.history.map((h, i) => (
              <div key={i}><b>{h.status}</b><br /><span className="muted">{new Date(h.at).toLocaleString()}{h.remarks ? ` — ${h.remarks}` : ''}</span></div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
