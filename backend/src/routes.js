const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const {
  User,
  Complaint,
  ComplaintHistory,
  Assignment,
  Notification,
  AuditLog,
  RewardRequest,
  Setting,
  PoliceStation,
} = require("./models");
const { sign, auth, allow, audit } = require("./auth");
const { changeStatus, notify, slaDays, isOverdue } = require("./workflow");

const router = express.Router();
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(
        null,
        crypto.randomUUID() + path.extname(file.originalname).toLowerCase(),
      ),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Only JPG/PNG/WEBP images allowed")),
});

const wrap = (fn) => (req, res, next) =>
  fn(req, res, next).catch((e) =>
    res.status(e.status || 500).json({ error: e.message }),
  );
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const VEHICLE_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;
const cleanPlate = (v) => (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ---------- Auth ----------
router.post(
  "/auth/register",
  wrap(async (req, res) => {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password || password.length < 8)
      return res
        .status(400)
        .json({ error: "name, email and password (min 8 chars) required" });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ error: "Email already registered" });
    const user = await User.create({
      name,
      email,
      phone,
      passwordHash: await bcrypt.hash(password, 10),
      role: "citizen",
    });
    res
      .status(201)
      .json({
        token: sign(user),
        user: { id: user._id, name: user.name, role: user.role },
      });
  }),
);

router.post(
  "/auth/login",
  wrap(async (req, res) => {
    const user = await User.findOne({
      email: (req.body.email || "").toLowerCase(),
    });
    if (
      !user ||
      user.accountStatus !== "active" ||
      !(await bcrypt.compare(req.body.password || "", user.passwordHash))
    )
      return res.status(401).json({ error: "Invalid credentials" });
    req.user = user;
    audit(req, "login", "User", user._id);
    res.json({
      token: sign(user),
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        district: user.district,
      },
    });
  }),
);

router.get("/auth/me", auth, (req, res) =>
  res.json({
    id: req.user._id,
    name: req.user.name,
    role: req.user.role,
    district: req.user.district,
  }),
);

// ---------- Complaint submission (anonymous or logged in) ----------
async function optionalAuth(req, res, next) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) {
    try {
      const p = jwt.verify(h.slice(7), process.env.JWT_SECRET || "dev-secret");
      req.user = await User.findById(p.id);
    } catch {
      /* treat as anonymous */
    }
  }
  next();
}

async function callAi(file) {
  try {
    const buf = fs.readFileSync(file.path);
    const form = new FormData();
    form.append(
      "file",
      new Blob([buf], { type: file.mimetype }),
      file.originalname,
    );
    const r = await fetch(
      (process.env.AI_SERVICE_URL || "http://127.0.0.1:8000") + "/analyze",
      { method: "POST", body: form, signal: AbortSignal.timeout(20000) },
    );
    if (!r.ok) throw new Error("AI service " + r.status);
    return await r.json();
  } catch (e) {
    return {
      success: false,
      error: "AI analysis unavailable: " + e.message,
      review_required: true,
    };
  }
}

router.post(
  "/evidence/validate-plate",
  upload.single("image"),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Image is required" });
    try {
      const ai = await callAi(req.file);
      const plate = cleanPlate(ai?.plate?.plate_number || "");
      if (!VEHICLE_RE.test(plate))
        return res
          .status(422)
          .json({
            error:
              "No readable vehicle number plate was detected. Please choose a clear vehicle number-plate photo.",
          });
      res.json({
        valid: true,
        vehicleNumber: plate,
        note: "OCR detected a possible number plate. Please verify it before submitting.",
      });
    } finally {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }),
);

