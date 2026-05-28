const express = require("express");
const cors    = require("cors");
const crypto  = require("crypto");
const fetch   = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app  = express();
app.use(cors());
app.use(express.json());

const BOKUN_ACCESS_KEY = process.env.BOKUN_ACCESS_KEY;
const BOKUN_SECRET_KEY = process.env.BOKUN_SECRET_KEY;
const BOKUN_BASE_URL   = "https://api.bokun.io";

// ── Build Bókun HMAC-SHA1 headers ─────────────────────────────────
function buildHeaders(method, path) {
  const date    = new Date().toISOString().replace("T", " ").substring(0, 19);
  const message = date + BOKUN_ACCESS_KEY + method.toUpperCase() + path;
  const sig     = crypto.createHmac("sha1", BOKUN_SECRET_KEY).update(message).digest("base64");
  return {
    "X-Bokun-Date":      date,
    "X-Bokun-AccessKey": BOKUN_ACCESS_KEY,
    "X-Bokun-Signature": sig,
    "Content-Type":      "application/json;charset=UTF-8"
  };
}

// ── Health check ──────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Bókun Proxy", vendor: process.env.BOKUN_VENDOR_ID });
});

// ── Generic proxy — forwards any Bókun API call ───────────────────
// POST /proxy?path=/activity.json/save-activity
app.post("/proxy", async (req, res) => {
  const bokunPath = req.query.path;
  if (!bokunPath) return res.status(400).json({ error: "Missing ?path= query param" });

  try {
    const headers  = buildHeaders("POST", bokunPath);
    const response = await fetch(BOKUN_BASE_URL + bokunPath, {
      method:  "POST",
      headers,
      body:    JSON.stringify(req.body)
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET proxy — for availability / product lookups ────────────────
app.get("/proxy", async (req, res) => {
  const bokunPath = req.query.path;
  if (!bokunPath) return res.status(400).json({ error: "Missing ?path= query param" });

  try {
    const headers  = buildHeaders("GET", bokunPath);
    const response = await fetch(BOKUN_BASE_URL + bokunPath, { method: "GET", headers });
    const text     = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bókun proxy running on port ${PORT}`));
