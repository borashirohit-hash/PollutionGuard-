function haversineKm(fromLat, fromLng, toLat, toLng) {
  const values = [fromLat, fromLng, toLat, toLng].map(Number);
  if (!values.every(Number.isFinite) || Math.abs(values[0]) > 90 || Math.abs(values[2]) > 90 ||
      Math.abs(values[1]) > 180 || Math.abs(values[3]) > 180) return null;
  const rad = n => n * Math.PI / 180;
  const dLat = rad(values[2] - values[0]), dLng = rad(values[3] - values[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(values[0])) * Math.cos(rad(values[2])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function sortNearbyStations(stations, lat, lng, radiusKm = 25, limit = 20) {
  return stations.map(s => ({ ...s, distanceKm: haversineKm(lat, lng, s.latitude, s.longitude) }))
    .filter(s => s.distanceKm !== null && s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit)
    .map(s => ({ ...s, distanceKm: Number(s.distanceKm.toFixed(2)) }));
}
module.exports = { haversineKm, sortNearbyStations };