router.post(
  "/complaints",
  optionalAuth,
  upload.single("image"),
  wrap(async (req, res) => {
    const typed = cleanPlate(req.body.vehicleNumber);
    if (!req.file && !typed)
      return res
        .status(400)
        .json({
          error:
            "Add a number-plate photo or enter the vehicle number manually",
        });
    const ai = req.file
      ? await callAi(req.file)
      : {
          success: true,
          smoke: null,
          plate: null,
          review_required: true,
          note: "Manual vehicle number entry; evidence photo not supplied.",
        };
    if (
      (req.body.vehicleNumber &&
        String(req.body.vehicleNumber).trim() &&
        !typed) ||
      (typed && !VEHICLE_RE.test(typed))
    )
      return res
        .status(400)
        .json({ error: "Vehicle number format looks invalid" });
    const hasLat = req.body.latitude !== undefined && req.body.latitude !== "";
    const hasLng =
      req.body.longitude !== undefined && req.body.longitude !== "";
    const lat = hasLat ? Number(req.body.latitude) : undefined;
    const lng = hasLng ? Number(req.body.longitude) : undefined;
    if (
      hasLat !== hasLng ||
      (hasLat &&
        (!Number.isFinite(lat) ||
          lat < -90 ||
          lat > 90 ||
          !Number.isFinite(lng) ||
          lng < -180 ||
          lng > 180))
    )
      return res
        .status(400)
        .json({ error: "GPS coordinates are incomplete or invalid" });
    if (!hasLat && !(req.body.district && req.body.locationDescription))
      return res
        .status(400)
        .json({
          error: "Provide GPS location or a district and location description",
        });
    const complaintId =
      "PG" +
      new Date().getFullYear() +
      crypto.randomBytes(3).toString("hex").toUpperCase();
    const pin = String(crypto.randomInt(100000, 999999));
    const days = await slaDays();
    const confidential = req.body.confidential !== "false";
    const c = await Complaint.create({
      complaintId,
      trackingPinHash: sha(pin),
      reporterId:
        req.user && !(req.body.anonymous === "true") ? req.user._id : undefined,
      confidential,
      vehicleNumber: typed || cleanPlate(ai?.plate?.plate_number),
      imageReference: req.file?.filename,
      latitude: Number.isFinite(lat) ? lat : undefined,
      longitude: Number.isFinite(lng) ? lng : undefined,
      locationAccuracyMeters: Number.isFinite(
        Number(req.body.locationAccuracyMeters),
      )
        ? Number(req.body.locationAccuracyMeters)
        : undefined,
      locationCapturedAt: req.body.locationCapturedAt
        ? new Date(req.body.locationCapturedAt)
        : undefined,
      locationType: hasLat
        ? ["photo_capture", "submission", "manual"].includes(
            req.body.locationType,
          )
          ? req.body.locationType
          : "submission"
        : "manual",
      locationDescription: req.body.locationDescription,
      district: req.body.district,
      aiAnalysis: ai.smoke || ai,
      ocrResult: ai.plate,
      slaDueAt: new Date(Date.now() + days * 86400000),
      rewardRequested: req.body.rewardRequested === "true",
    });
    await ComplaintHistory.create({
      complaintId,
      previousStatus: null,
      newStatus: "Submitted",
      remarks: "Complaint submitted",
    });
    if (c.rewardRequested)
      await RewardRequest.create({ complaintId, confidentialRequest: true });
    const staff = await User.find({
      role: { $in: ["rto", "admin"] },
      ...(c.district
        ? {
            $or: [
              { district: c.district },
              { district: { $exists: false } },
              { role: "admin" },
            ],
          }
        : {}),
    });
    await Promise.all(
      staff.map((u) =>
        notify(
          u._id,
          complaintId,
          "New complaint",
          `Complaint ${complaintId} received for review`,
        ),
      ),
    );
    res
      .status(201)
      .json({
        complaintId,
        trackingPin: pin,
        slaDueAt: c.slaDueAt,
        ai,
        note: "Save your Complaint ID and PIN. The PIN is shown only once.",
      });
  }),
);

// Public tracking: complaint ID + PIN; no identity or evidence exposed
router.post(
  "/track",
  wrap(async (req, res) => {
    const { complaintId, pin } = req.body;
    const c = await Complaint.findOne({ complaintId });
    if (!c || c.trackingPinHash !== sha(pin))
      return res
        .status(404)
        .json({ error: "Complaint not found or PIN incorrect" });
    const history = await ComplaintHistory.find({ complaintId })
      .sort("timestamp")
      .select("newStatus timestamp remarks -_id");
    res.json({
      complaintId,
      status: c.status,
      submittedAt: c.submittedAt,
      slaDueAt: c.slaDueAt,
      vehicleNumber: c.vehicleNumber,
      history: history.map((h) => ({
        status: h.newStatus,
        at: h.timestamp,
        remarks: h.remarks,
      })),
    });
  }),
);

// ---------- Staff complaint endpoints ----------
const staff = [auth, allow("admin", "rto", "officer")];

function scopeFilter(user) {
  if (user.role === "officer") return { assignedOfficerId: user._id };
  if (user.role === "rto" && user.district)
    return { $or: [{ district: user.district }, { assignedRtoId: user._id }] };
  return {};
}

