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

function bokunGet(path) {
  return new Promise((resolve, reject) => {
    const date = new Date().toISOString().replace("T", " ").substring(0, 19);
    const sig = crypto.createHmac("sha1", SECRET_KEY).update(date + ACCESS_KEY + "GET" + path).digest("base64");
    const req = https.request({ hostname: "api.bokun.io", path, method: "GET", headers: { "X-Bokun-Date": date, "X-Bokun-AccessKey": ACCESS_KEY, "X-Bokun-Signature": sig, "Accept": "application/json" } }, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.end();
  });
}

function bokunPost(path, body) {
  return new Promise((resolve, reject) => {
    const date = new Date().toISOString().replace("T", " ").substring(0, 19);
    const sig = crypto.createHmac("sha1", SECRET_KEY).update(date + ACCESS_KEY + "POST" + path).digest("base64");
    const bodyStr = JSON.stringify(body);
    const req = https.request({ hostname: "api.bokun.io", path, method: "POST", headers: { "X-Bokun-Date": date, "X-Bokun-AccessKey": ACCESS_KEY, "X-Bokun-Signature": sig, "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json", "Content-Length": Buffer.byteLength(bodyStr) } }, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

app.get("/", (_, res) => res.json({ status: "ok", service: "Bokun Proxy" }));

app.get("/getproduct", async (req, res) => {
  try {
    const result = await bokunGet("/restapi/v2.0/experience/1195229/components?componentType=PRICING_CATEGORIES&componentType=RATES");
    res.status(result.status).send(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/extract", async (req, res) => {
  const { proposal } = req.body;
  if (!proposal) return res.status(400).json({ error: "Missing proposal" });
  try {
    const bodyStr = JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system: "Extract tour product details and return ONLY valid JSON with these exact keys: productName, description, duration, pricingCategories (array of {category,price,currency}), capacity, location, inclusions (string array), exclusions (string array), availabilityWindows, cancellationPolicy, meetingPoint, notes. Null for missing fields. No markdown, no backticks.", messages: [{ role: "user", content: "Extract from:\n\n" + proposal }] });
    const result = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: { "Content-Type": "application/json", "x-api-key": (ANTHROPIC_KEY || "").trim(), "anthropic-version": "2023-06-01", "Content-Length": Buffer.byteLength(bodyStr) } }, res => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      req.on("error", reject);
      req.write(bodyStr);
      req.end();
    });
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
  const capacity = data.capacity ? Number(String(data.capacity).replace(/\D/g, "")) || 14 : 14;
  const adultPrice = (data.pricingCategories && data.pricingCategories.find(p => p.category === "Adult" || p.category === "adult")) ? data.pricingCategories.find(p => p.category === "Adult" || p.category === "adult").price * 100 : 8500;
  const childPrice = (data.pricingCategories && data.pricingCategories.find(p => p.category === "Child" || p.category === "child")) ? data.pricingCategories.find(p => p.category === "Child" || p.category === "child").price * 100 : 4500;
  const payload = {
    title: data.productName || "New Experience",
    shortDescription: (data.description || "").substring(0, 200),
    description: data.description || "",
    duration: { hours: dur.hours, minutes: dur.minutes },
    location: { name: locName, city: "Belize City", countryCode: "BZ" },
    bookingType: "DATE_AND_TIME",
    capacityType: "LIMITED",
    capacity: capacity,
    meetingType: [{ title: meetPt, address: { addressLine1: meetPt, city: "Belize City", countryCode: "BZ" } }], dropoffService: false },
    boxSettings: { isBox: false },
    activation: { active: false },
    pricingCategories: { defaultId: 1153185, ids: [1153185, 1153187] },
    rates: {
      defaultRate: { id: 2364854 },
      rates: [{
        id: 2364854,
        pricesByCategory: [
          { id: 1153185, amount: { amount: adultPrice, currency: "USD" } },
          { id: 1153187, amount: { amount: childPrice, currency: "USD" } }
        ]
      }]
    },
    availabilityRules: [{ frequency: "DAILY", startTime: "08:00", capacity: capacity }]
  };
  try {
    const result = await bokunPost(path, payload);
    console.log("Bokun:", result.status, result.body.substring(0, 300));
    let json; try { json = JSON.parse(result.body); } catch { json = { raw: result.body }; }
    res.status(result.status).json(json);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log("Bokun proxy running"));
