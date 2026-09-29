import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getCurrentPosition, reverseGeocode } from './api';
import TrackMap from './TrackMap.jsx';

export function LiveTrack({ code }) {
  const [info, setInfo] = useState(null);
  const [pos, setPos] = useState(null);
  const [route, setRoute] = useState(null);
  const [eta, setEta] = useState(null);
  const [flagged, setFlagged] = useState(false);
  const [err, setErr] = useState('');
  const routeKeyRef = useRef(''); // "ab tak kaunsa route fetch kiya" - status badalte hi turant refresh

  const fetchOrder = () =>
    api(`/track/${code}`).then((d) => {
      setInfo(d.order); setPos((p) => d.location || p); setFlagged(d.order.flagged);
    }).catch((e) => setErr(e.message));

  useEffect(() => {
    let socket;
    setInfo(null); setPos(null); setRoute(null); setEta(null); setErr(''); routeKeyRef.current = '';
    fetchOrder().then(() => {
      socket = io({ path: '/socket.io' });
      socket.emit('track:join', code);
      socket.on('location', (l) => setPos(l));
      socket.on('status', (s) => setInfo((o) => ({ ...o, status: s.status })));
      socket.on('flagged', () => setFlagged(true));
    });
    // Socket kabhi miss ho jaye (refresh, network hiccup) to bhi status/flag turant sahi rahe
    const poll = setInterval(fetchOrder, 10000);
    return () => { socket?.disconnect(); clearInterval(poll); };
  }, [code]);

  // Route: driver assign hone se pehle bhi pickup->drop ka baseline route dikhta hai;
  // driver move karte hi driver->agla-stop route me badal jaata hai. Status badalte hi turant refresh (throttle bypass).
  useEffect(() => {
    if (!info) return;
    const target = info.status === 'accepted'
      ? { lat: info.pickupLat, lng: info.pickupLng }
      : { lat: info.dropLat, lng: info.dropLng };
    const start = pos || (Number.isFinite(info.pickupLat) && Number.isFinite(info.pickupLng)
      ? { lat: info.pickupLat, lng: info.pickupLng } : null);
    if (!start || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) { setRoute(null); return; }

    const key = `${start.lat.toFixed(4)},${start.lng.toFixed(4)}->${target.lat},${target.lng}|${info.status}`;
    if (key === routeKeyRef.current) return; // wahi route dobara mat maango
    routeKeyRef.current = key;
    api(`/route?from=${start.lat},${start.lng}&to=${target.lat},${target.lng}`)
      .then((r) => { setRoute(r.coords); setEta(Math.round(r.duration / 60)); })
      .catch(() => setRoute(null));
  }, [pos, info?.status, info?.pickupLat, info?.pickupLng, info?.dropLat, info?.dropLng]);

  if (err) return <p className="err">{err}</p>;
  if (!info) return <p>Loading…</p>;
  const hasCoords = Number.isFinite(info.pickupLat) && Number.isFinite(info.dropLat);
  return (
    <div>
      <p>
        Status: <b>{info.status}</b>
        {info.driverName && <> | Driver: <b>{info.driverName}</b></>}
        {eta != null && info.status !== 'delivered' && <> | ETA: <b>{eta} min</b></>}
      </p>
      <p>Pickup: {info.pickupAddress} {info.dropAddress && <>→ Drop: {info.dropAddress}</>}</p>
      {flagged && <p className="warn">⚠ Driver ki location verify ho rahi hai (suspicious updates mile).</p>}
      {!pos && info.status !== 'delivered' && <p>Driver ki live location ka wait…</p>}
      {hasCoords ? (
        <TrackMap
          pickup={{ lat: info.pickupLat, lng: info.pickupLng }}
          drop={{ lat: info.dropLat, lng: info.dropLng }}
          pos={pos} route={route}
        />
      ) : (
        <p><small>Is order ke liye map pin nahi hai (sirf address text diya gaya tha), sirf status/driver ki location text me dikhegi.</small></p>
      )}
    </div>
  );
}