router.get(
  "/complaints",
  staff,
  wrap(async (req, res) => {
    const q = { ...scopeFilter(req.user) };
    const { status, district, search, overdue } = req.query;
    if (status) q.status = status;
    if (district) q.district = district;
    if (search) {
      const rx = new RegExp(
        String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      q.$and = [{ $or: [{ complaintId: rx }, { vehicleNumber: rx }] }];
    }
    let list = await Complaint.find(q).sort("-submittedAt").limit(500);
    if (overdue === "true") list = list.filter(isOverdue);
    res.json(
      list.map((c) => ({
        ...c.toObject(),
        trackingPinHash: undefined,
        overdue: isOverdue(c),
      })),
    );
  }),
);

router.get(
  "/complaints/:id",
  staff,
  wrap(async (req, res) => {
    const c = await Complaint.findOne({
      complaintId: req.params.id,
      ...scopeFilter(req.user),
    })
      .populate("assignedOfficerId", "name email")
      .populate("assignedRtoId", "name");
    if (!c) return res.status(404).json({ error: "Not found" });
    const history = await ComplaintHistory.find({
      complaintId: c.complaintId,
    }).sort("timestamp");
    const assignments = await Assignment.find({
      complaintId: c.complaintId,
    }).sort("assignedAt");
    res.json({
      ...c.toObject(),
      trackingPinHash: undefined,
      overdue: isOverdue(c),
      history,
      assignments,
    });
  }),
);

router.get(
  "/complaints/:id/image",
  staff,
  wrap(async (req, res) => {
    const c = await Complaint.findOne({
      complaintId: req.params.id,
      ...scopeFilter(req.user),
    });
    if (!c) return res.status(404).json({ error: "Not found" });
    res.sendFile(path.join(UPLOAD_DIR, path.basename(c.imageReference)));
  }),
);

// Admin/RTO: review -> verify/reject/return
router.post(
  "/complaints/:id/status",
  auth,
  allow("admin", "rto", "officer"),
  wrap(async (req, res) => {
    const c = await Complaint.findOne({
      complaintId: req.params.id,
      ...scopeFilter(req.user),
    }).select("+reporterId");
    if (!c) return res.status(404).json({ error: "Not found" });
    const { status, remarks } = req.body;
    const officerAllowed = ["Inspection Pending", "Returned for Clarification"];
    if (req.user.role === "officer" && !officerAllowed.includes(status))
      return res
        .status(403)
        .json({ error: "Officers use the action endpoint" });
    if (["Rejected", "Returned for Clarification"].includes(status) && !remarks)
      return res.status(400).json({ error: "Remarks required" });
    await changeStatus(c, status, req.user, remarks);
    audit(req, "status_change", "Complaint", c.complaintId, { status });
    res.json({ complaintId: c.complaintId, status: c.status });
  }),
);

router.post(
  "/complaints/:id/assign",
  auth,
  allow("admin", "rto"),
  wrap(async (req, res) => {
    const c = await Complaint.findOne({
      complaintId: req.params.id,
      ...scopeFilter(req.user),
    });
    if (!c) return res.status(404).json({ error: "Not found" });
    const { officerId, policeStation, priority, remarks } = req.body;
    const officer = mongoose.isValidObjectId(officerId)
      ? await User.findOne({
          _id: officerId,
          role: "officer",
          accountStatus: "active",
        })
      : null;
    if (!officer)
      return res.status(400).json({ error: "Valid officer required" });
    if (!["Under Review", "Verified", "Assigned to Officer"].includes(c.status))
      return res
        .status(400)
        .json({ error: `Cannot assign a complaint in status "${c.status}"` });
    if (
      (await PoliceStation.countDocuments()) > 0 &&
      !(await PoliceStation.findOne({ name: policeStation }))
    )
      return res
        .status(400)
        .json({ error: "Select a police station from the configured list" });
    if (c.status === "Under Review")
      await changeStatus(c, "Verified", req.user, "Verified during assignment");
    c.assignedOfficerId = officer._id;
    c.policeStation = policeStation;
    c.assignedRtoId = req.user._id;
    if (priority) c.priority = priority;
    if (c.status === "Assigned to Officer") {
      await c.save();
      await ComplaintHistory.create({
        complaintId: c.complaintId,
        previousStatus: c.status,
        newStatus: c.status,
        updatedBy: req.user._id,
        actorRole: req.user.role,
        remarks: remarks || `Reassigned to ${officer.name}`,
      });
    } else {
      await changeStatus(
        c,
        "Assigned to Officer",
        req.user,
        remarks || `Assigned to ${officer.name}`,
      );
    }
    await Assignment.create({
      complaintId: c.complaintId,
      assignedBy: req.user._id,
      assignedTo: officer._id,
      assignmentType: "officer",
      assignmentRemarks: remarks,
    });
    await notify(
      officer._id,
      c.complaintId,
      "New assignment",
      `Complaint ${c.complaintId} assigned to you`,
    );
    audit(req, "assign", "Complaint", c.complaintId, {
      officerId,
      policeStation,
    });
    res.json({ complaintId: c.complaintId, status: c.status });
  }),
);

// Officer: record inspection and action
router.post(
  "/complaints/:id/action",
  auth,
  allow("officer"),
  wrap(async (req, res) => {
    const c = await Complaint.findOne({
      complaintId: req.params.id,
      assignedOfficerId: req.user._id,
    });
    if (!c) return res.status(404).json({ error: "Not found" });
    const {
      inspectionResult,
      actionTaken,
      challanReference,
      challanStatus,
      complianceObservation,
    } = req.body;
    if (!inspectionResult)
      return res.status(400).json({ error: "inspectionResult required" });
    if (c.status === "Assigned to Officer")
      await changeStatus(
        c,
        "Inspection Pending",
        req.user,
        "Inspection started",
      );
    if (c.status === "Inspection Pending")
      await changeStatus(c, "Inspection Completed", req.user, inspectionResult);
    c.resolutionDetails = {
      inspectionResult,
      actionTaken,
      challanReference,
      challanStatus,
      complianceObservation,
    };
    await c.save();
    if (actionTaken)
      await changeStatus(c, "Action Taken", req.user, actionTaken);
    if (challanReference || challanStatus)
      await changeStatus(
        c,
        "Challan Status Updated",
        req.user,
        `Challan: ${challanStatus || challanReference}`,
      );
    audit(req, "officer_action", "Complaint", c.complaintId);
    const rtos = await User.find({ role: "rto" });
    await Promise.all(
      rtos.map((u) =>
        notify(
          u._id,
          c.complaintId,
          "Action report",
          `Officer action recorded for ${c.complaintId}`,
        ),
      ),
    );
    res.json({ complaintId: c.complaintId, status: c.status });
  }),
);

router.post(
  "/complaints/:id/close",
  auth,
  allow("admin", "rto"),
  wrap(async (req, res) => {
    const c = await Complaint.findOne({
      complaintId: req.params.id,
      ...scopeFilter(req.user),
    });
    if (!c) return res.status(404).json({ error: "Not found" });
    if (
      [
        "Action Taken",
        "Challan Status Updated",
        "Inspection Completed",
      ].includes(c.status)
    )
      await changeStatus(c, "Resolved", req.user, req.body.remarks);
    await changeStatus(
      c,
      "Closed",
      req.user,
      req.body.remarks || "Closed after review",
    );
    audit(req, "close", "Complaint", c.complaintId);
    res.json({ complaintId: c.complaintId, status: c.status });
  }),
);

// ---------- Notifications ----------
router.get(
  "/notifications",
  auth,
  wrap(async (req, res) =>
    res.json(
      await Notification.find({ recipientId: req.user._id })
        .sort("-createdAt")
        .limit(50),
    ),
  ),
);
router.post(
  "/notifications/read",
  auth,
  wrap(async (req, res) => {
    await Notification.updateMany(
      { recipientId: req.user._id },
      { readStatus: true },
    );
    res.json({ ok: true });
  }),
);

router.get(
  "/my-complaints",
  auth,
  allow("citizen"),
  wrap(async (req, res) => {
    const list = await Complaint.find({ reporterId: req.user._id })
      .sort("-submittedAt")
      .select("complaintId status submittedAt slaDueAt vehicleNumber");
    res.json(list);
  }),
);

// ---------- Stats & reports ----------
router.get(
  "/stats",
  staff,
  wrap(async (req, res) => {
    const list = await Complaint.find(scopeFilter(req.user));
    const by = (k) =>
      list.reduce(
        (a, c) => ((a[c[k] || "Unknown"] = (a[c[k] || "Unknown"] || 0) + 1), a),
        {},
      );
    const done = list.filter((c) => ["Resolved", "Closed"].includes(c.status));
    const avgDays = done.length
      ? done.reduce((s, c) => s + (c.updatedAt - c.submittedAt), 0) /
        done.length /
        86400000
      : null;
    const monthly = {};
    list.forEach((c) => {
      const k = c.submittedAt.toISOString().slice(0, 7);
      monthly[k] = (monthly[k] || 0) + 1;
    });
    res.json({
      total: list.length,
      byStatus: by("status"),
      byDistrict: by("district"),
      monthly,
      overdue: list.filter(isOverdue).length,
      pending: list.filter((c) =>
        ["Submitted", "Under Review"].includes(c.status),
      ).length,
      avgResolutionDays: avgDays,
    });
  }),
);

router.get(
  "/reports/complaints.csv",
  auth,
  allow("admin", "rto"),
  wrap(async (req, res) => {
    const list = await Complaint.find(scopeFilter(req.user)).sort(
      "-submittedAt",
    );
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      [
        "complaintId",
        "submittedAt",
        "vehicleNumber",
        "district",
        "status",
        "priority",
        "slaDueAt",
        "overdue",
      ].join(","),
    ].concat(
      list.map((c) =>
        [
          c.complaintId,
          c.submittedAt.toISOString(),
          c.vehicleNumber,
          c.district,
          c.status,
          c.priority,
          c.slaDueAt?.toISOString(),
          isOverdue(c),
        ]
          .map(esc)
          .join(","),
      ),
    );
    audit(req, "export_report", "Report", "complaints.csv");
    res.type("text/csv").attachment("complaints.csv").send(rows.join("\n"));
  }),
);

