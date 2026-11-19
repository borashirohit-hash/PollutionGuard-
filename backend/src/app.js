const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const routes = require("./routes");
const extras = require("./extras");

const app = express();
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || "http://localhost:5173").split(","),
  }),
);
app.use(express.json({ limit: "1mb" }));
if (process.env.NODE_ENV !== "test") {
  app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));
  app.use("/api/track", rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }));
  app.use("/api/complaints", rateLimit({ windowMs: 60 * 1000, max: 120 }));
  app.use(
    "/api/evidence/validate-plate",
    rateLimit({ windowMs: 60 * 1000, max: 20 }),
  );
}
app.use("/api", extras);
app.use("/api", routes);
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use((err, req, res, next) =>
  res.status(err.status || 400).json({ error: err.message }),
);

module.exports = app;
