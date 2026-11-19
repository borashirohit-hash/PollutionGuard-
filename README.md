# PollutionGuard AI

AI-assisted vehicle pollution reporting and RTO/police action management (initial region: Madhya Pradesh).

- `backend/`    Node.js + Express + MongoDB: JWT auth, role-based access, complaint workflow, SLA + escalation, notifications, audit log, stations, rewards review, CSV/PDF reports, map data
- `ai-service/` Python FastAPI: OpenCV smoke analysis (optional YOLO weights) + Tesseract plate OCR
- `frontend/`   React + Vite: Citizen portal, Admin, RTO and Officer dashboards, Leaflet map
- `e2e/`        Real-browser end-to-end test (Playwright)
- `TEST_REPORT.md`  Actual test results and honest limitations

## Run it (macOS)
This package uses Backend port **5001** because macOS may reserve port 5000. Vite proxies `/api` to `http://localhost:5001`. Keep MongoDB, AI service, backend and frontend running in separate Terminal windows.

Prerequisites: Node 18+, Python 3.10+, MongoDB (or `docker compose up -d mongo`), Tesseract OCR installed on the machine.

```bash
# 1. AI service
cd ai-service && python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 8000

# 2. Backend (new terminal)
cd backend && cp .env.example .env && npm install
npm run seed        # legacy integration-test accounts
npm run seed:demo   # optional: 56 demo accounts + 100 clearly marked demo complaints
npm start           # http://localhost:5001 (local Mac config)

# 3. Frontend (new terminal)
cd frontend && npm install && npm run dev    # http://localhost:5173
```

Demo accounts (default development password `Password@123`): `admin.demo@pg.in`, `rto.demo@pg.in`, `officer.demo@pg.in`, `citizen.demo@pg.in`. The legacy test accounts remain `admin@pg.in`, `rto@pg.in`, `officer@pg.in`. Demo complaints use tracking PIN `123456`; these are fictional and must never be used in production.

Role routes: `/citizen`, `/admin/dashboard` (plus `/admin` management), `/rto`, `/officer`. The public nearby-station finder returns only records configured by an administrator; it does not invent station names or imply jurisdiction. Location captured through the Share location control is labelled as submission location with accuracy and timestamp.
Citizens can report without login and track with Complaint ID + PIN, or register to see "My complaints".

## Run all tests
```bash
pip install -r ai-service/requirements.txt playwright     # Chrome required for the UI test (set CHROME_PATH if not /usr/bin/google-chrome)
(cd backend && npm install) && (cd frontend && npm install)
./run_all_tests.sh
```

## Typical workflow
Citizen reports -> RTO/Admin "Start review" -> "Verify" -> assign officer + police station (from the Admin-configured station list) -> Officer records inspection, evidence, challan status -> RTO closes. Every step is recorded in complaint history and the audit log; logged-in non-anonymous reporters get in-app notifications.

## Important
- Video upload/analysis is not implemented; evidence analysis currently accepts JPG/PNG/WEBP still images.
- The nearby police station finder uses only administrator-configured station records with coordinates; no live external police-station provider is connected.
- No trained smoke model ships with this project. Without `ai-service/models/smoke.pt` the detector is a simple OpenCV heuristic that always requires manual review. Train YOLO on an annotated dataset before relying on it.
- OCR must be verified by a human. AI output is supporting information, not legal proof.
- The app records officer challan status; it does not issue legal challans. Jurisdiction comes from the stations you configure, not map distance.
- Email/SMS/WhatsApp, VAHAN/RTO integration and reward payments are out of scope (see synopsis section 6.3). Reward requests are recorded for policy review only.
- Set a strong `JWT_SECRET` and use HTTPS in production.

## Revision deliverables

- `TEST_REPORT.md` records this revision's executed checks and blocked tests.
- `docs/PollutionGuard_AI_UI_Preview_and_Test_Status.pdf` contains a static browser-style UI preview and honest validation summary. It is not a live Chrome screenshot; the live browser test remains pending in this workspace.
- `backend/src/seed_demo.js` creates fictional demo accounts and complaint records. Run with `npm run seed:demo` after installing dependencies and starting MongoDB.


## Citizen reporting updates (13 Nov 2026)

The Citizen report page now offers three distinct methods:
1. **Open Camera** — requests browser camera permission using `getUserMedia`, shows a live preview, and captures a still image.
2. **Select from Gallery** — accepts JPG/PNG/WEBP only (8 MB maximum) and sends the image to the backend OCR validation endpoint. The image is accepted only when OCR returns a syntactically valid Indian-style vehicle registration number. OCR is imperfect; users must verify the extracted number.
3. **Enter Number Manually** — accepts a typed registration number without an image.

Complaint submission requests a fresh GPS location and validates latitude/longitude when provided. If GPS permission is unavailable, users can submit with a manually entered district and location description; such records are saved without map coordinates. Nearby stations are read only from configured `police_stations` records; no station names or phone numbers are fabricated. Add verified station records through the Admin station management screen before demonstrating this feature.

**Browser camera/location requirement:** use `http://localhost:5173` or HTTPS, then allow Camera and Location permissions in the browser. A remote plain-HTTP LAN address will normally be blocked by browser security. Camera hardware access cannot be tested from a headless build environment.

**Privacy:** camera is started only after the user clicks Start Laptop Camera and tracks are stopped after capture/stop or when leaving the report page. Location is requested only when the user starts camera, presses Get Live Location, searches nearby stations, or submits. No background tracking is implemented. Gallery validation uploads the selected image temporarily for OCR; the temporary validation file is deleted after processing.

**Role routing:** successful login routes by the role returned by the server. `/admin/dashboard`, `/rto`, `/officer`, and `/citizen` enforce matching frontend roles; backend APIs continue to enforce role permissions. `/staff` redirects to the user's own role home.


## Fixes in this package
- Camera snapshots and gallery photos are previewed immediately and retained even if OCR cannot read the plate; users can enter the plate manually. OCR remains advisory.
- Selecting `Other` for district opens a required city/district text field.
- Complaint submission supports GPS coordinates or a manually entered district + location description when browser GPS permission is unavailable. Manual records have no map coordinates.
- Vite API proxy targets backend port 5001.
- Generated PDF complaint reports include the supplied emblem image. CSV is a text format and cannot embed a logo; use PDF for branded printable reports.

- `docs/PollutionGuard_AI_Fixes_and_Test_Status.pdf` is the branded fix and validation summary using the supplied emblem.


## UI + Smoke Assessment enhancement
See `ENHANCEMENT_TEST_REPORT.md` for scope, limitations and verification. Backend port example is 5001. Smoke output is an indicative OpenCV image heuristic and requires human review; it is not a validated smoke AI model or emissions measurement.
# PollutionGuard-