// ---------- Admin ----------
const admin = [auth, allow("admin")];
router.get(
  "/admin/users",
  admin,
  wrap(async (req, res) =>
    res.json(
      await User.find(req.query.role ? { role: req.query.role } : {})
        .select("-passwordHash")
        .sort("-createdAt"),
    ),
  ),
);

router.post(
  "/admin/users",
  admin,
  wrap(async (req, res) => {
    const { name, email, phone, password, role, district, assignedArea } =
      req.body;
    if (
      !["admin", "rto", "officer", "citizen"].includes(role) ||
      !password ||
      password.length < 8
    )
      return res
        .status(400)
        .json({ error: "Valid role and password (min 8) required" });
    const u = await User.create({
      name,
      email,
      phone,
      role,
      district,
      assignedArea,
      passwordHash: await bcrypt.hash(password, 10),
    });
    audit(req, "create_user", "User", u._id, { role });
    res.status(201).json({ id: u._id });
  }),
);

router.patch(
  "/admin/users/:id",
  admin,
  wrap(async (req, res) => {
    const patch = {};
    ["role", "district", "assignedArea", "accountStatus"].forEach(
      (k) => req.body[k] !== undefined && (patch[k] = req.body[k]),
    );
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ error: "Invalid id" });
    const u = await User.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!u) return res.status(404).json({ error: "Not found" });
    audit(req, "update_user", "User", req.params.id, patch);
    res.json({
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      district: u.district,
      assignedArea: u.assignedArea,
      accountStatus: u.accountStatus,
    });
  }),
);

