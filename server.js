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

app.post("/extract", async (req, res) => {
  const { proposal } = req.body;
  if (!proposal) return res.status(400).json({ error: "Missing proposal" });
  const key = (ANTHROPIC_KEY || "").trim();
  console.log("ANTHROPIC_KEY length:", key.length, "starts:", key.substring(0, 10));
  try {
    const result = await httpsPost("api.anthropic.com", "/v1/messages", {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    }, {
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: "Extract tour product details and return ONLY valid JSON with these exact keys: productName, description, duration, pricingCategories (array of {category,price,currency}), capacity, location, inclusions (string array), exclusions (string array), availabilityWindows, cancellationPolicy, meetingPoint, notes. Null for missing fields. No markdown, no backticks.",
      messages: [{ role: "user", content: "Extract from:\n\n" + proposal }]
    });
    console.log("Anthropic status:", result.status, result.body.substring(0, 200));
    const data = JSON.parse(result.body);
    if (data.error) return res.status(400).json({ error: data.error.message });
    const raw = data.content.find(b => b.type === "text").text;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in response");
    const extracted = JSON.parse(match[0]);
    res.json({ success: true, data: extracted });
  } catch (e) {
    console.error("Extract error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/push", async (req, res) => {
  const data = req.body;
  const path = "/restapi/v2.0/experience";
  const payload = {
    title: data.title ?? "New Experience",
    shortDescription: data.shortDescription ?? "",
    description: data.description ?? "",
    duration: data.duration ?? { hours: 5, minutes: 0 },
    location: data.location ?? {},
    inclusions: data.inclusions ?? "",
    exclusions: data.exclusions ?? "",
    cancellationPolicy: data.cancellationPolicy ?? "",
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
