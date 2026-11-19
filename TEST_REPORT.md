# Test report — 13 Nov 2026 update

## Tests actually run for this update

| Check | Result | Notes |
|---|---|---|
| AI service pytest | **PASS — 9/9** | `python3 -m pytest -q test_main.py`; includes AI service input/OCR/smoke tests from the existing suite. |
| Backend JavaScript syntax | **PASS** | `node --check` on updated routes and app plus auth. |
| Frontend API JavaScript syntax | **PASS** | `node --check frontend/src/api.js`. |
| Frontend production build | **BLOCKED** | `npm ci` did not complete within the environment timeout; `vite` executable was unavailable. |
| Backend integration tests | **NOT RUN** | Backend npm dependencies did not finish installing; MongoDB service is not available here. |
| Browser camera / GPS / Chrome E2E | **NOT RUN** | No interactive browser or physical laptop camera/GPS permission prompt available in this environment. Must be tested on the user's Mac. |

## Changes in this update

- Added three Citizen report modes: live camera capture, gallery selection with OCR plate validation, and manual vehicle-number entry.
- Manual-number complaints can be submitted without an image; backend requires a valid vehicle number and GPS coordinates.
- Added temporary gallery-image OCR validation endpoint; unsupported, oversized, corrupt or unreadable/non-matching plate photos are rejected.
- Camera stream is stopped after capture/stop and when the report page is unmounted.
- Added explicit location permission handling and fresh GPS acquisition on submit.
- Nearby police stations continue to come only from configured database records.
- Added role-specific panel headings and role-home redirect for `/staff`; existing frontend route guards and backend RBAC remain in place.
- Added rate limiting for the OCR validation endpoint.

## Important limitations / manual verification required

- OCR cannot prove a photo is an original physical plate photo. It can only reject images where no valid-looking plate text is detected. A synthetic or edited image containing a valid-looking plate string may pass OCR.
- OCR depends on the configured AI service and Tesseract. If OCR is unavailable, gallery selection is rejected rather than silently accepted.
- Live camera and GPS require browser permission and a secure context (`localhost` or HTTPS).
- Nearby police station results will be empty until verified station records with coordinates are configured by Admin.
- Camera, GPS, role-login, backend integration, and complete browser workflows are **not claimed as fully tested** in this environment.
- Smoke analysis is not a certified emissions test; any AI result is decision-support only.

## Mac verification checklist

1. Install dependencies in `frontend` and `backend` using `npm ci`.
2. Start MongoDB and seed demo data (`npm run seed:demo` from `backend`).
3. Start the AI service and backend, then the frontend.
4. Open `http://localhost:5173`; allow camera and location permissions.
5. Test camera capture, valid plate gallery image, non-plate gallery image, manual number entry, GPS and nearby stations.
6. Log in with each demo role and verify it lands only on its own dashboard; try direct URL access to the other three panels and confirm redirect/403.
7. Run `./run_all_tests.sh` and record the actual results before final submission.


## Fix package revision — 14 Nov 2026

### Code changes
- Camera/gallery image preview is retained immediately; OCR failure no longer clears the image. User can manually verify/type the vehicle registration number.
- `Other` district selection reveals a required city/district input.
- Backend accepts a manual location description with district when GPS coordinates are unavailable; partial or invalid coordinate pairs are still rejected.
- Frontend Vite `/api` proxy target changed from port 5000 to port 5001.
- PDF complaint export uses the supplied emblem image. CSV remains a plain-text export and cannot embed a bitmap logo.

### Checks performed in packaging environment
- **PASS:** `node --check` for backend routes, extras/PDF export, server, backend API test file and Vite config.
- **PASS:** Python bytecode syntax compilation for AI service main module and tests.
- **NOT RUN:** Frontend production build / JSX compile (frontend dependencies were not installed in this packaging environment).
- **NOT RUN:** MongoDB integration tests and live browser camera, GPS, login and submission tests; these require the user's Mac, running services, browser permissions and camera hardware.

See `docs/PollutionGuard_AI_Fixes_and_Test_Status.pdf` for the branded summary. Do not treat the unrun browser/integration checks as passed.

- **PASS:** AI service pytest rerun for this package: `9 passed`.
- **BLOCKED:** `npm ci --ignore-scripts --no-audit --no-fund` for the frontend exceeded the packaging environment timeout, so a Vite production build could not be completed here.
