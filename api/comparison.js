module.exports = async (req, res) => {
  const { currency = 'USD', amount = 10000 } = req.query;
  
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

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    let midRate = null;
    let competitors = {};

    // Fetch WSFX rate as primary mid-market source for Zolve calculations
    try {
      const params = new URLSearchParams({
        product: 'REMITTANCE',
        sellType: 'SELL',
        travelingCurrency: currency,
        requiredCurrency: currency,
        requiredAmount: String(amt),
        issuerCode: 'HOTTISSUER',
      });
      const r = await fetch(`https://apimerged.wsfx.in/b2cCalculator?${params}`, {
        method: 'GET',
      });
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

    // Fetch Wise rate using their v3/quotes API
    try {
      const r = await fetch('https://api.transferwise.com/v3/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceCurrency: 'INR',
          targetCurrency: currency,
          targetAmount: String(amt),
        }),
      });
      const data = await r.json();
      if (data.paymentOptions) {
        const best = data.paymentOptions.find(p => p.payIn === 'BANK_TRANSFER') || data.paymentOptions[0];
        if (best) {
          const baseFees = best.fee?.total ?? 0;
          const gst = baseFees * 0.18;
          const totalFees = +(baseFees + gst).toFixed(2);
          competitors.wise = { 
            total: +(best.sourceAmount + gst).toFixed(2),
            fees: totalFees
          };
        }
      }
    } catch (e) {}

    // Fetch BookMyForex rate
    try {
      const r = await fetch('https://www.bookmyforex.com/api/secure/v1/get-products-rates', {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'content-type': 'application/json',
          origin: 'https://www.bookmyforex.com',
          referer: 'https://www.bookmyforex.com/forex/',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        },
        body: JSON.stringify([
          {
            index: 'form',
            product_code: 'TT',
            currency_code: currency,
            order_type: 'R',
            city: 'BNG',
          },
        ]),
      });
      const data = await r.json();
      const item = data.result?.[0];
      if (item && midRate) {
        const rate = parseFloat(item.rate);
        const inrBase = midRate * amt;
        const baseFees = item.fee ?? 0;
        const gst = baseFees * 0.18;
        const totalFees = +(baseFees + gst).toFixed(2);
        competitors.bookmyforex = { 
          total: +(rate * amt + totalFees).toFixed(2),
          fees: totalFees 
        };
      }
    } catch (e) {}

    if (!midRate) {
      return res.status(400).json({ error: 'Could not fetch mid-market rate' });
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

    // Return ALL providers (not filtered)
    const allRates = [];
    allRates.push({ provider: 'Zolve', fees: zFeeswithGST, total: zTotal });

    Object.keys(competitors).forEach(provider => {
      allRates.push({
        provider: provider.charAt(0).toUpperCase() + provider.slice(1),
        fees: competitors[provider].fees,
        total: competitors[provider].total,
      });
    });

    res.json({
      currency,
      amount: amt,
      midRate,
      rates: allRates,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
