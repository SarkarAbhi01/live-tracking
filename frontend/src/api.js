export async function api(path, { method = 'GET', body, token, adminKey } = {}) {
  const API_URL = import.meta.env.VITE_API_URL || '';
  const r = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(adminKey ? { 'x-admin-key': adminKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// Har browser/device ki ek stable id
export function getDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('deviceId', id);
  }
  return id;
}

// Location payload sign karne ke liye (HTTPS ya localhost zaroori)
export async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Session persistence (refresh par dobara login na karna pade) ----------
const SESSION_KEY = 'lt_session';

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
export function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ---------- Geolocation + reverse geocode helpers ----------
export function getCurrentPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation supported nahi hai'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      (e) => reject(new Error(e.message || 'Location permission chahiye')),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0, ...opts },
    );
  });
}

// Coords ko readable address me badalta hai (backend Nominatim proxy se)
export function reverseGeocode(lat, lng) {
  return api(`/geocode/reverse?lat=${lat}&lng=${lng}`).then((d) => d.address);
}

