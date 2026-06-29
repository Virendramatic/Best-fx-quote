const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

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

    // Step 3: Query Wise v3/quotes API directly
    const r = await fetch('https://api.transferwise.com/v3/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceCurrency: 'INR',
        targetCurrency,
        targetAmount: String(targetAmount),
      }),
    });
    const data = await r.json();
    
    // Extract payment options and add GST to fees
    if (data.paymentOptions) {
      data.paymentOptions = data.paymentOptions.map(option => {
        if (option.fee?.total) {
          const gst = option.fee.total * 0.18;
          return {
            ...option,
            fee: {
              ...option.fee,
              total: option.fee.total + gst,
              breakdown: {
                ...option.fee.breakdown,
                total: option.fee.total + gst
              }
            }
          };
        }
        return option;
      });
    }
    
    data.midMarketRate = midMarketRate;
    data.calculatedSendAmount = sendAmount;
    
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WSFX ─────────────────────────────────────────────────────────────────────
// GET /wsfx?requiredCurrency=USD&requiredAmount=10000
// Forwards to apimerged.wsfx.in/b2cCalculator
app.get("/wsfx", async (req, res) => {
  const { requiredCurrency = "USD", requiredAmount = 1000 } = req.query;
  const params = new URLSearchParams({
    product: "REMITTANCE",
    sellType: "SELL",
    travelingCurrency: requiredCurrency,
    requiredCurrency,
    requiredAmount: String(requiredAmount),
    issuerCode: "HOTTISSUER",
  });
  try {
    const response = await fetch(
      `https://apimerged.wsfx.in/b2cCalculator?${params}`,
      {
        method: "GET",
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
    USD: { markup: 0.0035, swift: 899 },
    EUR: { markup: 0.0035, swift: 1399 },
    GBP: { markup: 0.0035, swift: 1499 },
    AUD: { markup: 0.0035, swift: 1399 },
    CAD: { markup: 0.0035, swift: 1399 },
    AED: { markup: 0.0100, swift: 1399 },
    SAR: { markup: 0.0200, swift: 1399 },
    DKK: { markup: 0.0150, swift: 1399 },
    NOK: { markup: 0.0150, swift: 1399 },
    SEK: { markup: 0.0150, swift: 1399 },
    NZD: { markup: 0.0100, swift: 1399 },
    SGD: { markup: 0.0070, swift: 1399 },
    HKD: { markup: 0.0150, swift: 1399 },
    ZAR: { markup: 0.0150, swift: 1399 },
    JPY: { markup: 0.1200, swift: 1399 },
    CHF: { markup: 0.0100, swift: 1399 },
    DEFAULT: { markup: 0.0100, swift: 1499 },
  };

  const cfg = ZOLVE_CFG[currency] || ZOLVE_CFG.DEFAULT;
  const amt = parseFloat(amount);

  try {
    let midRate = null;
    let competitors = {};

    // Fetch WSFX rate as primary mid-market source for Zolve calculations
    try {
      const params = new URLSearchParams({
        product: "REMITTANCE",
        sellType: "SELL",
        travelingCurrency: currency,
        requiredCurrency: currency,
        requiredAmount: String(amt),
        issuerCode: "HOTTISSUER",
      });
      const r = await fetch(`https://apimerged.wsfx.in/b2cCalculator?${params}`);
      const data = await r.json();
      if (data.requiredCurrencyRate) {
        midRate = data.requiredCurrencyRate;
      }
      const total = data.finalInrAmount;
      if (total) {
        const baseFees = total - midRate * amt;
        const gst = baseFees * 0.18;
        const totalFees = +(baseFees + gst).toFixed(2);
        competitors.wsfx = { total: +(total + gst).toFixed(2), fees: totalFees };
      }
    } catch (e) {}

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
      const best = data.paymentOptions?.find(p => p.payIn === "BANK_TRANSFER") || data.paymentOptions?.[0];
      if (best) {
        const baseFees = best.fee?.total ?? 0;
        const gst = baseFees * 0.18;
        const totalFees = +(baseFees + gst).toFixed(2);
        competitors.wise = { total: +(best.sourceAmount + gst).toFixed(2), fees: totalFees };
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
        const baseFees = item.fee ?? 0;
        const gst = baseFees * 0.18;
        const totalFees = +(baseFees + gst).toFixed(2);
        competitors.bookmyforex = { total: +(rate * amt + totalFees).toFixed(2), fees: totalFees };
      }
    } catch (e) {}

    if (!midRate) {
      return res.status(400).json({ error: "Could not fetch mid-market rate" });
    }

    const inrBase = midRate * amt;
    const zRate = midRate * (1 + cfg.markup);
    const zConv = zRate * amt;
    
    // Calculate tiered service value
    let serviceValue;
    if (zConv <= 100000) {
      serviceValue = Math.max(250, zConv * 0.01);
    } else if (zConv <= 1000000) {
      serviceValue = 1000 + (zConv - 100000) * 0.005;
    } else {
      serviceValue = 5500 + (zConv - 1000000) * 0.001;
    }
    serviceValue = Math.min(60000, serviceValue);
    
    const baseFees = +(serviceValue + cfg.swift).toFixed(2);
    const gstAmount = +(baseFees * 0.18).toFixed(2);
    const forexFees = +(zConv - inrBase).toFixed(2);
    const zFeeswithGST = +(forexFees + cfg.swift + gstAmount).toFixed(2);
    const zTotal = +(inrBase + zFeeswithGST).toFixed(2);

    // Filter: only return where Zolve is cheaper
    const filtered = [];
    filtered.push({ provider: "Zolve", fees: zFeeswithGST, total: zTotal, isBest: true });

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
    USD: { markup: 0.0035, swift: 899 },
    EUR: { markup: 0.0035, swift: 1399 },
    GBP: { markup: 0.0035, swift: 1499 },
    AUD: { markup: 0.0035, swift: 1399 },
    CAD: { markup: 0.0035, swift: 1399 },
    AED: { markup: 0.0100, swift: 1399 },
    SAR: { markup: 0.0200, swift: 1399 },
    DKK: { markup: 0.0150, swift: 1399 },
    NOK: { markup: 0.0150, swift: 1399 },
    SEK: { markup: 0.0150, swift: 1399 },
    NZD: { markup: 0.0100, swift: 1399 },
    SGD: { markup: 0.0070, swift: 1399 },
    HKD: { markup: 0.0150, swift: 1399 },
    ZAR: { markup: 0.0150, swift: 1399 },
    JPY: { markup: 0.1200, swift: 1399 },
    CHF: { markup: 0.0100, swift: 1399 },
    DEFAULT: { markup: 0.0100, swift: 1499 },
  };

  const cfg = ZOLVE_CFG[currency] || ZOLVE_CFG.DEFAULT;
  const amt = parseFloat(amount);

  try {
    let midRate = null;
    const players = {};

    // Fetch WSFX rate as primary mid-market source for Zolve calculations
    try {
      const params = new URLSearchParams({
        product: "REMITTANCE",
        sellType: "SELL",
        travelingCurrency: currency,
        requiredCurrency: currency,
        requiredAmount: String(amt),
        issuerCode: "HOTTISSUER",
      });
      const r = await fetch(`https://apimerged.wsfx.in/b2cCalculator?${params}`);
      const data = await r.json();
      if (data.requiredCurrencyRate) {
        midRate = data.requiredCurrencyRate;
      }
      const total = data.finalInrAmount;
      if (total) {
        const baseFees = total - midRate * amt;
        const gst = baseFees * 0.18;
        const totalFees = +(baseFees + gst).toFixed(2);
        players.WSFX = { total: +(total + gst).toFixed(2), fees: totalFees };
      }
    } catch (e) {}

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
      const best = data.paymentOptions?.find(p => p.payIn === "BANK_TRANSFER") || data.paymentOptions?.[0];
      if (best) {
        const baseFees = best.fee?.total ?? 0;
        const gst = baseFees * 0.18;
        const totalFees = +(baseFees + gst).toFixed(2);
        players.Wise = { total: +(best.sourceAmount + gst).toFixed(2), fees: totalFees };
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
        const baseFees = item.fee ?? 0;
        const gst = baseFees * 0.18;
        const totalFees = +(baseFees + gst).toFixed(2);
        players.BookMyForex = { total: +(rate * amt + totalFees).toFixed(2), fees: totalFees };
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
        const baseFees = item.fee ?? 0;
        const gst = baseFees * 0.18;
        const totalFees = +(baseFees + gst).toFixed(2);
        players.BookMyForex = { total: +(rate * amt + totalFees).toFixed(2), fees: totalFees };
      }
    } catch (e) {}

    if (!midRate) {
      return res.status(400).json({ error: "Could not fetch mid-market rate" });
    }

    const inrBase = midRate * amt;
    const zRate = midRate * (1 + cfg.markup);
    const zConv = zRate * amt;
    
    // Calculate tiered service value
    let serviceValue;
    if (zConv <= 100000) {
      serviceValue = Math.max(250, zConv * 0.01);
    } else if (zConv <= 1000000) {
      serviceValue = 1000 + (zConv - 100000) * 0.005;
    } else {
      serviceValue = 5500 + (zConv - 1000000) * 0.001;
    }
    serviceValue = Math.min(60000, serviceValue);
    
    const baseFees = +(serviceValue + cfg.swift).toFixed(2);
    const gst = +(baseFees * 0.18).toFixed(2);
    const forexFees = +(zConv - inrBase).toFixed(2);
    const zFeeswithGST = +(forexFees + cfg.swift + gst).toFixed(2);
    const zTotal = +(inrBase + zFeeswithGST).toFixed(2);
    players.Zolve = { total: zTotal, fees: zFeeswithGST };

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

// Serve static files (HTML, CSS, etc) - AFTER all API routes
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`\n✅  FX Proxy running at http://localhost:${PORT}`);
  console.log(`   Wise        →  POST http://localhost:${PORT}/wise`);
  console.log(`   WSFX        →  GET  http://localhost:${PORT}/wsfx`);
  console.log(`   BookMyForex →  POST http://localhost:${PORT}/bookmyforex`);
  console.log(`   API         →  GET  http://localhost:${PORT}/api/rates (Zolve wins only)`);
  console.log(`   Comparison  →  GET  http://localhost:${PORT}/api/comparison (all rates)\n`);
});
