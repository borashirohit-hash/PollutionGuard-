const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineKm, sortNearbyStations } = require('../src/geo');

test('haversine returns zero for the same point', () => {
  assert.equal(haversineKm(23.2599, 77.4126, 23.2599, 77.4126), 0);
});
test('haversine calculates a plausible Bhopal-Indore distance', () => {
  const km = haversineKm(23.2599, 77.4126, 22.7196, 75.8577);
  assert.ok(km > 160 && km < 180, `unexpected distance: ${km}`);
});
test('invalid coordinates are rejected', () => {
  assert.equal(haversineKm(91, 0, 0, 0), null);
  assert.equal(haversineKm(0, 'bad', 0, 0), null);
});
test('nearby stations are radius filtered and nearest-first', () => {
  const rows = sortNearbyStations([
    { name: 'far', latitude: 24, longitude: 78 },
    { name: 'near', latitude: 23.26, longitude: 77.42 },
    { name: 'invalid', latitude: 100, longitude: 0 },
  ], 23.2599, 77.4126, 25);
  assert.deepEqual(rows.map(x => x.name), ['near']);
  assert.ok(rows[0].distanceKm < 2);
});
