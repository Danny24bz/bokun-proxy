const express = require("express");
const https   = require("https");
const crypto  = require("crypto");

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

const ACCESS_KEY    = process.env.BOKUN_ACCESS_KEY;
const SECRET_KEY    = process.env.BOKUN_SECRET_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname, path, method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(bodyStr) }
    };
    const req = https.request(opts, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

function bokunHeaders(method, path) {
  const date = new Date().toISOString().replace("T", " ").substring(0, 19);
  const sig = crypto.createHmac("sha1", SECRET_KEY).update(date + ACCESS_KEY + method + path).digest("base64");
  return {
    "X-Bokun-Date": date,
    "X-Bokun-AccessKey": ACCESS_KEY,
    "X-Bokun-Signature": sig,
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json"
  };
}

app.get("/", (_, res) => res.json({ status: "ok", service: "Bokun Proxy" }));

app.post("/push", async (req, res) => {
  const data = req.body;
  const path = "/restapi/v2.0/experience";
  const payload = {
    title: data.title ?? "New Experience",
    shortDescription: data.shortDescription ?? "",
    description: data.description ?? "",
    duration: data.duration ?? { hours: 5, minutes: 0 },
    location: {
      name: data.location?.description ?? "Belize City",
      countryCode: "BZ",
      city: "Belize City"
    },
    inclusions: [],
    exclusions: [],
    bookingType: { type: "DATE_AND_TIME" },
    capacityType: { type: "LIMITED" },
    meetingType: { type: "MEET_ON_LOCATION" },
    type: "EXPERIENCE",
    pricingCategories: [],
    rates: []
  };
  try {
    const result = await httpsPost("api.bokun.io", path, bokunHeaders("POST", path), payload);
    console.log("Bokun response:", result.status, result.body.substring(0, 300));
    let json;
    try { json = JSON.parse(result.body); } catch { json = { raw: result.body }; }
    res.status(result.status).json(json);
  } catch (e) {
    console.error("Push error:", e.message);
    res.status(500).json({ error: e.message });
  }
});
This fixes bookingType, capacityType and meetingType all at once. Commit and tell me when Deployment successful.Sonnet 4.6
});

app.post("/push", async (req, res) => {
  const data = req.body;
  const path = "/restapi/v2.0/experience";
  const payload = {
    title: data.title ?? "New Experience",
    shortDescription: data.shortDescription ?? "",
    description: data.description ?? "",
    duration: data.duration ?? { hours: 5, minutes: 0 },
    location: { name: data.location?.description ?? "", countryCode: "BZ", city: "Belize City" },
    inclusions: [],
    exclusions: [],
    bookingType: "DATE_AND_TIME",
    capacityType: "LIMITED",
    meetingType: "MEET_ON_LOCATION",
    type: "EXPERIENCE",
    pricingCategories: data.pricingCategories ?? [],
    rates: data.rates ?? []
  };
  try {
    const result = await httpsPost("api.bokun.io", path, bokunHeaders("POST", path), payload);
    console.log("Bokun response:", result.status, result.body.substring(0, 300));
    let json;
    try { json = JSON.parse(result.body); } catch { json = { raw: result.body }; }
    res.status(result.status).json(json);
  } catch (e) {
    console.error("Push error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Bokun proxy running"));
