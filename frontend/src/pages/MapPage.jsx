import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api.js';

export default function MapPage() {
  const ref = useRef(null);
  const [info, setInfo] = useState('Loading…');

  useEffect(() => {
    let map;
    api.map().then(({ complaints, stations }) => {
      map = L.map(ref.current).setView([23.2599, 77.4126], 7); // Madhya Pradesh
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);
      const pts = [];
      complaints.forEach((c) => {
        pts.push([c.latitude, c.longitude]);
        L.circleMarker([c.latitude, c.longitude], { radius: 8, color: c.overdue ? '#b42318' : '#0f766e', fillOpacity: 0.7 })
          .addTo(map).bindPopup(`<b>${c.complaintId}</b><br/>${c.status}${c.overdue ? ' (overdue)' : ''}<br/>${c.vehicleNumber || ''}`);
      });
      stations.forEach((s) => {
        pts.push([s.latitude, s.longitude]);
        L.marker([s.latitude, s.longitude]).addTo(map).bindPopup(`Police station: ${s.name}`);
      });
      if (pts.length) map.fitBounds(pts, { maxZoom: 14, padding: [30, 30] });
      setInfo(`${complaints.length} complaint(s) and ${stations.length} station(s) with coordinates. Jurisdiction is decided by your configured stations, not by map distance.`);
    }).catch((e) => setInfo(e.message));
    return () => map && map.remove();
  }, []);

  return (
    <div className="card">
      <h2>Complaint map</h2>
      <p className="muted">{info}</p>
      <div ref={ref} style={{ height: 460, borderRadius: 8 }} />
    </div>
  );
}
