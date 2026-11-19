"""Tests for the AI service using real generated images (no mocks)."""
import io
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def png_bytes(img):
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def plate_image(text="MP04AB1234"):
    img = np.full((120, 480, 3), 255, np.uint8)
    cv2.putText(img, text, (15, 85), cv2.FONT_HERSHEY_SIMPLEX, 2.2, (0, 0, 0), 5, cv2.LINE_AA)
    return img


def smoky_image():
    # large mid-gray low-saturation area, like a dense grey plume
    img = np.full((300, 400, 3), 140, np.uint8)
    return img


def sky_image():
    img = np.zeros((300, 400, 3), np.uint8)
    img[:] = (200, 120, 30)  # saturated blue (BGR)
    return img


def post(path, data, ctype="image/png", name="a.png"):
    return client.post(path, files={"file": (name, io.BytesIO(data), ctype)})


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_rejects_wrong_content_type():
    r = post("/analyze", b"hello", "text/plain", "a.txt")
    assert r.status_code == 400


def test_rejects_undecodable_image():
    r = post("/analyze", b"not really a png", "image/png")
    assert r.status_code == 400


def test_rejects_oversized(monkeypatch):
    monkeypatch.setattr(main, "MAX_BYTES", 100)
    r = post("/analyze", png_bytes(smoky_image()))
    assert r.status_code == 413


def test_smoke_heuristic_distinguishes_images_and_always_requires_review():
    grey = post("/detect-smoke", png_bytes(smoky_image())).json()
    blue = post("/detect-smoke", png_bytes(sky_image())).json()
    assert grey["success"] and blue["success"]
    assert grey["smoke_detected"] is True
    assert blue["smoke_detected"] is False
    assert grey["review_required"] is True  # untrained heuristic must never auto-confirm
    assert 0 <= grey["confidence"] <= 1 and "heuristic" in grey["model"]


def test_plate_ocr_reads_clear_plate():
    r = post("/read-plate", png_bytes(plate_image("MP04AB1234"))).json()
    assert r["success"]
    assert r["plate_number"] == "MP04AB1234", r
    assert r["format_valid"] is True


def test_plate_ocr_blank_image_returns_no_valid_plate():
    blank = np.full((120, 480, 3), 255, np.uint8)
    r = post("/read-plate", png_bytes(blank)).json()
    assert r["success"]
    assert not r.get("format_valid")


def test_analyze_returns_combined_result_with_disclaimer():
    r = post("/analyze", png_bytes(plate_image())).json()
    assert r["success"] and "smoke" in r and "plate" in r
    assert r["review_required"] is True
    assert "not legal proof" in r["disclaimer"]


def test_jpeg_and_webp_accepted():
    ok, buf = cv2.imencode(".jpg", plate_image())
    assert post("/detect-smoke", buf.tobytes(), "image/jpeg", "a.jpg").status_code == 200
    ok, buf = cv2.imencode(".webp", plate_image())
    assert post("/detect-smoke", buf.tobytes(), "image/webp", "a.webp").status_code == 200