// Ek address field: text input + optional "map se choose karo" + "current location use karo"
function AddressField({ label, value, onChange }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const useCurrent = async () => {
    setErr(''); setBusy(true);
    try {
      const c = await getCurrentPosition();
      const addr = await reverseGeocode(c.latitude, c.longitude).catch(() => null);
      onChange({ address: addr || `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`, lat: c.latitude, lng: c.longitude });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <label>{label}</label><br />
      <input
        placeholder={`${label} likho`}
        value={value.address}
        onChange={(e) => onChange({ ...value, address: e.target.value, lat: null, lng: null })}
        style={{ width: 260 }}
      />
      <button type="button" className="alt" disabled={busy} onClick={useCurrent}>📍 Current location</button>
      <button type="button" className="alt" onClick={() => setPicking((p) => !p)}>
        {value.lat ? '🗺 Pin set' : 'Map se choose karo (optional)'}
      </button>
      {err && <p className="err">{err}</p>}
      {picking && (
        <TrackMap
          pos={value.lat ? { lat: value.lat, lng: value.lng } : null}
          onClick={(p) => { onChange({ ...value, ...p }); setPicking(false); }}
        />
      )}
    </div>
  );
}

// Default pickup location (fixed_pickup mode) set/update karne ke liye - admin key se protected
function ShopLocationSettings({ shop, onSaved }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [adminKey, setAdminKey] = useState(localStorage.getItem('lt_admin_key') || '');
  const [f, setF] = useState({ name: '', address: '', lat: null, lng: null });
  const [msg, setMsg] = useState('');

  useEffect(() => { if (shop) setF({ name: shop.name, address: shop.address, lat: shop.lat, lng: shop.lng }); }, [shop]);

  const useCurrent = async () => {
    try {
      const c = await getCurrentPosition();
      const addr = await reverseGeocode(c.latitude, c.longitude).catch(() => null);
      setF((s) => ({ ...s, lat: c.latitude, lng: c.longitude, address: addr || s.address }));
    } catch (e) { setMsg(e.message); }
  };

  const save = async () => {
    setMsg('');
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) {
      setMsg('Pehle "Current location use karo" dabao ya map se coordinates set karo'); return;
    }
    try {
      localStorage.setItem('lt_admin_key', adminKey);
      const loc = await api('/shop-location', { method: 'PUT', body: f, adminKey });
      onSaved(loc); setMsg('Default pickup location save ho gayi'); setOpen(false);
    } catch (e) { setMsg(e.message); }
  };

  if (!open) return (
    <button className="alt" onClick={() => setOpen(true)}>⚙ Default pickup location set/update karo</button>
  );
  return (
    <div className="card">
      <h3>Default pickup location (fixed pickup mode ke liye)</h3>
      <input placeholder="Admin key" type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} /><br />
      <input placeholder="Naam (jaise Main Store)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><br />
      <input placeholder="Address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} style={{ width: 260 }} /><br />
      <button type="button" className="alt" onClick={useCurrent}>📍 Current location use karo</button>
      <button type="button" className="alt" onClick={() => setPicking((p) => !p)}>🗺 Map se choose karo</button>
      {Number.isFinite(f.lat) && <span> ({f.lat.toFixed(5)}, {f.lng.toFixed(5)})</span>}
      {picking && (
        <TrackMap
          pos={Number.isFinite(f.lat) ? { lat: f.lat, lng: f.lng } : null}
          onClick={async (p) => {
            const addr = await reverseGeocode(p.lat, p.lng).catch(() => null);
            setF((s) => ({ ...s, ...p, address: addr || s.address }));
            setPicking(false);
          }}
        />
      )}
      <br />
      <button onClick={save}>Save</button>
      <button className="alt" onClick={() => setOpen(false)}>Cancel</button>
      <p>{msg}</p>
    </div>
  );
}

