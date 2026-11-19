import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function MyComplaints() {
  const [list, setList] = useState([]);
  const [notes, setNotes] = useState([]);
  useEffect(() => { api.myComplaints().then(setList); api.notifications().then(setNotes); }, []);
  return (
    <>
      <div className="card">
        <h2>My complaints</h2>
        <p className="muted">Complaints you filed while logged in and not anonymously. For PIN-based tracking use the <Link to="/track">Track</Link> page.</p>
        <table>
          <thead><tr><th>ID</th><th>Vehicle</th><th>Status</th><th>Filed</th></tr></thead>
          <tbody>{list.map((c) => (<tr key={c.complaintId}><td>{c.complaintId}</td><td>{c.vehicleNumber}</td><td><span className="badge">{c.status}</span></td><td>{new Date(c.submittedAt).toLocaleDateString()}</td></tr>))}</tbody>
        </table>
      </div>
      <div className="card">
        <div className="row"><h3 style={{ marginRight: 'auto' }}>Notifications</h3><button className="secondary" onClick={() => api.readNotifications().then(() => api.notifications().then(setNotes))}>Mark read</button></div>
        {notes.map((n) => <p key={n._id} style={{ fontWeight: n.readStatus ? 400 : 700 }}>{n.title}: {n.message}</p>)}
      </div>
    </>
  );
}
