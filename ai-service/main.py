"""PollutionGuard AI - image analysis service (smoke + plate OCR).
Results are supporting information only, never legal proof."""
import os, re, time
import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException

app = FastAPI(title="PollutionGuard AI Service")

MAX_BYTES = int(os.getenv("MAX_IMAGE_BYTES", 8 * 1024 * 1024))
ALLOWED = {"image/jpeg", "image/png", "image/webp"}
MODEL_PATH = os.getenv("SMOKE_MODEL", os.path.join(os.path.dirname(__file__), "models", "smoke.pt"))

_yolo = None
try:
    if os.path.exists(MODEL_PATH):
        from ultralytics import YOLO
        _yolo = YOLO(MODEL_PATH)
except Exception as e:  # model optional
    print("YOLO model not loaded:", e)

try:
    import pytesseract
    _ocr_ok = True
except Exception:
    _ocr_ok = False

PLATE_RE = re.compile(r"[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}")


async def load_image(file: UploadFile):
    if file.content_type not in ALLOWED:
        raise HTTPException(400, "Unsupported file type")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image too large")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")
    return img


def smoke_analysis(img):
    """Explainable visual heuristic; not a trained smoke detector or emissions test."""
    t = time.time()
    h, w = img.shape[:2]
    scale = min(1.0, 900.0 / max(h, w))
    sample = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))))
    hsv = cv2.cvtColor(sample, cv2.COLOR_BGR2HSV)
    bgr = sample.astype(np.float32)
    sat = hsv[..., 1]
    val = hsv[..., 2]
    # Candidate plume pixels: low saturation gray/white/black areas. Exclude
    # very dark pixels and extreme highlights; keep broad range for exhaust.
    neutral = sat < 78
    visible = (val > 42) & (val < 248)
    plume_mask = neutral & visible
    # Colored blue-tinted plume pixels are separately considered.
    blue_tint = (bgr[..., 0] > bgr[..., 2] * 1.08) & (bgr[..., 0] > bgr[..., 1] * 1.02) & (sat < 150) & (val > 55)
    dark_neutral = neutral & (val < 105)
    light_neutral = neutral & (val >= 105) & (val < 248)
    total = float(sample.shape[0] * sample.shape[1])
    plume_ratio = float(plume_mask.mean())
    dark_ratio = float(dark_neutral.mean())
    light_ratio = float(light_neutral.mean())
    blue_ratio = float(blue_tint.mean())

    # Dominant visual appearance among candidate smoke-like pixels.
    scores = {"Dark/Black": dark_ratio, "Light/White": light_ratio, "Blue-tinted": blue_ratio}
    smoke_type = max(scores, key=scores.get)
    if max(scores.values()) < 0.012:
        smoke_type = "Unclear"
    intensity_ratio = max(dark_ratio + light_ratio, blue_ratio) 
    if intensity_ratio < 0.08:
        level = "Low"
    elif intensity_ratio < 0.22:
        level = "Medium"
    else:
        level = "High"

    # Optional YOLO model remains an additional signal, but the class mapping
    # must be trained and validated before treating its output as authoritative.
    yolo_conf = None
    if _yolo is not None:
        try:
            pred = _yolo(sample, verbose=False)[0]
            vals = [float(b.conf) for b in pred.boxes]
            yolo_conf = max(vals) if vals else 0.0
        except Exception as e:
            print("YOLO inference failed:", e)

    causes = {
        "Dark/Black": ["Rich fuel mixture", "Incomplete combustion", "Air-filter or fuel-system issue"],
        "Blue-tinted": ["Possible engine-oil burning", "Worn piston rings or valve seals", "PCV system issue"],
        "Light/White": ["Cold-start condensation", "Possible coolant leakage if persistent", "Possible head-gasket issue"],
        "Unclear": ["Image does not show a clear smoke plume; retake from a safe, well-lit angle"]
    }
    suggestions = {
        "Low": "Monitor the vehicle; arrange routine maintenance if smoke persists.",
        "Medium": "Arrange a vehicle inspection and check the air/fuel and exhaust systems.",
        "High": "Recommend prompt professional inspection; do not treat this image estimate as a PUC measurement."
    }
    confidence = min(0.95, round(max(scores.values()) * 2.2, 3))
    return {
        "smoke_detected": smoke_type != "Unclear" and intensity_ratio >= 0.025,
        "smoke_type": smoke_type,
        "smoke_color": smoke_type,
        "smoke_category": level,
        "intensity": level,
        "pollution_risk": {"Low": "Low", "Medium": "Moderate", "High": "High"}[level],
        "possible_causes": causes[smoke_type],
        "recommendation": suggestions[level],
        "confidence": confidence,
        "visual_scores": {k: round(v, 4) for k, v in scores.items()},
        "review_required": True,
        "model": "opencv-visual-heuristic (untrained; indicative only)" if _yolo is None else "opencv-visual-heuristic + optional-yolo",
        "yolo_confidence": round(yolo_conf, 3) if yolo_conf is not None else None,
        "ms": int((time.time() - t) * 1000),
        "disclaimer": "Image-based visual estimate only. Not a trained/validated smoke classifier, mechanical diagnosis, PM2.5/PM10 reading, PUC test, or legal evidence. Human inspection required."
    }


def plate_analysis(img):
    if not _ocr_ok:
        return {"plate_number": None, "confidence": None, "note": "pytesseract not installed"}
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = cv2.bilateralFilter(gray, 9, 75, 75)
        gray = cv2.createCLAHE(2.0, (8, 8)).apply(gray)
        text = pytesseract.image_to_string(
            gray, config="--psm 8 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 "
        )
        cleaned = re.sub(r"[^A-Z0-9]", "", text.upper())
        m = PLATE_RE.search(cleaned)
        return {"plate_number": m.group(0) if m else (cleaned or None),
                "format_valid": bool(m), "confidence": None}
    except Exception as e:
        return {"plate_number": None, "confidence": None, "note": f"OCR failed: {e}"}


@app.get("/health")
def health():
    return {"status": "ok", "yolo_loaded": _yolo is not None, "ocr": _ocr_ok}


@app.post("/detect-smoke")
async def detect_smoke(file: UploadFile = File(...)):
    img = await load_image(file)
    return {"success": True, **smoke_analysis(img)}


@app.post("/read-plate")
async def read_plate(file: UploadFile = File(...)):
    img = await load_image(file)
    return {"success": True, **plate_analysis(img)}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    img = await load_image(file)
    s = smoke_analysis(img)
    p = plate_analysis(img)
    return {"success": True, "smoke": s, "plate": p, "review_required": True,
            "disclaimer": "AI output is supporting information, not legal proof."}
