import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const DISTRICTS = ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Rewa', 'Satna', 'Other'];

export default function Report({ user }) {
  const [mode, setMode] = useState('camera');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [validating, setValidating] = useState(false);
  const [plateCheck, setPlateCheck] = useState('');
  const [customDistrict, setCustomDistrict] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [f, setF] = useState({ vehicleNumber: '', locationDescription: '', district: 'Bhopal', anonymous: !user, rewardRequested: false });
  const [geo, setGeo] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [nearbyMessage, setNearbyMessage] = useState('');
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const stopCamera = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; setCameraOn(false); };
  useEffect(() => { if (cameraOn && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current; }, [cameraOn]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const getLocation = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) { setErr('This browser does not support GPS location.'); reject(new Error('Geolocation unavailable')); return; }
    navigator.geolocation.getCurrentPosition(p => {
      const value = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, capturedAt: new Date().toISOString(), locationType: 'submission' };
      setGeo(value); setErr(''); resolve(value);
    }, e => { const msg = e.code === 1 ? 'Location permission denied. Allow location access in browser settings.' : 'Could not get GPS location. Check device location and try again.'; setErr(msg); reject(new Error(msg)); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  const startCamera = async () => {
    setErr(''); setPlateCheck('');
    if (!navigator.mediaDevices?.getUserMedia) { setErr('Camera needs localhost or HTTPS and browser camera permission.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setCameraOn(true); getLocation().catch(() => {});
    } catch { setErr('Camera access failed. Allow camera permission and close other apps using the camera.'); }
  };

  const setEvidence = async (selected) => {
    if (!selected) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) { setErr('Only JPG, PNG or WEBP images are allowed.'); return; }
    if (selected.size > 8 * 1024 * 1024) { setErr('Image must be smaller than 8 MB.'); return; }
    if (preview) URL.revokeObjectURL(preview);
    const localPreview = URL.createObjectURL(selected);
    setFile(selected);
    setPreview(localPreview);
    setErr('');
    setPlateCheck('Photo attached. Checking number plate…');
    setValidating(true);
    try {
      const data = new FormData(); data.append('image', selected);
      const checked = await api.validatePlatePhoto(data);
      setF(old => ({ ...old, vehicleNumber: old.vehicleNumber || checked.vehicleNumber }));
      setPlateCheck(`Number plate detected: ${checked.vehicleNumber}. Please verify the number.`);
    } catch (e) {
      // Keep the image: OCR is advisory and must not make a captured photo disappear.
      setPlateCheck('Photo attached. OCR could not read the plate; enter the vehicle number manually.');
    } finally { setValidating(false); }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) { setErr('Camera is not ready yet. Wait for the live preview.'); return; }
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (blob) await setEvidence(new File([blob], `pollutionguard-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    stopCamera();
  };

  const findNearby = async () => {
    setNearbyMessage(''); setNearbyBusy(true);
    try {
      const location = geo || await getLocation();
      const data = await api.nearbyStations(location.latitude, location.longitude, 25);
      setNearby(data.stations || []);
      setNearbyMessage(data.message || `${data.count || 0} configured police station(s) found within ${data.radiusKm || 25} km.`);
    } catch (e) { setNearbyMessage(e.message); }
    finally { setNearbyBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    const plate = f.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(plate)) return setErr('Enter a valid vehicle registration number, e.g. MP04AB1234.');
    if (mode !== 'manual' && !file) return setErr('Capture a photo or select a verified number-plate photo.');
    setBusy(true);
    try {
      const location = geo || await getLocation().catch(() => null);
      const districtValue = f.district === 'Other' ? customDistrict.trim() : f.district;
      if (!districtValue) throw new Error('Please enter your city or district.');
      if (!location && !f.locationDescription.trim()) throw new Error('GPS is unavailable. Enter a location description (area / road / landmark) to submit manually.');
      const form = new FormData();
      if (file) form.append('image', file);
      Object.entries({ ...f, district: districtValue, vehicleNumber: plate }).forEach(([k, v]) => form.append(k, v));
      if (location) {
        form.append('latitude', location.latitude); form.append('longitude', location.longitude);
        form.append('locationAccuracyMeters', location.accuracy); form.append('locationCapturedAt', location.capturedAt); form.append('locationType', 'submission');
      } else form.append('locationType', 'manual');
      setResult(await api.submit(form));
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  if (result) return <div className="card"><h2>Complaint submitted</h2><p>Complaint ID: <b>{result.complaintId}</b></p><p>Tracking PIN: <b>{result.trackingPin}</b></p><p className="notice">Save both now — the PIN is shown only once.</p><p className="muted">{geo ? 'GPS location attached.' : 'Location description recorded; GPS coordinates were not available.'} AI output is supporting information only and is not legal proof.</p>{result.ai?.smoke && <section className="card"><h3>AI Smoke Image Assessment</h3><div className="grid"><div className="stat"><span className="muted">Smoke appearance</span><b>{result.ai.smoke.smoke_type || 'Unclear'}</b></div><div className="stat"><span className="muted">Estimated intensity</span><b>{result.ai.smoke.smoke_category || 'Review'}</b></div><div className="stat"><span className="muted">Indicative risk</span><b>{result.ai.smoke.pollution_risk || 'Review'}</b></div><div className="stat"><span className="muted">Vehicle number (OCR)</span><b>{result.ai.plate?.plate_number || result.ai.plate?.note || 'Not read'}</b></div></div><h4>Possible causes to inspect</h4><ul>{(result.ai.smoke.possible_causes || []).map((cause, i) => <li key={i}>{cause}</li>)}</ul><p>{result.ai.smoke.recommendation}</p><p className="notice">{result.ai.smoke.disclaimer || 'Visual estimate only. Human inspection required.'}</p></section>}<button onClick={() => { setResult(null); setFile(null); setPreview(null); setF(old => ({ ...old, vehicleNumber: '' })); setGeo(null); setPlateCheck(''); }}>Report another</button></div>;

  return <form className="card" onSubmit={submit}>
    <h2>Report a visibly polluting vehicle</h2>
    <p className="muted">Choose one method. Camera and GPS permissions are requested only when you use those features.</p>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button type="button" className={mode === 'camera' ? '' : 'secondary'} onClick={() => { setMode('camera'); setErr(''); }}>📷 Open Camera</button>
      <button type="button" className={mode === 'gallery' ? '' : 'secondary'} onClick={() => { stopCamera(); setMode('gallery'); setErr(''); }}>🖼 Select from Gallery</button>
      <button type="button" className={mode === 'manual' ? '' : 'secondary'} onClick={() => { stopCamera(); setMode('manual'); setErr(''); }}>⌨ Enter Number Manually</button>
    </div>
    {mode === 'camera' && <section className="card" style={{ marginTop: 14 }}><h3>Live camera capture</h3>{cameraOn ? <><video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', maxHeight: 340, background: '#111', borderRadius: 10 }} /><div className="row"><button type="button" onClick={capturePhoto}>Capture Photo</button><button type="button" className="secondary" onClick={stopCamera}>Stop Camera</button></div></> : <button type="button" onClick={startCamera}>Start Laptop Camera</button>}<p className="muted">Camera requires permission and a secure context (localhost or HTTPS). Position the vehicle number plate clearly.</p></section>}
    {mode === 'gallery' && <section className="card" style={{ marginTop: 14 }}><h3>Choose a number-plate photo</h3><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setEvidence(e.target.files?.[0])} disabled={validating} /><p className="muted">Selected image is checked with OCR. Photos without a readable vehicle registration number are rejected. This cannot guarantee that every accepted image is an original/unmodified photo.</p></section>}
    {mode !== 'manual' && preview && <><img className="evidence" src={preview} alt="Selected vehicle evidence" style={{ marginTop: 10, maxHeight: 240 }} /><p className="muted" role="status">{validating ? 'Checking…' : plateCheck}</p></>}
    <label htmlFor="vehicle-number">Vehicle registration number</label>
    <input id="vehicle-number" value={f.vehicleNumber} onChange={e => setF({ ...f, vehicleNumber: e.target.value.toUpperCase() })} placeholder="MP04AB1234" required />
    <label htmlFor="district">District</label><select id="district" value={f.district} onChange={e => { setF({ ...f, district: e.target.value }); if (e.target.value !== 'Other') setCustomDistrict(''); }}><option value="Bhopal">Bhopal</option>{DISTRICTS.filter(d => d !== 'Bhopal').map(d => <option key={d} value={d}>{d}</option>)}</select>
    {f.district === 'Other' && <><label htmlFor="custom-district">Enter city / district</label><input id="custom-district" value={customDistrict} onChange={e => setCustomDistrict(e.target.value)} placeholder="Enter your city or district" required /></>}
    <label htmlFor="location-description">Location description</label><input id="location-description" value={f.locationDescription} onChange={e => setF({ ...f, locationDescription: e.target.value })} placeholder="Area, road, landmark or city" />
    <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}><button type="button" className="secondary" onClick={() => getLocation().catch(() => {})}>📍 Get Live Location</button>{geo && <span className="badge ok">GPS: {geo.latitude.toFixed(5)}, {geo.longitude.toFixed(5)} · ±{Math.round(geo.accuracy)} m</span>}</div>
    {geo && <p className="muted">Location timestamp: {new Date(geo.capturedAt).toLocaleString()}</p>}
    <section className="card" style={{ marginTop: 14 }}><h3>Nearby police stations</h3><p className="muted">Only stations present in the configured station dataset are shown. Nearby does not establish legal jurisdiction.</p><button type="button" className="secondary" disabled={nearbyBusy} onClick={findNearby}>{nearbyBusy ? 'Searching…' : 'Find Nearby Police Stations'}</button>{nearbyMessage && <p className="muted" role="status">{nearbyMessage}</p>}{nearby.map(station => <div key={station._id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', padding: '8px 0' }}><span><b>{station.name}</b><br/><small>{station.area || station.district} · {station.distanceKm} km</small></span>{geo && <a href={`https://www.openstreetmap.org/directions?from=${geo.latitude},${geo.longitude}&to=${station.latitude},${station.longitude}`} target="_blank" rel="noreferrer">Directions</a>}</div>)}</section>
    {user && <label><input type="checkbox" style={{ width: 'auto' }} checked={f.anonymous} onChange={e => setF({ ...f, anonymous: e.target.checked })} /> Report anonymously</label>}
    <label><input type="checkbox" style={{ width: 'auto' }} checked={f.rewardRequested} onChange={e => setF({ ...f, rewardRequested: e.target.checked })} /> Request confidential recognition (subject to policy)</label>
    {err && <div className="err" role="alert">{err}</div>}
    <button disabled={busy || validating} style={{ marginTop: 12 }}>{busy ? 'Submitting complaint…' : 'Submit Complaint'}</button>
  </form>;
}
