import crypto from 'crypto';

const MAX_SPEED_MS = 45;        // ~162 km/h se upar = teleport/fake
const MAX_CLOCK_SKEW_MS = 30000; // device time vs server time
const MAX_ACCURACY_M = 100;      // isse kharab accuracy reject

export function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Har location payload par HMAC signature (session secret se).
// Postman / dusra app / script bina secret ke valid payload nahi bana sakta.
export function verifySignature(secret, p) {
  const msg = `${p.orderId}|${p.lat}|${p.lng}|${p.ts}`;
  const expected = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  const got = String(p.sig || '');
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// null = theek hai, warna reason string
export function validateLocation(p, last, now = Date.now()) {
  const { lat, lng, accuracy, ts } = p;
  if (![lat, lng, ts].every(Number.isFinite)) return 'invalid_payload';
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return 'invalid_coords';
  if (lat === 0 && lng === 0) return 'null_island';
  if (Math.abs(now - ts) > MAX_CLOCK_SKEW_MS) return 'stale_or_clock_skew';
  if (!Number.isFinite(accuracy) || accuracy <= 0) return 'no_accuracy';
  if (accuracy > MAX_ACCURACY_M) return 'low_accuracy';

  if (last) {
    const lastTs = Number(last.client_ts);
    if (ts <= lastTs) return 'replay_or_time_backwards';
    const dt = (ts - lastTs) / 1000;
    const dist = haversine(last.lat, last.lng, lat, lng);
    if (dist / dt > MAX_SPEED_MS && dist > 50) return 'teleport';
  }
  return null;
}
