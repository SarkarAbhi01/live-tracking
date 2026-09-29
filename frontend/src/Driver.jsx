import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, hmacHex } from './api';

export default function Driver({ session }) {
  const [open, setOpen] = useState([]);
  const [mine, setMine] = useState([]);
  const [status, setStatus] = useState('');
  const socketRef = useRef(null);
  const watchRef = useRef(null);
  const lastSent = useRef(0);
  const lastTs = useRef(0);

  const active = mine.find((o) => ['accepted', 'picked_up'].includes(o.status));

  const load = async () => {
    setOpen(await api('/orders/open', { token: session.token }));
    setMine(await api('/orders/mine', { token: session.token }));
  };
  useEffect(() => { load().catch(() => {}); }, []);

  // Socket (JWT ke saath)
  useEffect(() => {
    const s = io({ auth: { token: session.token } });
    socketRef.current = s;
    return () => s.disconnect();
  }, [session.token]);

  // Active order ho to GPS watch shuru
  useEffect(() => {
    if (!active) return;
    if (!navigator.geolocation) { setStatus('GPS supported nahi hai'); return; }

    watchRef.current = navigator.geolocation.watchPosition(
      async (g) => {
        const now = Date.now();
        if (now - lastSent.current < 2000) return; // 2 sec throttle
        lastSent.current = now;
        const ts = Math.max(now, lastTs.current + 1); // strictly increasing
        lastTs.current = ts;

        const { latitude: lat, longitude: lng, accuracy, speed, heading } = g.coords;
        const payload = { orderId: active.id, lat, lng, accuracy, speed, heading, ts };
        payload.sig = await hmacHex(session.sessionSecret, `${active.id}|${lat}|${lng}|${ts}`);

        socketRef.current?.emit('driver:location', payload, (ack) => {
          setStatus(ack?.ok ? `✔ Location bheji (±${Math.round(accuracy)}m)` : `✖ Reject: ${ack?.error}`);
        });
      },
      (e) => setStatus('GPS error: ' + e.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watchRef.current);
  }, [active?.id, active?.status]);

  const accept = async (id) => {
    try { await api(`/orders/${id}/accept`, { method: 'POST', token: session.token }); load(); }
    catch (e) { setStatus(e.message); }
  };
  const advance = async (id) => {
    try { await api(`/orders/${id}/advance`, { method: 'POST', token: session.token }); load(); }
    catch (e) { setStatus(e.message); }
  };

  return (
    <>
      <div className="card">
        <h3>Active order</h3>
        {active ? (
          <>
            <p>#{active.id} — <b>{active.status}</b></p>
            <button onClick={() => advance(active.id)}>
              {active.status === 'accepted' ? 'Pickup ho gaya' : 'Deliver ho gaya'}
            </button>
            <p className={status.startsWith('✔') ? 'ok' : 'err'}>{status}</p>
            <small>Live location tab tak bheji jaegi jab tak yeh page khula hai.</small>
          </>
        ) : <p>Koi active order nahi.</p>}
      </div>
      <div className="card">
        <h3>Open orders</h3>
        {open.length === 0 && <p>Abhi koi pending order nahi.</p>}
        {open.map((o) => (
          <div key={o.id}>
            #{o.id} <button disabled={!!active} onClick={() => accept(o.id)}>Accept</button>
          </div>
        ))}
      </div>
    </>
  );
}
