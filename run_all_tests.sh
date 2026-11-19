#!/usr/bin/env bash
# Full local test suite. Requires installed dependencies, MongoDB, Tesseract and a Chrome/Chromium browser.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export JWT_SECRET=e2e-secret AI_SERVICE_URL=http://127.0.0.1:8000
cleanup() {
  for f in /tmp/pg-ai.pid /tmp/pg-be.pid /tmp/pg-fe.pid; do
    [ ! -f "$f" ] || kill "$(cat "$f")" 2>/dev/null || true
    rm -f "$f"
  done
}
trap cleanup EXIT
echo "== AI service tests =="; (cd "$ROOT/ai-service" && python3 -m pytest -q)
(cd "$ROOT/ai-service" && python3 -m uvicorn main:app --port 8000 >/tmp/pg-ai.log 2>&1 & echo $! >/tmp/pg-ai.pid); sleep 4
echo "== Backend integration tests =="; (cd "$ROOT/backend" && npm test)
echo "== Frontend production build =="; (cd "$ROOT/frontend" && npm run build)
echo "== Browser end-to-end (real browser) =="
export MONGO_URI=mongodb://127.0.0.1:27017/pg_e2e PORT=5000 UPLOAD_DIR=/tmp/pg-e2e-uploads
(cd "$ROOT/backend" && node -e "require('mongoose').connect(process.env.MONGO_URI).then(async m=>{await m.connection.dropDatabase();process.exit()})" && npm run seed >/dev/null)
(cd "$ROOT/backend" && node src/server.js >/tmp/pg-be.log 2>&1 & echo $! >/tmp/pg-be.pid)
(cd "$ROOT/frontend" && npx vite --port 5173 --host 127.0.0.1 >/tmp/pg-fe.log 2>&1 & echo $! >/tmp/pg-fe.pid); sleep 6
python3 "$ROOT/e2e/test_ui.py"
