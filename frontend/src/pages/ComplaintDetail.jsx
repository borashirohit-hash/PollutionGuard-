import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

export default function ComplaintDetail({ user }) {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [img, setImg] = useState(null);
  const [officers, setOfficers] = useState([]);
  const [stations, setStations] = useState([]);
  const [evImgs, setEvImgs] = useState([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [remarks, setRemarks] = useState('');
  const [assign, setAssign] = useState({ officerId: '', policeStation: '', priority: 'normal' });
  const [act, setAct] = useState({ inspectionResult: '', actionTaken: '', challanReference: '', challanStatus: '', complianceObservation: '' });

  const load = () => api.get(id).then((d) => {
    setC(d);
    Promise.all((d.evidenceFiles || []).map((f) => api.evidenceImage(id, f).then((b) => URL.createObjectURL(b)))).then(setEvImgs).catch(() => {});
  }).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api.image(id).then((b) => setImg(URL.createObjectURL(b))).catch(() => {});
    if (user.role !== 'officer') { api.officers().then(setOfficers); api.stations().then(setStations); }
  }, [id]);

  const run = async (fn) => {
    setErr(''); setOk('');
    try { await fn(); setOk('Updated'); load(); } catch (e) { setErr(e.message); }
  };

  if (!c) return <div className="card">{err || 'Loading…'}</div>;
  const reviewer = user.role !== 'officer';
  const ai = c.aiAnalysis || {};

  return (
    <>
      <p><Link to="/staff">← Back</Link></p>
      <div className="card">
        <h2>{c.complaintId} <span className="badge">{c.status}</span> {c.overdue && <span className="badge bad">Overdue</span>}</h2>
        <p className="muted">Reporter identity is hidden from this view. Vehicle: <b>{c.vehicleNumber || 'not recorded'}</b> (verify before any action) · District: {c.district || '—'} · Priority: {c.priority}</p>
        <p>Location: {c.locationDescription || '—'} {c.latitude != null && <a target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=17/${c.latitude}/${c.longitude}`}>(view on map)</a>}</p>
        <p>Submitted {new Date(c.submittedAt).toLocaleString()} · SLA target {c.slaDueAt && new Date(c.slaDueAt).toLocaleDateString()}</p>
        {img && <img className="evidence" src={img} alt="evidence" style={{ maxHeight: 360 }} />}
        <p className="notice">AI result (supporting info only): smoke {ai.smoke_detected ? 'possibly detected' : 'not detected'}, confidence {ai.confidence ?? 'n/a'}, model {ai.model || 'n/a'}. OCR plate: {c.ocrResult?.plate_number || 'n/a'}.</p>
        {evImgs.length > 0 && <div><h4>Officer evidence</h4>{evImgs.map((u) => <img key={u} className="evidence" src={u} alt="officer evidence" style={{ maxHeight: 200, marginRight: 8 }} />)}</div>}
        {c.policeStation && <p>Police station: {c.policeStation} · Officer: {c.assignedOfficerId?.name}</p>}
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="msg">{ok}</div>}

      {reviewer && (
        <div className="card">
          <h3>Review</h3>
          <label htmlFor="complaintdetail-f1">Remarks (required for reject / return)</label>
          <input id="complaintdetail-f1" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          <div className="row" style={{ marginTop: 10 }}>
            {c.status === 'Submitted' && <button onClick={() => run(() => api.setStatus(id, { status: 'Under Review', remarks }))}>Start review</button>}
            {c.status === 'Under Review' && <button onClick={() => run(() => api.setStatus(id, { status: 'Verified', remarks }))}>Verify</button>}
            {['Submitted', 'Under Review', 'Verified'].includes(c.status) && <button className="danger" onClick={() => run(() => api.setStatus(id, { status: 'Rejected', remarks }))}>Reject</button>}
            {c.status === 'Under Review' && <button className="secondary" onClick={() => run(() => api.setStatus(id, { status: 'Returned for Clarification', remarks }))}>Return for clarification</button>}
            {['Action Taken', 'Challan Status Updated', 'Inspection Completed', 'Resolved', 'Rejected'].includes(c.status) && <button onClick={() => run(() => api.close(id, { remarks }))}>Close complaint</button>}
          </div>
        </div>
      )}

      {reviewer && ['Under Review', 'Verified', 'Assigned to Officer'].includes(c.status) && (
        <div className="card">
          <h3>Assign officer</h3>
          <p className="muted">Choose the police station per your verified jurisdiction mapping; the system does not auto-assign.</p>
          <label htmlFor="complaintdetail-f2">Officer</label>
          <select id="complaintdetail-f2" value={assign.officerId} onChange={(e) => setAssign({ ...assign, officerId: e.target.value })}>
            <option value="">Select…</option>
            {officers.map((o) => <option key={o._id} value={o._id}>{o.name} {o.assignedArea ? `(${o.assignedArea})` : ''}</option>)}
          </select>
          <label htmlFor="complaintdetail-ps">Police station</label>
          {stations.length ? (
            <select id="complaintdetail-ps" value={assign.policeStation} onChange={(e) => setAssign({ ...assign, policeStation: e.target.value })}>
              <option value="">Select…</option>
              {stations.map((st) => <option key={st._id} value={st.name}>{st.name} ({st.district})</option>)}
            </select>
          ) : <input id="complaintdetail-ps" value={assign.policeStation} onChange={(e) => setAssign({ ...assign, policeStation: e.target.value })} placeholder="No stations configured yet; type a name" />}
          <label htmlFor="complaintdetail-f3">Priority</label>
          <select id="complaintdetail-f3" value={assign.priority} onChange={(e) => setAssign({ ...assign, priority: e.target.value })}><option>low</option><option>normal</option><option>high</option></select>
          <button style={{ marginTop: 10 }} disabled={!assign.officerId} onClick={() => run(() => api.assign(id, { ...assign, remarks }))}>Assign</button>
        </div>
      )}

      {user.role === 'officer' && ['Assigned to Officer', 'Inspection Pending'].includes(c.status) && (
        <div className="card">
          <h3>Inspection & action report</h3>
          <p className="muted">This records your findings. It does not issue a legal challan.</p>
          <label htmlFor="complaintdetail-f4">Inspection result *</label>
          <textarea id="complaintdetail-f4" rows={3} value={act.inspectionResult} onChange={(e) => setAct({ ...act, inspectionResult: e.target.value })} />
          <label htmlFor="complaintdetail-f5">Compliance observation</label>
          <input id="complaintdetail-f5" value={act.complianceObservation} onChange={(e) => setAct({ ...act, complianceObservation: e.target.value })} />
          <label htmlFor="complaintdetail-f6">Action taken</label>
          <input id="complaintdetail-f6" value={act.actionTaken} onChange={(e) => setAct({ ...act, actionTaken: e.target.value })} />
          <label htmlFor="complaintdetail-f7">Attach evidence photo</label>
          <input id="complaintdetail-f7" type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('image', f); run(() => api.addEvidence(id, fd)); }} />
          <label htmlFor="complaintdetail-f8">Challan reference (if applicable)</label>
          <input id="complaintdetail-f8" value={act.challanReference} onChange={(e) => setAct({ ...act, challanReference: e.target.value })} />
          <label htmlFor="complaintdetail-f9">Challan status</label>
          <input id="complaintdetail-f9" value={act.challanStatus} onChange={(e) => setAct({ ...act, challanStatus: e.target.value })} placeholder="e.g. Issued via official system / Not applicable" />
          <div className="row" style={{ marginTop: 10 }}>
            <button disabled={!act.inspectionResult} onClick={() => run(() => api.action(id, act))}>Submit report</button>
            <button className="secondary" onClick={() => run(() => api.setStatus(id, { status: 'Returned for Clarification', remarks: remarks || 'Clarification needed' }))}>Return to RTO</button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>History</h3>
        <div className="tl">
          {c.history.map((h) => (
            <div key={h._id}><b>{h.newStatus}</b> <span className="muted">by {h.actorRole || 'system'} · {new Date(h.timestamp).toLocaleString()}{h.remarks ? ` — ${h.remarks}` : ''}</span></div>
          ))}
        </div>
      </div>
    </>
  );
}
