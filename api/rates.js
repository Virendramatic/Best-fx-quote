module.exports = async (req, res) => {
  const { currency = 'USD', amount = 10000 } = req.query;
  
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

    // Fetch Wise rate
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
      if (data.rate) midRate = 1 / data.rate;
      const best = data.paymentOptions?.find(p => p.payIn === 'BANK_TRANSFER') || data.paymentOptions?.[0];
      if (best) {
        competitors.wise = { total: best.sourceAmount, fees: best.fee?.total ?? 0 };
      }
    } catch (e) {}

    // Fetch WSFX rate
    try {
      const params = new URLSearchParams({
        product: 'REMITTANCE',
        requiredCurrency: currency,
        sellType: 'SELL',
        requiredAmount: String(amt),
      });
      const r = await fetch(`https://api.wsfx.in/wsfx/rateCalculator?${params}`, {
        method: 'GET',
        headers: {
          accept: '*/*',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          channel: 'consumersappb2c',
          origin: 'https://www.wsfx.in',
          referer: 'https://www.wsfx.in/wsfx-student',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          'x-auth-token': 'api-od926q416295z936kw76v1g9no952064',
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
        const total = +(rate * amt).toFixed(2);
        const inrBase = midRate * amt;
        competitors.bookmyforex = { total, fees: total - inrBase };
      }
    } catch (e) {}

    if (!midRate) {
      return res.status(400).json({ error: 'Could not fetch mid-market rate' });
    }

    const inrBase = midRate * amt;
    const zRate = midRate * (1 + cfg.markup);
    const zConv = zRate * amt;
    const zFees = +(zConv - inrBase + cfg.swift).toFixed(2);
    const zTotal = +(inrBase + zFees).toFixed(2);

    const filtered = [];
    filtered.push({ provider: 'Zolve', fees: zFees, total: zTotal, isBest: true });

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
};
