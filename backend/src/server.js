import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Server } from 'socket.io';
import { prisma } from './prisma.js';
import { geocode, reverseGeocode } from './geocode.js';
import { validateLocation, verifySignature } from './antiSpoof.js';

const app = express();
const server = http.createServer(app);
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(server, { cors: { origin } });
app.use(cors({ origin }));
app.use(express.json());

// Order.id BigInt(DriverLocation.id) ko JSON me safely bhejne ke liye
const json = (res, data) => res.json(JSON.parse(JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v))));

const auth = (roles) => (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    const u = jwt.verify(t, process.env.JWT_SECRET);
    if (roles && !roles.includes(u.role)) return res.status(403).json({ error: 'Forbidden' });
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// ---------- Auth ----------
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !['customer', 'driver'].includes(role))
    return res.status(400).json({ error: 'Invalid data' });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { name, email: email.toLowerCase(), passwordHash, role } });
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'Email already exists' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, deviceId } = req.body;
  const u = await prisma.user.findUnique({ where: { email: (email || '').toLowerCase() } });
  if (!u || !(await bcrypt.compare(password || '', u.passwordHash)))
    return res.status(401).json({ error: 'Wrong email or password' });

  const payload = { id: u.id, role: u.role, name: u.name };
  let sessionSecret = null;
  if (u.role === 'driver') {
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    await prisma.driverSession.updateMany({ where: { driverId: u.id }, data: { active: false } }); // purana device band
    sessionSecret = crypto.randomBytes(32).toString('hex');
    const s = await prisma.driverSession.create({
      data: { driverId: u.id, deviceId, secret: sessionSecret },
    });
    payload.sid = s.id;
  }
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: payload, sessionSecret });
});

// Refresh ke baad session valid hai ya nahi check karne ke liye (dobara login na karna pade)
app.get('/api/auth/me', auth(['customer', 'driver']), (req, res) => {
  res.json({ id: req.user.id, role: req.user.role, name: req.user.name });
});

// Customer ki current GPS location ko readable address me badalne ke liye (free, Nominatim)
app.get('/api/geocode/reverse', async (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng required' });
  const address = (await reverseGeocode(lat, lng)) || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  res.json({ address });
});

// ---------- Fixed pickup location (mode 1) ----------
app.get('/api/shop-location', async (_req, res) => {
  const loc = await prisma.shopLocation.findUnique({ where: { id: 1 } });
  res.json(loc);
});

// Simple admin-key guard (no admin role in this schema yet)
app.put('/api/shop-location', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
  const { name, address, lat, lng } = req.body;
  const loc = await prisma.shopLocation.upsert({
    where: { id: 1 },
    update: { name, address, lat, lng },
    create: { id: 1, name, address, lat, lng },
  });
  res.json(loc);
});

// ---------- Orders ----------
// Mode "fixed_pickup": body = { destination: { address, lat?, lng? } }  -> pickup = ShopLocation
// Mode "from_to":      body = { pickup: { address, lat?, lng? }, drop: { address, lat?, lng? } }
// lat/lng dono mode me OPTIONAL hain - map choose karna zaroori nahi, sirf address text se bhi order ban sakta hai.
app.post('/api/orders', auth(['customer']), async (req, res) => {
  const { mode } = req.body;
  if (!['fixed_pickup', 'from_to'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });

  let pickup, drop;
  if (mode === 'fixed_pickup') {
    const shop = await prisma.shopLocation.findUnique({ where: { id: 1 } });
    if (!shop) return res.status(500).json({ error: 'Shop location not set' });
    const destination = req.body.destination;
    if (!destination?.address) return res.status(400).json({ error: 'destination.address required' });
    pickup = { address: shop.address, lat: shop.lat, lng: shop.lng };
    drop = destination;
  } else {
    pickup = req.body.pickup;
    drop = req.body.drop;
    if (!pickup?.address || !drop?.address)
      return res.status(400).json({ error: 'pickup.address and drop.address required' });
  }

  // Map se pin nahi chuna to address se best-effort geocode try karo (free, optional - fail ho to bhi order bane)
  if (!Number.isFinite(drop.lat) || !Number.isFinite(drop.lng)) {
    const g = await geocode(drop.address);
    if (g) Object.assign(drop, g);
  }
  if (!Number.isFinite(pickup.lat) || !Number.isFinite(pickup.lng)) {
    const g = await geocode(pickup.address);
    if (g) Object.assign(pickup, g);
  }

  const order = await prisma.order.create({
    data: {
      customerId: req.user.id,
      mode,
      pickupAddress: pickup.address,
      pickupLat: Number.isFinite(pickup.lat) ? pickup.lat : null,
      pickupLng: Number.isFinite(pickup.lng) ? pickup.lng : null,
      dropAddress: drop.address,
      dropLat: Number.isFinite(drop.lat) ? drop.lat : null,
      dropLng: Number.isFinite(drop.lng) ? drop.lng : null,
      trackingCode: crypto.randomBytes(8).toString('hex'),
    },
  });
  json(res, order);
});

app.get('/api/orders/mine', auth(['customer', 'driver']), async (req, res) => {
  const where = req.user.role === 'driver' ? { driverId: req.user.id } : { customerId: req.user.id };
  const orders = await prisma.order.findMany({ where, orderBy: { id: 'desc' } });
  json(res, orders);
});

app.get('/api/orders/open', auth(['driver']), async (_req, res) => {
  const orders = await prisma.order.findMany({ where: { status: 'pending' }, orderBy: { id: 'desc' } });
  json(res, orders);
});

