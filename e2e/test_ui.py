"""Real-browser end-to-end test of the whole flow (needs backend, AI service and frontend running).
Run:  pip install playwright pillow opencv-python-headless numpy  &&  python e2e/test_ui.py
Uses system Chrome (set CHROME_PATH) or Playwright's own Chromium if installed."""
import os
import re
import sys
import tempfile
import cv2
import numpy as np
from playwright.sync_api import sync_playwright, expect

BASE = os.getenv("APP_URL", "http://127.0.0.1:5173")
PW = "Password@123"
tmp = tempfile.mkdtemp()


def make_images():
    img = np.full((200, 600, 3), 255, np.uint8)
    cv2.putText(img, "MP04AB1234", (20, 130), cv2.FONT_HERSHEY_SIMPLEX, 2.6, (0, 0, 0), 6, cv2.LINE_AA)
    a = os.path.join(tmp, "vehicle.png"); cv2.imwrite(a, img)
    e = os.path.join(tmp, "evidence.png"); cv2.imwrite(e, np.full((100, 100, 3), 120, np.uint8))
    return a, e


def login(page, email):
    page.goto(BASE + "/login")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(PW)
    page.get_by_role("button", name="Login", exact=True).click()
    page.wait_for_url(re.compile(r"/staff$"))


def logout(page):
    page.get_by_role("button", name=re.compile("Logout")).click()
    page.wait_for_url(BASE + "/")