router.get(
  "/admin/audit",
  admin,
  wrap(async (req, res) =>
    res.json(await AuditLog.find().sort("-timestamp").limit(200)),
  ),
);
router.get(
  "/admin/rewards",
  admin,
  wrap(async (req, res) =>
    res.json(await RewardRequest.find().sort("-createdAt")),
  ),
);
router.get(
  "/admin/settings",
  admin,
  wrap(async (req, res) => res.json({ slaDays: await slaDays() })),
);
router.put(
  "/admin/settings",
  admin,
  wrap(async (req, res) => {
    const d = Number(req.body.slaDays);
    if (!(d >= 1 && d <= 60))
      return res.status(400).json({ error: "slaDays must be 1-60" });
    await Setting.findOneAndUpdate(
      { key: "slaDays" },
      { value: d },
      { upsert: true },
    );
    audit(req, "update_settings", "Setting", "slaDays", { d });
    res.json({ slaDays: d });
  }),
);

router.get(
  "/officers",
  auth,
  allow("admin", "rto"),
  wrap(async (req, res) =>
    res.json(
      await User.find({ role: "officer", accountStatus: "active" }).select(
        "name email assignedArea district",
      ),
    ),
  ),
);

module.exports = router;
module.exports.scopeFilter = scopeFilter;
