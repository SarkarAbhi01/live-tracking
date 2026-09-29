import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { useEffect } from 'react';

function Recenter({ pos }) {
  const map = useMap();
  useEffect(() => { if (pos) map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 15)); }, [pos, map]);
  return null;
}

function Clicks({ onClick }) {
  useMapEvents({ click: (e) => onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

// Free tiles: OpenStreetMap (attribution zaroori hai)
export default function TrackMap({ pickup, drop, pos, route, onClick, center = [22.57, 88.36] }) {
  return (
    <MapContainer center={center} zoom={13} style={{ height: 380 }}>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      {onClick && <Clicks onClick={onClick} />}
      {route && <Polyline positions={route} pathOptions={{ color: '#2563eb', weight: 4 }} />}
      {pickup && <CircleMarker center={[pickup.lat, pickup.lng]} radius={9} pathOptions={{ color: '#16a34a' }}><Tooltip>Pickup</Tooltip></CircleMarker>}
      {drop && <CircleMarker center={[drop.lat, drop.lng]} radius={9} pathOptions={{ color: '#dc2626' }}><Tooltip>Drop</Tooltip></CircleMarker>}
      {pos && <CircleMarker center={[pos.lat, pos.lng]} radius={11} pathOptions={{ color: '#1d4ed8', fillOpacity: 0.9 }}><Tooltip permanent>Driver</Tooltip></CircleMarker>}
      <Recenter pos={pos} />
    </MapContainer>
  );
}