app.post('/api/orders/:id/accept', auth(['driver']), async (req, res) => {
  const id = Number(req.params.id);
  const r = await prisma.order.updateMany({
    where: { id, status: 'pending' },
    data: { driverId: req.user.id, status: 'accepted' },
  });
  if (!r.count) return res.status(409).json({ error: 'Order not available' });
  json(res, await prisma.order.findUnique({ where: { id } }));
});

const NEXT = { accepted: 'picked_up', picked_up: 'delivered' };
app.post('/api/orders/:id/advance', auth(['driver']), async (req, res) => {
  const id = Number(req.params.id);
  const o = await prisma.order.findFirst({ where: { id, driverId: req.user.id } });
  if (!o || !NEXT[o.status]) return res.status(400).json({ error: 'Cannot advance' });
  const updated = await prisma.order.update({ where: { id }, data: { status: NEXT[o.status] } });
  io.to(`order:${updated.trackingCode}`).emit('status', { status: updated.status });
  json(res, updated);
});

// Public tracking (sirf tracking code se, read-only, login nahi chahiye)
app.get('/api/track/:code', async (req, res) => {
  const o = await prisma.order.findUnique({
    where: { trackingCode: req.params.code },
    include: { driver: { select: { name: true } } },
  });
  if (!o) return res.status(404).json({ error: 'Not found' });
  const loc = await prisma.driverLocation.findFirst({
    where: { orderId: o.id, suspicious: false },
    orderBy: { id: 'desc' },
  });
  json(res, {
    order: {
      id: o.id, mode: o.mode, status: o.status, flagged: o.flagged,
      pickupAddress: o.pickupAddress, pickupLat: o.pickupLat, pickupLng: o.pickupLng,
      dropAddress: o.dropAddress, dropLat: o.dropLat, dropLng: o.dropLng,
      driverName: o.driver?.name || null,
    },
    location: loc ? { lat: loc.lat, lng: loc.lng, heading: loc.heading, speed: loc.speed, ts: Number(loc.clientTs) } : null,
  });
});

// Free routing: OSRM public server (route + ETA) - sirf tab kaam karta hai jab dono point ke coords maujood hon
app.get('/api/route', async (req, res) => {
  const [a, b] = [req.query.from, req.query.to].map((s) => (s || '').split(',').map(Number));
  if ([...a, ...b].length !== 4 || [...a, ...b].some((n) => !Number.isFinite(n)))
    return res.status(400).json({ error: 'from/to = lat,lng' });
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
    const r = await (await fetch(url)).json();
    const route = r.routes?.[0];
    if (!route) return res.status(404).json({ error: 'No route' });
    res.json({
      coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      duration: route.duration, distance: route.distance,
    });
  } catch {
    res.status(502).json({ error: 'Routing service unavailable' });
  }
});

// ---------- Socket.IO ----------
io.use((socket, next) => {
  const t = socket.handshake.auth?.token;
  if (t) {
    try { socket.data.user = jwt.verify(t, process.env.JWT_SECRET); } catch { return next(new Error('bad_token')); }
  }
  next(); // customers bina login ke sirf tracking code se join kar sakte hain
});

io.on('connection', (socket) => {
  socket.on('track:join', (code) => {
    if (typeof code === 'string' && code.length === 16) socket.join(`order:${code}`);
  });

  socket.on('driver:location', async (p, ack = () => {}) => {
    try {
      const u = socket.data.user;
      if (!u || u.role !== 'driver') return ack({ ok: false, error: 'not_driver' });

      const s = await prisma.driverSession.findFirst({ where: { id: u.sid, driverId: u.id, active: true } });
      if (!s) return ack({ ok: false, error: 'session_revoked' }); // dusre device se login hua

      const o = await prisma.order.findFirst({
        where: { id: p.orderId, driverId: u.id, status: { in: ['accepted', 'picked_up'] } },
      });
      if (!o) return ack({ ok: false, error: 'order_not_assigned' });

      if (!verifySignature(s.secret, p)) return ack({ ok: false, error: 'bad_signature' });

      const last = await prisma.driverLocation.findFirst({
        where: { orderId: o.id, suspicious: false }, orderBy: { id: 'desc' },
      });
      const reason = validateLocation(p, last ? { lat: last.lat, lng: last.lng, client_ts: last.clientTs } : null);

      await prisma.driverLocation.create({
        data: {
          orderId: o.id, driverId: u.id, lat: p.lat, lng: p.lng,
          accuracy: p.accuracy ?? null, speed: p.speed ?? null, heading: p.heading ?? null,
          clientTs: BigInt(p.ts), suspicious: !!reason, reason,
        },
      });

      if (reason) {
        const recent = await prisma.driverLocation.findMany({
          where: { orderId: o.id }, orderBy: { id: 'desc' }, take: 10, select: { suspicious: true },
        });
        const badCount = recent.filter((r) => r.suspicious).length;
        if (badCount >= 3 && !o.flagged) {
          await prisma.order.update({ where: { id: o.id }, data: { flagged: true } });
          io.to(`order:${o.trackingCode}`).emit('flagged', true);
        }
        return ack({ ok: false, error: reason });
      }

      io.to(`order:${o.trackingCode}`).emit('location',
        { lat: p.lat, lng: p.lng, heading: p.heading ?? null, speed: p.speed ?? null, ts: p.ts });
      ack({ ok: true });
    } catch (e) {
      console.error(e);
      ack({ ok: false, error: 'server_error' });
    }
  });
});

server.listen(process.env.PORT || 4000, () => console.log('API on', process.env.PORT || 4000));
