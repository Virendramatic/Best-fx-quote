const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, etc)
app.use(express.static(path.join(__dirname)));

const PORT = 3001;

// ─── WISE ────────────────────────────────────────────────────────────────────
// POST /wise
// Body: { targetCurrency, targetAmount }
// Gets mid-market rate first, then back-calculates send amount for Wise comparisons API
app.post("/wise", async (req, res) => {
  const { targetCurrency = "USD", targetAmount = 1000 } = req.body;
  try {
    // Step 1: Get mid-market rate from Wise v3/quotes API
    let midMarketRate = null;
    try {
      const quoteResponse = await fetch("https://api.transferwise.com/v3/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCurrency: "INR",
          targetCurrency,
          targetAmount: String(targetAmount),
        }),
      });
      const quoteData = await quoteResponse.json();
      if (quoteData.rate) {
        midMarketRate = 1 / quoteData.rate; // Convert to INR per target currency
      }
    } catch (e) {
      console.error("Failed to get mid-market rate:", e.message);
    }

    if (!midMarketRate) {
      return res.status(400).json({ error: "Could not fetch mid-market rate" });
    }

    // Step 2: Back-calculate send amount: sendAmount = targetAmount / (1 / midMarketRate)
    // Add 0.08% buffer to match Wise's calculations
    const sendAmount = Math.round(targetAmount * midMarketRate * 1.0008);

    // Step 3: Query Wise comparisons API with calculated send amount
    const params = new URLSearchParams({
      sendAmount: String(sendAmount),
      sourceCurrency: 'INR',
      targetCurrency,
      filter: 'POPULAR',
      includeWise: 'true',
      numberOfProviders: '1',
      sourceCountry: 'IN',
      payInMethod: 'BANK_TRANSFER',
    });
    
    const response = await fetch(`https://wise.com/gateway/v4/comparisons?${params}`);
    const data = await response.json();
    
    // Add 18% GST to the fee only
    if (data.providers?.[0]?.quotes?.[0]) {
      const originalFee = data.providers[0].quotes[0].fee;
      const gst = originalFee * 0.18;
      data.providers[0].quotes[0].fee = originalFee + gst;
    }
    
    // Attach mid-market rate to response for client use
    data.midMarketRate = midMarketRate;
    data.calculatedSendAmount = sendAmount;
    
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WSFX ─────────────────────────────────────────────────────────────────────
// GET /wsfx?requiredCurrency=USD&requiredAmount=10000
// Forwards to api.wsfx.in/wsfx/rateCalculator
app.get("/wsfx", async (req, res) => {
  const { requiredCurrency = "USD", requiredAmount = 1000 } = req.query;
  const params = new URLSearchParams({
    product: "REMITTANCE",
    requiredCurrency,
    sellType: "SELL",
    requiredAmount: String(requiredAmount),
  });
  try {
    const response = await fetch(
      `https://api.wsfx.in/wsfx/rateCalculator?${params}`,
      {
        method: "GET",
        headers: {
          accept: "*/*",
          "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
          channel: "consumersappb2c",
          origin: "https://www.wsfx.in",
          referer: "https://www.wsfx.in/wsfx-student",
          "user-agent":
            "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
          "x-auth-token": "api-od926q416295z936kw76v1g9no952064",
        },
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── BOOKMYFOREX ──────────────────────────────────────────────────────────────
// POST /bookmyforex
// Body: { currencyCode, amount }
// Forwards to bookmyforex.com/api/secure/v1/get-products-rates
app.post("/bookmyforex", async (req, res) => {
  const { currencyCode = "USD" } = req.body;
  try {
    const response = await fetch(
      "https://www.bookmyforex.com/api/secure/v1/get-products-rates",
      {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
          "content-type": "application/json",
          origin: "https://www.bookmyforex.com",
          referer: "https://www.bookmyforex.com/forex/",
          "user-agent":
            "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
        },
        body: JSON.stringify([
          {
            index: "form",
            product_code: "TT",
            currency_code: currencyCode,
            order_type: "R",
            city: "BNG",
          },
        ]),
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: GET RATES (Only where Zolve is cheaper) ─────────────────────────────
// GET /api/rates?currency=USD&amount=10000
// Returns only comparisons where Zolve is cheaper than competitors
app.get("/api/rates", async (req, res) => {
  const { currency = "USD", amount = 10000 } = req.query;
  
  const ZOLVE_CFG = {
    USD: { markup: 0.0040, swift: 899 },
    GBP: { markup: 0.0030, swift: 1499 },
    EUR: { markup: 0.0030, swift: 1299 },
    AUD: { markup: 0.0040, swift: 1299 },
    CAD: { markup: 0.0040, swift: 1299 },
    DEFAULT: { markup: 0.0100, swift: 1499 },
  };

  const cfg = ZOLVE_CFG[currency] || ZOLVE_CFG.DEFAULT;
  const amt = parseFloat(amount);

  try {
    let midRate = null;
    let competitors = {};

    // Fetch Wise rate
    try {
      const r = await fetch("https://api.transferwise.com/v3/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCurrency: "INR",
          targetCurrency: currency,
          targetAmount: String(amt),
        }),
      });
      const data = await r.json();
      if (data.rate) midRate = 1 / data.rate;
      const best = data.paymentOptions?.find(p => p.payIn === "BANK_TRANSFER") || data.paymentOptions?.[0];
      if (best) {
        competitors.wise = { total: best.sourceAmount, fees: best.fee?.total ?? 0 };
      }
    } catch (e) {}

    // Fetch WSFX rate
    try {
      const params = new URLSearchParams({
        product: "REMITTANCE",
        requiredCurrency: currency,
        sellType: "SELL",
        requiredAmount: String(amt),
      });
      const r = await fetch(`https://api.wsfx.in/wsfx/rateCalculator?${params}`, {
        method: "GET",
        headers: {
          accept: "*/*",
          "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
          channel: "consumersappb2c",
          origin: "https://www.wsfx.in",
          referer: "https://www.wsfx.in/wsfx-student",
          "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
          "x-auth-token": "api-od926q416295z936kw76v1g9no952064",
        },
      });
      const data = await r.json();
      const total = data.remittanceRateResponse?.inrAmountWithCharges;
      if (total && midRate) {
        const inrBase = midRate * amt;
        competitors.wsfx = { total, fees: total - inrBase };
      }
    } catch (e) {}

    // Fetch BookMyForex rate
    try {
      const r = await fetch("https://www.bookmyforex.com/api/secure/v1/get-products-rates", {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
          "content-type": "application/json",
          origin: "https://www.bookmyforex.com",
          referer: "https://www.bookmyforex.com/forex/",
          "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
        },
        body: JSON.stringify([
          {
            index: "form",
            product_code: "TT",
            currency_code: currency,
            order_type: "R",
            city: "BNG",
          },
        ]),
      });
      const data = await r.json();
      const item = data.result?.[0];
      if (item && midRate) {
        const rate = parseFloat(item.rate);
        const total = +(rate * amt).toFixed(2);
        const inrBase = midRate * amt;
        competitors.bookmyforex = { total, fees: total - inrBase };
      }
    } catch (e) {}

    if (!midRate) {
      return res.status(400).json({ error: "Could not fetch mid-market rate" });
    }

    const inrBase = midRate * amt;
    const zRate = midRate * (1 + cfg.markup);
    const zConv = zRate * amt;
    const zFees = +(zConv - inrBase + cfg.swift).toFixed(2);
    const zTotal = +(inrBase + zFees).toFixed(2);

    // Filter: only return where Zolve is cheaper
    const filtered = [];
    filtered.push({ provider: "Zolve", fees: zFees, total: zTotal, isBest: true });

    Object.keys(competitors).forEach(provider => {
      if (competitors[provider].total > zTotal) {
        filtered.push({
          provider: provider.charAt(0).toUpperCase() + provider.slice(1),
          fees: competitors[provider].fees,
          total: competitors[provider].total,
          isBest: false,
        });
      }
    });

    res.json({
      currency,
      amount: amt,
      midRate,
      rates: filtered,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: GET ALL RATES (Everything for comparison) ────────────────────────────
// GET /api/comparison?currency=USD&amount=10000
// Returns all comparisons (not filtered)
app.get("/api/comparison", async (req, res) => {
  const { currency = "USD", amount = 10000 } = req.query;

  const ZOLVE_CFG = {
    USD: { markup: 0.0040, swift: 899 },
    GBP: { markup: 0.0030, swift: 1499 },
    EUR: { markup: 0.0030, swift: 1299 },
    AUD: { markup: 0.0040, swift: 1299 },
    CAD: { markup: 0.0040, swift: 1299 },
    DEFAULT: { markup: 0.0100, swift: 1499 },
  };

  const cfg = ZOLVE_CFG[currency] || ZOLVE_CFG.DEFAULT;
  const amt = parseFloat(amount);

  try {
    let midRate = null;
    const players = {};

    // Fetch Wise rate
    try {
      const r = await fetch("https://api.transferwise.com/v3/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCurrency: "INR",
          targetCurrency: currency,
          targetAmount: String(amt),
        }),
      });
      const data = await r.json();
      if (data.rate) midRate = 1 / data.rate;
      const best = data.paymentOptions?.find(p => p.payIn === "BANK_TRANSFER") || data.paymentOptions?.[0];
      if (best) {
        players.Wise = { total: best.sourceAmount, fees: best.fee?.total ?? 0 };
      }
    } catch (e) {}

    // Fetch WSFX rate
    try {
      const params = new URLSearchParams({
        product: "REMITTANCE",
        requiredCurrency: currency,
        sellType: "SELL",
        requiredAmount: String(amt),
      });
      const r = await fetch(`https://api.wsfx.in/wsfx/rateCalculator?${params}`, {
        method: "GET",
        headers: {
          accept: "*/*",
          "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
          channel: "consumersappb2c",
          origin: "https://www.wsfx.in",
          referer: "https://www.wsfx.in/wsfx-student",
          "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
          "x-auth-token": "api-od926q416295z936kw76v1g9no952064",
        },
      });
      const data = await r.json();
      const total = data.remittanceRateResponse?.inrAmountWithCharges;
      if (total && midRate) {
        const inrBase = midRate * amt;
        players.WSFX = { total, fees: total - inrBase };
      }
    } catch (e) {}

    // Fetch BookMyForex rate
    try {
      const r = await fetch("https://www.bookmyforex.com/api/secure/v1/get-products-rates", {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
          "content-type": "application/json",
          origin: "https://www.bookmyforex.com",
          referer: "https://www.bookmyforex.com/forex/",
          "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
        },
        body: JSON.stringify([
          {
            index: "form",
            product_code: "TT",
            currency_code: currency,
            order_type: "R",
            city: "BNG",
          },
        ]),
      });
      const data = await r.json();
      const item = data.result?.[0];
      if (item && midRate) {
        const rate = parseFloat(item.rate);
        const total = +(rate * amt).toFixed(2);
        const inrBase = midRate * amt;
        players.BookMyForex = { total, fees: total - inrBase };
      }
    } catch (e) {}

    if (!midRate) {
      return res.status(400).json({ error: "Could not fetch mid-market rate" });
    }

    const inrBase = midRate * amt;
    const zRate = midRate * (1 + cfg.markup);
    const zConv = zRate * amt;
    const zFees = +(zConv - inrBase + cfg.swift).toFixed(2);
    const zTotal = +(inrBase + zFees).toFixed(2);
    players.Zolve = { total: zTotal, fees: zFees };

    res.json({
      currency,
      amount: amt,
      midRate,
      rates: players,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "fx-proxy running", port: PORT });
});

app.listen(PORT, () => {
  console.log(`\n✅  FX Proxy running at http://localhost:${PORT}`);
  console.log(`   Wise        →  POST http://localhost:${PORT}/wise`);
  console.log(`   WSFX        →  GET  http://localhost:${PORT}/wsfx`);
  console.log(`   BookMyForex →  POST http://localhost:${PORT}/bookmyforex`);
  console.log(`   API         →  GET  http://localhost:${PORT}/api/rates (Zolve wins only)`);
  console.log(`   Comparison  →  GET  http://localhost:${PORT}/api/comparison (all rates)\n`);
});
