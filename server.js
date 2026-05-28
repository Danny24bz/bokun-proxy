const express = require("express");
const cors    = require("cors");
const crypto  = require("crypto");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const BOKUN_ACCESS_KEY = process.env.BOKUN_ACCESS_KEY;
const BOKUN_SECRET_KEY = process.env.BOKUN_SECRET_KEY;
const BOKUN_BASE_URL   = "https://api.bokun.io";

function buildHeaders(method, path) {
  const date    = new Date().toISOString().replace("T", " ").substring(0, 19);
  const message = date + BOKUN_ACCESS_KEY + method.toUpperCase() + path;
  const sig     = crypto.createHmac("sha1", BOKUN_SECRET_KEY).update(message).digest("base64");
  return {
    "X-Bokun-Date":      date,
    "X-Bokun-AccessKey": BOKUN_ACCESS_KEY,
    "X-Bokun-Signature": sig,
    "Content-Type":      "application/json;charset=UTF-8",
    "Accept":            "application/json"
  };
}

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Bókun Proxy", vendor: process.env.BOKUN_VENDOR_ID });
});

app.post("/proxy", async (req, res) => {
  const bokunPath = req.query.path;
  if (!bokunPath) return res.status(400).json({ error: "Missing ?path= param" });

  try {
    const headers  = buildHeaders("POST", bokunPath);
    const url      = BOKUN_BASE_URL + bokunPath;
    console.log("POST", url);
    console.log("Headers:", JSON.stringify(headers));
    console.log("Body:", JSON.stringify(req.body));

    const response = await fetch(url, {
      method:  "POST",
      headers,
      body:    JSON.stringify(req.body)
    });

    const text = await response.text();
    console.log("Bókun response:", response.status, text.substring(0, 500));

    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/proxy", async (req, res) => {
  const bokunPath = req.query.path;
  if (!bokunPath) return res.status(400).json({ error: "Missing ?path= param" });

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
