const express = require("express");
const crypto  = require("crypto");
const https   = require("https");

const app = express();

// ── Explicit CORS for all origins ─────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

const ACCESS_KEY = process.env.BOKUN_ACCESS_KEY;
const SECRET_KEY = process.env.BOKUN_SECRET_KEY;

function bokun(method, path, body, cb) {
  const date = new Date().toISOString().replace("T"," ").substring(0,19);
  const sig = crypto.createHmac("sha1", SECRET_KEY)
    .update(date + ACCESS_KEY + method + path).digest("base64");
  const bodyStr = body ? JSON.stringify(body) : null;
  const opts = {
    hostname: "api.bokun.io",
    path,
    method,
    headers: {
      "X-Bokun-Date": date,
      "X-Bokun-AccessKey": ACCESS_KEY,
      "X-Bokun-Signature": sig,
      "Content-Type": "application/json;charset=UTF-8",
      "Accept": "application/json"
    }
  };
  if (bodyStr) opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);
  const req = https.request(opts, res => {
    let d = "";
    res.on("data", c => d += c);
    res.on("end", () => cb(null, res.statusCode, d));
  });
  req.on("error", e => cb(e));
  if (bodyStr) req.write(bodyStr);
  req.end();
}

app.get("/", (_, res) => res.json({ status: "ok", service: "Bókun Proxy" }));

app.post("/proxy", (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: "Missing ?path=" });
  console.log("POST /proxy", path, JSON.stringify(req.body).substring(0,100));
  bokun("POST", path, req.body, (err, status, data) => {
    if (err) { console.error(err); return res.status(500).json({ error: err.message }); }
    console.log("Bókun", status, data.substring(0,200));
    try { res.status(status).json(JSON.parse(data)); }
    catch { res.status(status).send(data); }
  });
});

app.get("/proxy", (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: "Missing ?path=" });
  bokun("GET", path, null, (err, status, data) => {
    if (err) return res.status(500).json({ error: err.message });
    try { res.status(status).json(JSON.parse(data)); }
    catch { res.status(status).send(data); }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bókun proxy running on port", PORT));
