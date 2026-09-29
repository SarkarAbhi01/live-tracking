import { useEffect, useState } from 'react';
import { api, getDeviceId, saveSession, loadSession, clearSession } from './api';
import Customer, { LiveTrack } from './Customer.jsx';
import Driver from './Driver.jsx';

function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'customer' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    setErr('');
    try {
      if (mode === 'register') {
        await api('/auth/register', { method: 'POST', body: f });
        setMode('login'); setErr('Register ho gaya, ab login karo');
        return;
      }
      const d = await api('/auth/login', {
        method: 'POST', body: { email: f.email, password: f.password, deviceId: getDeviceId() },
      });
      onLogin(d);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="card">
      <h3>{mode === 'login' ? 'Login' : 'Register'}</h3>
      {mode === 'register' && (
        <>
          <input placeholder="Name" value={f.name} onChange={set('name')} />
          <select value={f.role} onChange={set('role')}>
            <option value="customer">Customer</option>
            <option value="driver">Driver</option>
          </select>
        </>
      )}
      <input placeholder="Email" value={f.email} onChange={set('email')} />
      <input placeholder="Password" type="password" value={f.password} onChange={set('password')} />
      <button onClick={submit}>{mode === 'login' ? 'Login' : 'Register'}</button>
      <button className="alt" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Naya account' : 'Login par jao'}
      </button>
      <p className="err">{err}</p>
    </div>
  );
}

export default function App() {
  // Refresh par turant purana session dikhao; background me /auth/me se verify karo
  const [session, setSession] = useState(() => loadSession());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (!s) { setReady(true); return; }
    api('/auth/me', { token: s.token })
      .catch(() => { clearSession(); setSession(null); })
      .finally(() => setReady(true));
  }, []);

  const login = (d) => { saveSession(d); setSession(d); };
  const logout = () => { clearSession(); setSession(null); };

  // Public tracking box bhi refresh ke baad wahi order dikhaye
  const [code, setCode] = useState(() => localStorage.getItem('lt_public_code') || '');
  const [tracking, setTracking] = useState(() => localStorage.getItem('lt_public_code') || '');
  const track = () => { localStorage.setItem('lt_public_code', code); setTracking(code); };

  if (!ready) return <div className="wrap"><p>Loading…</p></div>;

  return (
    <div className="wrap">
      <h2>📍 Live Order Tracking</h2>

      <div className="card">
        <h3>Tracking code se dekho (login nahi chahiye)</h3>
        <input placeholder="16-char tracking code" value={code} onChange={(e) => setCode(e.target.value.trim())} />
        <button onClick={track}>Track</button>
        {tracking && <LiveTrack code={tracking} />}
      </div>

      {!session ? (
        <Auth onLogin={login} />
      ) : (
        <>
          <p>
            {session.user.name} ({session.user.role}){' '}
            <button className="alt" onClick={logout}>Logout</button>
          </p>
          {session.user.role === 'driver'
            ? <Driver session={{ ...session, sessionSecret: session.sessionSecret }} />
            : <Customer session={session} />}
        </>
      )}
    </div>
  );
}
