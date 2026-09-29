# Live Order Tracking (React + Node + PostgreSQL)

Free APIs: **OpenStreetMap tiles** (map) + **OSRM public server** (route/ETA) + **browser Geolocation API** (GPS). Koi paid key nahi chahiye.

## Run

```bash
# 1) Database (Prisma)
createdb livetracking
cd backend
cp .env.example .env         # DATABASE_URL, JWT_SECRET, ADMIN_KEY edit karo
npm install
npm run prisma:generate
npm run prisma:migrate       # tables banayega
npm run prisma:seed          # default fixed shop-location daalega

# 2) Backend
npm run dev                  # http://localhost:4000

# 3) Frontend (naya terminal)
cd ../frontend
npm install
npm run dev                  # http://localhost:5173
```

Fixed pickup ka address/coords badalne ke liye:
```bash
curl -X PUT http://localhost:4000/api/shop-location \
  -H "Content-Type: application/json" -H "x-admin-key: <ADMIN_KEY>" \
  -d '{"name":"Main Store","address":"Your real shop address","lat":22.57,"lng":88.36}'
```

## Test flow
1. Ek **Customer** aur ek **Driver** register karo (do alag browser/profile me).
2. Customer: "Fixed pickup" ya "From → To" chuno — GPS permission doge to destination/drop apne aap current location se bhar jaata hai (address edit ya map-pin bhi kar sakte ho) -> "Order karo" -> tracking code milega.
3. Driver: login -> order **Accept** -> browser GPS permission do. Location live customer ke map par dikhegi.
4. Kisi ko bhi sirf tracking code se (bina login) live track dikha sakte ho.
5. Page refresh karo (customer ya driver, kisi bhi tab me) — login/tracking code localStorage me save rehta hai, dobara login ya track-code type nahi karna padta.

## Refresh par login/tracking (persistent session)
- Login response (`token`, `sessionSecret`) `localStorage` me save hota hai; refresh par `GET /api/auth/me` se chup-chaap verify hota hai — valid ho to seedha dashboard khulta hai, expire/invalid ho to hi dobara login maanga jaata hai.
- Customer ka last-viewed tracking code aur top ka public tracking-code box bhi localStorage me save rehte hain, isliye refresh ke baad bhi wahi order ka live status dikhta rehta hai.
- Status/flag socket ke alawa har 10 sec me ek chhota poll (`GET /api/track/:code`) bhi karta hai, taaki refresh ya network hiccup ke turant baad bhi status turant sahi dikhe (socket reconnect hone tak).

## Route/map fix
- Pehle route sirf tab banta tha jab driver ki location aa chuki ho. Ab **order accept hote hi pickup → drop ka baseline route** turant dikhta hai (OSRM se); driver move karna shuru kare to route driver → agla stop (pickup ya drop) me update ho jaata hai. Status badalte hi (accepted → picked_up → delivered) route turant refresh hota hai.

## Default pickup location set karna
- Customer screen par **"⚙ Default pickup location set/update karo"** button se ek chhota form khulta hai: naam, address, aur **"Current location use karo"** (GPS) ya **"Map se choose karo"** button se coordinates set kar sakte ho.
- Isse save karne ke liye ek **admin key** chahiye (`.env` ka `ADMIN_KEY`) — ek baar daalne par browser me yaad rehta hai.
- Yehi location "Fixed pickup" mode me sabhi customers ko pickup point ke roop me dikhti hai.

## Order modes (dono me map choose karna optional hai, sirf address text se bhi order ban jaata hai)
1. **Fixed pickup** — pickup hamesha shop location se; customer sirf destination address bharta hai (chahe to map se pin bhi laga sakta hai).
2. **From → To** — customer khud pickup aur drop dono ka address bharta hai; dono ke liye map pin dena optional hai.

Agar sirf address text diya gaya ho (pin nahi), backend use free OSM Nominatim se best-effort geocode karta hai; fail ho to bhi order ban jaata hai — bas map par pin/route nahi dikhega, address text hi dikhega.

> GPS aur signing ke liye `localhost` ya **HTTPS** zaroori hai (production me HTTPS lagao).

## Fake location se bachav (anti-spoofing)

| Layer | Kya rokta hai |
|---|---|
| JWT + role check | Sirf logged-in driver location bhej sakta hai; customer sirf dekh sakta hai |
| Order binding | Driver sirf apne assigned, active order ki location bhej sakta hai |
| Device/session binding | Ek driver ka ek hi active device; dusre device se login par purana session band |
| HMAC signature | Har location payload session secret se signed. Postman/dusra app/script bina secret ke valid data nahi bhej sakta |
| Server validation | Stale timestamp, replay, teleport (>162 km/h), `0,0`, kharab accuracy reject |
| Flagging | 10 me se 3 suspicious updates -> order flagged, customer ko warning |
| Audit log | Har update `driver_locations` me (suspicious + reason) save hota hai |

### Important limitation (sach)
Browser/web app **mock-location (Fake GPS apps)** ko 100% detect nahi kar sakta. Upar ke server checks casual spoofing rokte hain, par jo Fake GPS app phone ke system GPS ko hi badal de, use web se pakadna mushkil hai. Zyada security chahiye to driver ke liye **native app** (React Native / Flutter) banao aur:
- Android par `isFromMockProvider` / `isMocked` check karo aur server ko bhejo
- Play Integrity API / App Attest se genuine app verify karo
- Root/emulator detection lagao

## Free API limits
- OSRM demo server: light use ke liye; production me khud ka OSRM host karo.
- OSM tiles: heavy traffic par apna tile provider lo (OSM tile usage policy dekho).
