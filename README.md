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
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

function bokunGet(path) {
  return new Promise((resolve, reject) => {
    const date = new Date().toISOString().replace("T", " ").substring(0, 19);
    const sig = crypto.createHmac("sha1", SECRET_KEY).update(date + ACCESS_KEY + "GET" + path).digest("base64");
    const req = https.request({ hostname: "api.bokun.io", path, method: "GET", headers: { "X-Bokun-Date": date, "X-Bokun-AccessKey": ACCESS_KEY, "X-Bokun-Signature": sig, "Accept": "application/json" } }, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject); req.end();
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
    req.on("error", reject); req.write(bodyStr); req.end();
  });
}

app.get("/", (_, res) => res.json({ status: "ok", service: "Bokun Proxy", version: "2.1" }));

app.get("/getproduct", async (req, res) => {
  try {
    const result = await bokunGet("/restapi/v2.0/experience/1195229/components?componentType=PRICING_CATEGORIES&componentType=RATES");
    res.status(result.status).send(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/getfullproduct", async (req, res) => {
  try {
    const result = await bokunGet("/restapi/v2.0/experience/1195229/components?componentType=PRICING_CATEGORIES&componentType=RATES&componentType=START_TIMES&componentType=AVAILABILITY_RULES&componentType=MEETING_TYPE&componentType=TICKET&componentType=CUTOFF&componentType=ACTIVATION");
    res.status(result.status).send(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/storefront", async (req, res) => {
  try {
    const result = await bokunGet("/restapi/v2.0/experience/vendor/137489/list?pageSize=50");
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
      r.on("error", reject); r.write(bodyStr); r.end();
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
    if (!dur) return { weeks: 0, days: 0, hours: 1, minutes: 0 };
    if (typeof dur === "object") return { weeks: 0, days: dur.days || 0, hours: dur.hours || 1, minutes: dur.minutes || 0 };
    const h = dur.match(/(\d+)\s*h/i);
    const m = dur.match(/(\d+)\s*m/i);
    return { weeks: 0, days: 0, hours: h ? parseInt(h[1]) : 1, minutes: m ? parseInt(m[1]) : 0 };
  }

  const locName = typeof data.location === "object" ? (data.location.description || data.location.name || "Belize City") : (data.location || "Belize City");
  const meetPt = data.meetingPoint || locName;
  const dur = parseDur(data.duration);
  const cats = data.pricingCategories || [];
  const adult = cats.find(p => /adult/i.test(p.category));
  const child = cats.find(p => /child/i.test(p.category));
  const adultAmt = adult ? Math.round(adult.price * 100) : 8500;
  const childAmt = child ? Math.round(child.price * 100) : 4500;

  const payload = {
    title: data.productName || "New Experience",
    shortDescription: (data.description || "").substring(0, 200),
    description: data.description || "",
    type: "DAY_TOUR_OR_ACTIVITY",
    difficultyLevel: "EASY",
    privateExperience: false,
    allowCustomizedBookings: false,
    duration: { weeks: 0, days: 0, hours: dur.hours, minutes: dur.minutes },
    location: { name: locName, city: "Belize City", countryCode: "BZ" },
    bookingType: "DATE_AND_TIME",
    capacityType: "LIMITED",
    ticket: { ticketPerPerson: true, barcodeFormat: "QR_CODE" },
    cutoff: { type: "RELATIVE_TO_START_TIME", weeks: 0, days: 1, hours: 0, minutes: 0 },
    startTimes: [{ hour: 9, minute: 0 }],
    meetingType: { type: "MEET_ON_LOCATION", meetingPointAddresses: [{ title: meetPt, address: { addressLine1: meetPt, city: "Belize City", countryCode: "BZ" } }], dropoffService: false },
    boxSettings: { isBox: false },
    combo: { isCombo: false },
    activation: { activated: false },
    pricingCategories: { defaultId: 1153185, ids: [1153185, 1153187] },
    rates: {
      defaultRate: { externalId: "default-rate" },
      rates: [{
        title: "Standard Rate",
        description: "Standard rate for this experience",
        externalId: "default-rate",
        cancellationPolicyId: 258744,
        pricingCategoryIds: [1153185, 1153187],
        pricedPerPerson: true,
        allPricingCategories: false,
        allStartTimes: true,
        tieredPricingEnabled: false
      }]
    },
    pricing: {
      priceCatalogCurrencies: [{ priceCatalogId: 157725, currencies: ["USD"], defaultCurrency: "USD" }],
      experiencePriceRules: [
        { pricingCategoryId: 1153185, amount: adultAmt, currency: "USD", priceCatalogId: 157725, rate: { externalId: "default-rate" } },
        { pricingCategoryId: 1153187, amount: childAmt, currency: "USD", priceCatalogId: 157725, rate: { externalId: "default-rate" } }
      ]
    },
    availabilityRules: [{ recurrenceRule: {}, allStartTimes: true, maxCapacity: 14 }]
  };

  try {
    const result = await bokunPost(path, payload);
    console.log("Bokun:", result.status, result.body.substring(0, 300));
    let json; try { json = JSON.parse(result.body); } catch { json = { raw: result.body }; }
    if ((result.status === 200 || result.status === 201) && json.id) {
      pushedProductIds.push(json.id);
      // Auto-activate immediately after push
      try {
        await bokunPost("/restapi/v2.0/experience/" + json.id + "/activation", { activated: true });
        json.activated = true;
      } catch(activateErr) {
        json.activationError = activateErr.message;
      }
    }
    res.status(result.status).json(json);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
      const r = https.request({ hostname: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: { "Content-Type": "application/json", "x-api-key": (ANTHROPIC_KEY || "").trim(), "anthropic-version": "2023-06-01", "Content-Length": Buffer.byteLength(bodyStr) } }, res => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      r.on("error", reject); r.write(bodyStr); r.end();
    });
    const data = JSON.parse(result.body);
    if (data.error) return res.status(400).json({ error: data.error.message || JSON.stringify(data.error) });
    if (!data.content || !data.content.length) return res.status(400).json({ error: "No content returned", raw: result.body.substring(0, 200) });
    const text = data.content.find(b => b.type === "text");
    if (!text) return res.status(400).json({ error: "No text block found" });
    res.json({ success: true, message: text.text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/sms", async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: "Missing to or body" });
  if (!TWILIO_SID || !TWILIO_TOKEN) return res.status(400).json({ error: "Twilio credentials not configured" });
  try {
    const formBody = `To=${encodeURIComponent(to)}&From=${encodeURIComponent(TWILIO_FROM)}&Body=${encodeURIComponent(body)}`;
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
    const result = await new Promise((resolve, reject) => {
      const r = https.request({ hostname: "api.twilio.com", path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${auth}`, "Content-Length": Buffer.byteLength(formBody) } }, res => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      r.on("error", reject); r.write(formBody); r.end();
    });
    const data = JSON.parse(result.body);
    if (data.sid) { res.json({ success: true, sid: data.sid, status: data.status }); }
    else { res.status(400).json({ error: data.message || "SMS failed" }); }
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// EMAIL endpoint — Send via Google Workspace darwin@dvarix.com
app.post("/email", async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: "Missing to or body" });

  const GMAIL_USER = process.env.GMAIL_USER || "darwin@dvarix.com";
  const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");

  if (!GMAIL_PASS) return res.status(400).json({ error: "Gmail app password not configured" });

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS }
    });

    const info = await transporter.sendMail({
      from: "Darwin McCulloch <" + GMAIL_USER + ">",
      to: to,
      subject: subject || "Message from Darwin McCulloch — Dvarix",
      text: body
    });

    res.json({ success: true, messageId: info.messageId, message: "Email sent from " + GMAIL_USER });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



// GET PRICING — fetch pricing component from reference product
app.get("/getpricing", async (req, res) => {
  try {
    const result = await bokunGet("/restapi/v2.0/experience/1195229/components?componentType=PRICING");
    res.status(result.status).send(result.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ACTIVATE endpoint — activate a product in Bokun
app.post("/activate", async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: "Missing productId" });
  try {
    const result = await bokunPost("/restapi/v2.0/experience/" + productId + "/activation", { activated: true });
    let json; try { json = JSON.parse(result.body); } catch { json = { raw: result.body }; }
    res.status(result.status).json({ success: result.status === 200, productId, status: result.status, data: json });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// LIST PRODUCTS endpoint — returns pushed product IDs stored in memory
const pushedProductIds = [];
app.get("/listproducts", async (req, res) => {
  if (pushedProductIds.length === 0) {
    return res.json({ products: [], message: "No products tracked yet — push products first" });
  }
  res.json({ products: pushedProductIds.map(id => ({ id, activated: false })) });
});

// NEW AI ENDPOINT
app.post("/ai", async (req, res) => {
  const { prompt, maxTokens, system } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });
  try {
    const bodyObj = { model: "claude-sonnet-4-6", max_tokens: maxTokens || 2000, messages: [{ role: "user", content: prompt }] };
    if (system) bodyObj.system = system;
    const bodyStr = JSON.stringify(bodyObj);
    const result = await new Promise((resolve, reject) => {
      const r = https.request({ hostname: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: { "Content-Type": "application/json", "x-api-key": (ANTHROPIC_KEY || "").trim(), "anthropic-version": "2023-06-01", "Content-Length": Buffer.byteLength(bodyStr) } }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
      r.on("error", reject); r.write(bodyStr); r.end();
    });
    const data = JSON.parse(result.body);
    if (data.error) return res.status(400).json({ error: data.error.message });
    const text = data.content.find(b => b.type === "text");
    if (!text) return res.status(400).json({ error: "No text returned" });
    res.json({ success: true, text: text.text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RESERVATIONS — pulls real booking data from Bokun ──
// Bokun API: /restapi/v2.0/booking.json/vendor/list with date range
app.get("/reservations", async (req, res) => {
  try {
    // Default to last 90 days if no range specified
    const daysBack = parseInt(req.query.days) || 90;
    const endDate  = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const fmt = d => d.toISOString().split('T')[0]; // YYYY-MM-DD

    // Bokun booking list endpoint for vendor
    const path = `/restapi/v2.0/booking.json/vendor/${process.env.BOKUN_VENDOR_ID || '137489'}/list?` +
      `startDate=${fmt(startDate)}&endDate=${fmt(endDate)}&pageSize=100&status=CONFIRMED`;

    const result = await bokunGet(path);

    if (result.status === 404 || result.status === 403) {
      // Try alternative Bokun booking endpoint
      const altPath = `/restapi/v2.0/booking.json/list?vendorId=${process.env.BOKUN_VENDOR_ID || '137489'}&pageSize=100`;
      const altResult = await bokunGet(altPath);
      const data = JSON.parse(altResult.body);
      return res.json({ success: true, source: 'alt', bookings: data.results || data.bookings || data || [], total: data.totalHits || 0 });
    }

    const data = JSON.parse(result.body);
    const bookings = data.results || data.bookings || data || [];

    // Summarise real commission data per product/operator
    const summary = bookings.map(b => ({
      id:            b.id || b.bookingId,
      date:          b.creationDate || b.bookingDate,
      product:       b.experienceTitle || b.productName || b.title || '—',
      productId:     b.experienceId || b.productId,
      channel:       b.salesChannel || b.channel || 'direct',
      totalPrice:    b.totalPrice?.amount || b.price || 0,
      currency:      b.totalPrice?.currency || 'USD',
      status:        b.status || 'CONFIRMED',
      participants:  b.participants || b.guestCount || 1
    }));

    res.json({
      success: true,
      period: { start: fmt(startDate), end: fmt(endDate), days: daysBack },
      total: summary.length,
      bookings: summary
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Bokun proxy running"));
