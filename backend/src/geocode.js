// Free geocoding: OpenStreetMap Nominatim. Sirf tab call hota hai jab user ne
// map se pin nahi choose kiya, sirf address text likha hai.
export async function geocode(address) {
  if (!address) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'live-order-tracking/1.0' } });
    const d = await r.json();
    if (!d?.[0]) return null;
    return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
  } catch {
    return null; // geocode fail ho to bhi order bina lat/lng ke ban sakta hai
  }
}

// Coords -> readable address (customer ki current location ko destination address me dikhane ke liye)
export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'live-order-tracking/1.0' } });
    const d = await r.json();
    return d?.display_name || null;
  } catch {
    return null;
  }
}
