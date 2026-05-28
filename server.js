const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const https = require("https");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const ACCESS_KEY = process.env.BOKUN_ACCESS_KEY;
const SECRET_KEY = process.env.BOKUN_SECRET_KEY;

function bokun(method, path, body, cb) {
  const date = new Date().toISOString().replace("T"," ").substring(0,19);
  const sig = crypto.createHmac("sha1", SECRET_KEY).update(date + ACCESS_KEY + method + path).digest("base64");
  const opts = {
    hostname: "api.bokun.io", path, method,
    headers: { "X-Bokun-Date": date, "X-Bokun-AccessKey": ACCESS_KEY, "X-Bokun-Signature": sig, "Content-Type": "application/json;charset=UTF-8" }
  };
  const req = https.request(opts, res => {
    let d = "";
    res.on("data", c => d += c);
    res.on("end", () => cb(null, res.statusCode, d));
  });
  req.on("error", e => cb(e));
  if (body) req.write(JSON.stringify(body));
  req.end();
}

app.get("/", (_, res) => res.json({ status: "ok" }));

app.post("/proxy", (req, res) => {
  const path = req.query.path;
  bokun("POST", path, req.body, (err, status, data) => {
    if (err) return res.status(500).json({ error: err.message });
    try { res.status(status).json(JSON.parse(data)); } catch { res.status(status).send(data); }
  });
});

app.get("/proxy", (req, res) => {
  const path = req.query.path;
  bokun("GET", path, null, (err, status, data) => {
    if (err) return res.status(500).json({ error: err.message });
    try { res.status(status).json(JSON.parse(data)); } catch { res.status(status).send(data); }
  });
});

app.listen(process.env.PORT || 3000, () => console.log("Proxy running"));
