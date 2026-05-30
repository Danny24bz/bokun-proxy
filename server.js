const express = require("express");
const https = require("https");
const crypto = require("crypto");
const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.header("Access-Control-Allow-Credentials", "true");
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
  const proposal = req.body.proposal;
  if (!proposal) return res.status(400).json({ error: "Missing proposal" });
  try {
    const bodyStr = JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1000, system: "Extract tour product details and return ONLY valid JSON with these exact keys: productName, description, duration, pricingCategories (array of {category,price,currency}), capacity, location, inclusions (string array), exclusions (string array), availabilityWindows, cancellationPolicy, meetingPoint, notes. Null for missing fields. No markdown, no backticks.", messages: [{ role: "user", content: "Extract from:\n\n" + proposal }] });
    const result = await new Promise((resolve, reject) => {
      const r = https.request({ hostname: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: { "Content-Type": "application/json", "x-api-key": (ANTHROPIC_KEY || "").trim(), "anthropic-version": "2023-06-01", "Content-Length": Buffer.byteLength(bodyStr) } }, res => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      r.on("error", reject);
      r.write(bodyStr);
      r.end();
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
    const h = dur.match(/(\d+)\s*h/i);
    const m = dur.match(/(\d+)\s*m/i);
    return { hours: h ? parseInt(h[1]) : 5, minutes: m ? parseInt(m[1]) : 0 };
  }
  const locName = typeof data.location === "object" ? (data.location.description || data.location.name || "Belize City") : (data.location || "Belize City");
  const meetPt = data.meetingPoint || locName;
  const dur = parseDur(data.duration);
  const capacity = data.capacity ? Number(String(data.capacity).replace(/\D/g, "")) || 14 : 14;
  const cats = data.pricingCategories || [];
  const adult = cats.find(p => /adult/i.test(p.category));
  const child = cats.find(p => /child/i.test(p.category));
  const adultAmt = adult ? adult.price * 100 : 8500;
  const childAmt = child ? child.price * 100 : 4500;
  const payload = {
    title: data.productName || "New Experience",
    shortDescription: (data.description || "").substring(0, 200),
    description: data.description || "",
    duration: { hours: dur.hours, minutes: dur.minutes },
    location: { name: locName, city: "Belize City", countryCode: "BZ" },
    bookingType: "DATE_AND_TIME",
    capacityType: "LIMITED",
    capacityType: "LIMITED",
    mainPaxInfo: [{ type: "ADULTS", required: true, minCount: 1, maxCount: capacity }],
    meetingType: { type: "MEET_ON_LOCATION", meetingPointAddresses: [{ title: meetPt, address: { addressLine1: meetPt, city: "Belize City", countryCode: "BZ" } }], dropoffService: false },
    boxSettings: { isBox: false },
    activation: { active: false },
    pricingCategories: { defaultId: 1153185, ids: [1153185, 1153187] },
    rates: { defaultRate: { id: 2364854 }, rates: [{ id: 2364854, pricesByCategory: [{ id: 1153185, amount: { amount: adultAmt, currency: "USD" } }, { id: 1153187, amount: { amount: childAmt, currency: "USD" } }] }] },
    availabilityRules: [{ frequency: "DAILY", startTime: "08:00", capacity: capacity }]
  };
  try {
    const result = await bokunPost(path, payload);
    let json; try { json = JSON.parse(result.body); } catch { json = { raw: result.body }; }
    res.status(result.status).json(json);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// DRAFT endpoint — Claude message drafting for Communication Agent
app.post("/draft", async (req, res) => {
  const { name, context, tone, channel, raw } = req.body;
  if (!context) return res.status(400).json({ error: "Missing context" });
  let prompt;
  if (raw) {
    prompt = context;
  } else {
    const toneMap = { professional: "professional and warm", urgent: "urgent but respectful", nurture: "gentle and helpful", confirmation: "clear and reassuring", proposal: "confident and professional" };
    const isShort = channel === "sms" || channel === "whatsapp";
    prompt = `You are the Communication Agent for Darwin McCulloch, a Belize-based strategy consultant and tour operator. Write a ${isShort ? "short SMS under 160 characters" : "professional email"} to ${name || "the recipient"} with a ${toneMap[tone] || "professional and warm"} tone. Context: ${context}. Sign as Darwin McCulloch. Return only the message text, nothing else.`;
  }
  try {
    const bodyStr = JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: prompt }] });
    const result = await new Promise((resolve, reject) => {
      const r = require("https").request({ hostname: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: { "Content-Type": "application/json", "x-api-key": (ANTHROPIC_KEY || "").trim(), "anthropic-version": "2023-06-01", "Content-Length": Buffer.byteLength(bodyStr) } }, res => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      r.on("error", reject); r.write(bodyStr); r.end();
    });
    const data = JSON.parse(result.body);
    if (data.error) return res.status(400).json({ error: data.error.message || JSON.stringify(data.error) });
    if (!data.content || !data.content.length) return res.status(400).json({ error: "No content returned", raw: result.body.substring(0, 200) });
    const text = data.content.find(b => b.type === "text");
    if (!text) return res.status(400).json({ error: "No text block found", raw: result.body.substring(0, 200) });
    res.json({ success: true, message: text.text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SMS endpoint — Twilio SMS sending for Communication Agent
app.post("/sms", async (req, res) => {
  const { to, body, from } = req.body;
  if (!to || !body) return res.status(400).json({ error: "Missing to or body" });
  const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM = from || process.env.TWILIO_PHONE_NUMBER;
  if (!TWILIO_SID || !TWILIO_TOKEN) return res.status(400).json({ error: "Twilio credentials not configured" });
  try {
    const formBody = `To=${encodeURIComponent(to)}&From=${encodeURIComponent(TWILIO_FROM)}&Body=${encodeURIComponent(body)}`;
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
    const result = await new Promise((resolve, reject) => {
      const r = require("https").request({ hostname: "api.twilio.com", path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${auth}`, "Content-Length": Buffer.byteLength(formBody) } }, res => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      r.on("error", reject); r.write(formBody); r.end();
    });
    const data = JSON.parse(result.body);
    if (data.sid) { res.json({ success: true, sid: data.sid, status: data.status }); }
    else { res.status(400).json({ error: data.message || "SMS failed" }); }
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// PUSH RESELLER PRODUCTS — Push accepted contract products to Bokun storefront
app.post("/push-reseller", async (req, res) => {
  const { products } = req.body;
  if (!products || !Array.isArray(products)) return res.status(400).json({ error: "Missing products array" });
  
  const results = [];
  
  for (const product of products) {
    const payload = {
      title: product.title,
      shortDescription: `Professional photography experience in ${product.location || "top destination"}. Capture your memories with a skilled photographer.`,
      description: `Book a professional photographer for a memorable photo shoot experience. Perfect for couples, families, solo travelers and special occasions. All photos delivered digitally.`,
      duration: { hours: 1, minutes: 0 },
      location: { name: product.location || "Destination", city: product.city || "Destination", countryCode: product.countryCode || "US" },
      bookingType: "DATE_AND_TIME",
      capacityType: "LIMITED",
      mainPaxInfo: [{ type: "ADULTS", required: true, minCount: 1, maxCount: 10 }],
      meetingType: { type: "MEET_ON_LOCATION", meetingPointAddresses: [{ title: "Meeting point provided upon booking", address: { addressLine1: "Meeting point provided upon booking", city: product.city || "Destination", countryCode: product.countryCode || "US" } }], dropoffService: false },
      boxSettings: { isBox: false },
      activation: { active: false },
      pricingCategories: { defaultId: 1153185, ids: [1153185, 1153187] },
      rates: { defaultRate: { id: 2364854 }, rates: [{ id: 2364854, pricesByCategory: [{ id: 1153185, amount: { amount: product.adultPrice || 15000, currency: "USD" } }, { id: 1153187, amount: { amount: product.childPrice || 10000, currency: "USD" } }] }] },
      availabilityRules: [{ frequency: "DAILY", startTime: "09:00", capacity: 10 }],
      resellerProductId: product.sourceId
    };
    
    try {
      const result = await bokunPost("/restapi/v2.0/experience", payload);
      let json;
      try { json = JSON.parse(result.body); } catch { json = { raw: result.body }; }
      results.push({ title: product.title, status: result.status, bokun_id: json.id || json.experienceId || null, error: json.error || null });
    } catch (e) {
      results.push({ title: product.title, status: 500, error: e.message });
    }
  }
  
  const success = results.filter(r => r.status === 200 || r.status === 201).length;
  const failed = results.filter(r => r.status !== 200 && r.status !== 201).length;
  
  res.json({ success: true, total: results.length, pushed: success, failed, results });
});

// GET RESELLER PRODUCTS STATUS
app.get("/storefront", async (req, res) => {
  try {
    const result = await bokunGet("/restapi/v2.0/experience/list?vendorId=137489&pageSize=50");
    res.status(result.status).send(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log("Bokun proxy running"));