export default function Customer({ session }) {
  const [mode, setMode] = useState('fixed_pickup');
  const [shop, setShop] = useState(null);
  const [destination, setDestination] = useState({ address: '', lat: null, lng: null });
  const [pickup, setPickup] = useState({ address: '', lat: null, lng: null });
  const [drop, setDrop] = useState({ address: '', lat: null, lng: null });
  const [orders, setOrders] = useState([]);
  const [code, setCode] = useState(() => localStorage.getItem('lt_customer_code') || '');
  const [msg, setMsg] = useState('');

  useEffect(() => { api('/shop-location').then(setShop).catch(() => {}); }, []);
  const load = () => api('/orders/mine', { token: session.token }).then(setOrders).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { if (code) localStorage.setItem('lt_customer_code', code); }, [code]);

  // Order place karte hi customer ki current location le lo aur use "drop / destination" bana do
  // (customer khud edit kar sakta hai - sirf khaali field ho tab hi prefill hota hai)
  useEffect(() => {
    getCurrentPosition().then(async (c) => {
      const addr = await reverseGeocode(c.latitude, c.longitude).catch(() => null);
      const filled = { address: addr || `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`, lat: c.latitude, lng: c.longitude };
      setDestination((d) => (d.address ? d : filled));
      setDrop((d) => (d.address ? d : filled));
    }).catch(() => {}); // permission na mile to bhi form manual bharne ke liye khula rehta hai
  }, []);

  const create = async () => {
    setMsg('');
    try {
      const body = mode === 'fixed_pickup' ? { mode, destination } : { mode, pickup, drop };
      const o = await api('/orders', { method: 'POST', token: session.token, body });
      setCode(o.trackingCode);
      setDestination({ address: '', lat: null, lng: null });
      setPickup({ address: '', lat: null, lng: null });
      setDrop({ address: '', lat: null, lng: null });
      load(); setMsg('Order ban gaya');
    } catch (e) { setMsg(e.message); }
  };

  const canCreate = mode === 'fixed_pickup' ? !!destination.address.trim() : !!(pickup.address.trim() && drop.address.trim());

  return (
    <>
      <div className="card">
        <h3>Naya order</h3>
        <div style={{ marginBottom: 10 }}>
          <label><input type="radio" checked={mode === 'fixed_pickup'} onChange={() => setMode('fixed_pickup')} /> Fixed pickup se (dukaan se) — sirf destination bharo</label><br />
          <label><input type="radio" checked={mode === 'from_to'} onChange={() => setMode('from_to')} /> Khud pickup aur drop dono choose karo</label>
        </div>

        {mode === 'fixed_pickup' ? (
          <>
            <p>Pickup: <b>{shop?.address || 'Loading…'}</b> (fixed)</p>
            <AddressField label="Destination" value={destination} onChange={setDestination} />
          </>
        ) : (
          <>
            <AddressField label="Pickup" value={pickup} onChange={setPickup} />
            <AddressField label="Drop" value={drop} onChange={setDrop} />
          </>
        )}
        <p><small>Destination/Drop me tumhari current location auto-fill ho jaati hai (permission do to) - chaho to edit ya map se badal sakte ho.</small></p>
        <button disabled={!canCreate} onClick={create}>Order karo</button> <span>{msg}</span>
      </div>

      <div className="card">
        <ShopLocationSettings shop={shop} onSaved={setShop} />
      </div>

      <div className="card">
        <h3>Mere orders</h3>
        {orders.map((o) => (
          <div key={o.id}>
            #{o.id} — {o.status} ({o.pickupAddress} → {o.dropAddress}){' '}
            <button className="alt" onClick={() => setCode(o.trackingCode)}>Track</button>
          </div>
        ))}
        {code && (
          <>
            <hr />
            <p>Share link code: <code>{code}</code></p>
            <LiveTrack code={code} />
          </>
        )}
      </div>
    </>
  );
}
