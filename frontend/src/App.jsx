import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Report from './pages/Report.jsx';
import Track from './pages/Track.jsx';
import Login from './pages/Login.jsx';
import StaffDashboard from './pages/StaffDashboard.jsx';
import ComplaintDetail from './pages/ComplaintDetail.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import MyComplaints from './pages/MyComplaints.jsx';
import MapPage from './pages/MapPage.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!localStorage.getItem('pg_token')) return setReady(true);
    api.me().then(setUser).catch(() => localStorage.removeItem('pg_token')).finally(() => setReady(true));
  }, []);

  const logout = () => { localStorage.removeItem('pg_token'); setUser(null); nav('/'); };
  const staff = user && ['admin', 'rto', 'officer'].includes(user.role);
  if (!ready) return <main>Loading…</main>;

  return (
    <>
      <nav>
        <Link to="/" className="brand"><img src="/pollutionguard-emblem.png" alt="PollutionGuard emblem" style={{ height: 34, width: 34, objectFit: "contain", verticalAlign: "middle", marginRight: 8 }} />PollutionGuard AI</Link>
        <Link to="/">Report</Link>
        <Link to="/track">Track</Link>
        {user?.role === 'citizen' && <Link to="/my">My complaints</Link>}
        {user?.role === 'citizen' && <Link to="/citizen">Citizen panel</Link>}
        {staff && <Link to={user.role === 'admin' ? '/admin/dashboard' : `/${user.role}`}>{user.role.toUpperCase()} dashboard</Link>}
        {staff && <Link to="/map">Map</Link>}
        {user?.role === 'admin' && <Link to="/admin">Admin</Link>}
        {user ? <button className="secondary" onClick={logout}>Logout ({user.name})</button> : <Link to="/login">Login</Link>}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Report user={user} />} />
          <Route path="/citizen" element={user?.role === 'citizen' ? <Report user={user} /> : <Navigate to="/login" />} />
          <Route path="/track" element={<Track />} />
          <Route path="/login" element={<Login onLogin={setUser} />} />
          <Route path="/my" element={user?.role === 'citizen' ? <MyComplaints /> : <Navigate to="/login" />} />
          <Route path="/staff" element={<Navigate to={user ? ({ admin: '/admin/dashboard', rto: '/rto', officer: '/officer', citizen: '/citizen' })[user.role] || '/' : '/login'} replace />} />
          <Route path="/rto" element={user?.role === 'rto' ? <StaffDashboard user={user} /> : <Navigate to="/login" />} />
          <Route path="/officer" element={user?.role === 'officer' ? <StaffDashboard user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin/dashboard" element={user?.role === 'admin' ? <StaffDashboard user={user} /> : <Navigate to="/login" />} />
          <Route path="/staff/:id" element={staff ? <ComplaintDetail user={user} /> : <Navigate to="/login" />} />
          <Route path="/map" element={staff ? <MapPage /> : <Navigate to="/login" />} />
          <Route path="/admin" element={user?.role === 'admin' ? <AdminPanel /> : <Navigate to="/login" />} />
        </Routes>
      </main>
    </>
  );
}