def run():
    vehicle, evidence = make_images()
    results = []
    with sync_playwright() as p:
        kw = {"executable_path": os.getenv("CHROME_PATH", "/usr/bin/google-chrome")} if os.path.exists(os.getenv("CHROME_PATH", "/usr/bin/google-chrome")) else {}
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"], **kw)
        ctx = browser.new_context(accept_downloads=True, viewport={"width": 390, "height": 844})  # phone-size too
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def step(name):
            results.append(name); print("PASS", name)

        # 1. Citizen reports anonymously
        page.goto(BASE + "/")
        page.locator('input[type=file]').set_input_files(vehicle)
        page.get_by_placeholder("MP04AB1234").fill("MP04AB1234")
        page.get_by_placeholder("Near MP Nagar signal").fill("MP Nagar signal")
        page.get_by_role("button", name="Submit complaint").click()
        expect(page.get_by_text("Complaint submitted")).to_be_visible(timeout=30000)
        cid = page.locator("b").nth(0).inner_text()
        pin = page.locator("b").nth(1).inner_text()
        assert re.fullmatch(r"PG\d{4}[0-9A-F]{6}", cid) and re.fullmatch(r"\d{6}", pin), (cid, pin)
        step("anonymous citizen submits complaint, gets ID + PIN")

        # 2. Track with wrong then right PIN
        page.goto(BASE + "/track")
        page.get_by_label("Complaint ID").fill(cid); page.get_by_label("Tracking PIN").fill("000000")
        page.get_by_role("button", name="Track").click()
        expect(page.get_by_text("Complaint not found or PIN incorrect")).to_be_visible()
        page.get_by_label("Tracking PIN").fill(pin)
        page.get_by_role("button", name="Track").click()
        expect(page.get_by_text("Submitted").first).to_be_visible()
        step("tracking rejects wrong PIN and shows status with correct PIN")

        # 3. Staff pages blocked when logged out
        page.goto(BASE + "/staff")
        expect(page).to_have_url(re.compile("/login"))
        step("staff dashboard redirects anonymous visitors to login")

        # 4. Admin configures police station
        login(page, "admin@pg.in")
        page.get_by_role("link", name="Admin", exact=True).click()
        page.get_by_label("Name").nth(1).fill("MP Nagar PS")
        page.get_by_label("District").nth(1).fill("Bhopal")
        page.get_by_label("Latitude").fill("23.2332"); page.get_by_label("Longitude").fill("77.4340")
        page.get_by_role("button", name="Add station").click()
        expect(page.get_by_role("cell", name="MP Nagar PS")).to_be_visible()
        step("admin adds police station")
        logout(page)

        # 5. RTO reviews, verifies, assigns
        login(page, "rto@pg.in")
        expect(page.get_by_role("cell", name=cid)).to_be_visible()
        page.get_by_role("row", name=re.compile(cid)).get_by_role("link", name="Open").click()
        expect(page.get_by_text("Reporter identity is hidden")).to_be_visible()
        expect(page.get_by_text("AI result (supporting info only)")).to_be_visible()
        page.get_by_role("button", name="Start review").click()
        expect(page.get_by_text("Updated")).to_be_visible()
        page.get_by_role("button", name="Verify", exact=True).click()
        expect(page.locator(".badge", has_text="Verified").first).to_be_visible()
        sels = page.locator("select")
        sels.nth(0).select_option(label="Officer Sharma (Bhopal Central)")
        sels.nth(1).select_option(label="MP Nagar PS (Bhopal)")
        page.get_by_role("button", name="Assign", exact=True).click()
        expect(page.locator(".badge", has_text="Assigned to Officer").first).to_be_visible()
        step("RTO reviews, verifies and assigns officer + police station")
        logout(page)

        # 6. Officer inspects and reports
        login(page, "officer@pg.in")
        page.get_by_role("row", name=re.compile(cid)).get_by_role("link", name="Open").click()
        page.get_by_label("Inspection result *").fill("Smoke observed; PUC expired")
        page.get_by_label("Action taken").fill("Notice issued")
        page.get_by_label("Challan reference (if applicable)").fill("CH-001")
        page.get_by_label("Challan status").fill("Issued via official system")
        page.get_by_label("Attach evidence photo").set_input_files(evidence)
        expect(page.get_by_alt_text("officer evidence")).to_be_visible(timeout=10000)
        page.get_by_role("button", name="Submit report").click()
        expect(page.locator(".badge", has_text="Challan Status Updated").first).to_be_visible(timeout=10000)
        step("officer records inspection, uploads evidence, challan status")
        logout(page)

        # 7. RTO closes
        login(page, "rto@pg.in")
        page.get_by_role("row", name=re.compile(cid)).get_by_role("link", name="Open").click()
        page.get_by_role("button", name="Close complaint").click()
        expect(page.locator(".badge", has_text="Closed").first).to_be_visible(timeout=10000)
        step("RTO closes complaint")
        page.get_by_role("link", name="Map").click()
        expect(page.locator(".leaflet-container")).to_be_visible()
        expect(page.get_by_text("with coordinates")).to_be_visible()
        step("map page renders with markers info")
        page.get_by_role("link", name=re.compile("RTO dashboard")).click()
        with page.expect_download() as d:
            page.get_by_role("button", name="Export PDF").click()
        pdf_path = d.value.path()
        assert open(pdf_path, "rb").read(4) == b"%PDF"
        with page.expect_download() as d:
            page.get_by_role("button", name="Export CSV").click()
        assert cid in open(d.value.path()).read()
        step("PDF and CSV exports download and contain data")
        logout(page)

        # 8. Citizen tracking shows full history
        page.goto(BASE + "/track")
        page.get_by_label("Complaint ID").fill(cid); page.get_by_label("Tracking PIN").fill(pin)
        page.get_by_role("button", name="Track").click()
        expect(page.locator(".badge", has_text="Closed")).to_be_visible()
        expect(page.get_by_text("Challan Status Updated")).to_be_visible()
        step("citizen sees Closed status and full timeline")

        # 9. Registered citizen flow
        page.goto(BASE + "/login")
        page.get_by_role("button", name="Create citizen account").click()
        page.get_by_label("Name").fill("Test Citizen")
        page.get_by_label("Email").fill("citizen@pg.in")
        page.get_by_label("Password").fill(PW)
        page.get_by_role("button", name="Register").click()
        page.wait_for_url(BASE + "/")
        page.locator('input[type=file]').set_input_files(vehicle)
        page.get_by_label("Report anonymously").uncheck()
        page.get_by_role("button", name="Submit complaint").click()
        expect(page.get_by_text("Complaint submitted")).to_be_visible(timeout=30000)
        cid2 = page.locator("b").nth(0).inner_text()
        page.get_by_role("link", name="My complaints").click()
        expect(page.get_by_role("cell", name=cid2)).to_be_visible()
        step("registered citizen files non-anonymous complaint and sees it in My complaints")

        # 10. Admin audit log
        logout(page)
        login(page, "admin@pg.in")
        page.get_by_role("link", name="Admin", exact=True).click()
        expect(page.get_by_role("cell", name="officer_action").first).to_be_visible()
        expect(page.get_by_role("cell", name="assign").first).to_be_visible()
        step("admin audit log shows officer_action and assign")

        assert not errors, errors
        browser.close()
    print(f"\nALL {len(results)} UI E2E STEPS PASSED")


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print("FAILED:", e); sys.exit(1)
