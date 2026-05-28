const express = require("express");
const https = require("https");
const crypto = require("crypto");
const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json());
const ACCESS_KEY = process.env.BOKUN_ACCESS_KEY;
const SECRET_KEY = process.env.BOKUN_SECRET_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const opts = { hostname, path, method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(bodyStr) } };
    const req = https.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}
function bokunHeaders(method, path) {
  const date = new Date().toISOString().replace("T", " ").substring(0, 19);
  const sig = crypto.createHmac("sha1", SECRET_KEY).update(date + ACCESS_KEY + method + path).digest("base64");
  return { "X-Bokun-Date": date, "X-Bokun-AccessKey": ACCESS_KEY, "X-Bokun-Signature": sig, "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json" };
}
app.get("/", (_, res) => res.json({ status: "ok", service: "Bokun Proxy" }));
app.post("/extract", async (req, res) => {
  const { proposal } = req.body;
  if (!proposal) return res.status(400).json({ error: "Missing proposal" });
  try {
    const result = await httpsPost("api.anthropic.com", "/v1/messages", { "Content-Type": "application/json", "x-api-key": (ANTHROPIC_KEY || "").trim(), "anthropic-version": "2023-06-01" }, { model: "claude-sonnet-4-6", max_tokens: 1000, system: "Extract tour product details and return ONLY valid JSON with these exact keys: productName, description, duration, pricingCategories (array of {category,price,currency}), capacity, location, inclusions (string array), exclusions (string array), availabilityWindows, cancellationPolicy, meetingPoint, notes. Null for missing fields. No markdown, no backticks.", messages: [{ role: "user", content: "Extract from:\n\n" + proposal }] });
    const data = JSON.parse(result.body);
    if (data.error) return res.status(400).json({ error: data.error.message });
    const raw = data.content.find(b => b.type === "text").text;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found");
    res.json({ success: true, data: JSON.parse(match[0]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/push", async (req, res) => {
  const data = req.body;
  const path = "/restapi/v2.0/experience";
  function parseDur(dur) {
    if (!dur) return { hours: 5, minutes: 0 };
    if (typeof dur === "object") return dur;
    const h = dur.match(/(\d+)\s*h/i), m = dur.match(/(\d+)\s*m/i);
    return { hours: h ? parseInt(h[1]) : 5, minutes: m ? parseInt(m[1]) : 0 };
  }
  const locName = typeof data.location === "object" ? (data.location.description || data.location.name || "Belize City") : (data.location || "Belize City");
  const meetPt = data.meetingPoint || locName;
  const dur = parseDur(data.duration);
  const payload = {
    title: data.productName || "New Experience",
    description: { shortDescription: (data.description || "").substring(0, 200), fullDescription: data.description || "" },
    duration: { hours: dur.hours, minutes: dur.minutes },
    location: { name: locName, countryCode: "BZ", city: "Belize City" },
    bookingType: "DATE_AND_TIME",
    capacityType: "LIMITED",
    meetingType: { type: "MEET_ON_LOCATION", meetingPointAddresses: [{ title: meetPt, address: { addressLine1: meetPt, city: "Belize City", countryCode: "BZ" } }], dropoffService: false },
    boxSettings: { isBox: false },
    activation: { activated: false },
    pricingCategories: [],
    availabilityRules: []
  };
  try {
    const result = await httpsPost("api.bokun.io", path, bokunHeaders("POST", path), payload);
    console.log("Bokun:", result.status, result.body.substring(0, 300));
    let json; try { json = JSON.parse(result.body); } catch { json = { raw: result.body }; }
    res.status(result.status).json(json);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.listen(process.env.PORT || 3000, () => console.log("Bokun proxy running"));
