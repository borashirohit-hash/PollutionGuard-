const jwt = require("jsonwebtoken");
const { User, AuditLog } = require("./models");

const SECRET = () => process.env.JWT_SECRET || "dev-secret";

const sign = (user) =>
  jwt.sign({ id: user._id, role: user.role }, SECRET(), { expiresIn: "12h" });

async function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const p = jwt.verify(token, SECRET());
    const user = await User.findById(p.id);
    if (!user || user.accountStatus !== "active")
      return res.status(401).json({ error: "Invalid account" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

const allow =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: "Forbidden" });

const audit = (req, action, resourceType, resourceId, metadata) =>
  AuditLog.create({
    actorId: req.user?._id,
    actorRole: req.user?.role,
    action,
    resourceType,
    resourceId: String(resourceId || ""),
    metadata,
  }).catch(() => {});

module.exports = { sign, auth, allow, audit };
