import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [err, setErr] = useState('');
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const r = mode === 'login' ? await api.login(f) : await api.register(f);
      localStorage.setItem('pg_token', r.token);
      onLogin(r.user);
      nav(({ admin: '/admin/dashboard', rto: '/rto', officer: '/officer', citizen: '/citizen' })[r.user.role] || '/');
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 420, margin: '0 auto' }}>
      <h2>{mode === 'login' ? 'Login' : 'Citizen registration'}</h2>
      {mode === 'register' && (<><label htmlFor="login-f1">Name</label><input id="login-f1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /><label htmlFor="login-f2">Phone (optional)</label><input id="login-f2" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></>)}
      <label htmlFor="login-f3">Email</label>
      <input id="login-f3" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
      <label htmlFor="login-f4">Password</label>
      <input id="login-f4" type="password" minLength={mode === 'register' ? 8 : 1} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
      {err && <div className="err">{err}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button>{mode === 'login' ? 'Login' : 'Register'}</button>
        <button type="button" className="secondary" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Create citizen account' : 'Have an account? Login'}
        </button>
      </div>
      <p className="muted">RTO, officer and admin accounts are created by an administrator.</p>
    </form>
  );
}
