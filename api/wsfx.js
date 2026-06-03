const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const { requiredCurrency = 'USD', requiredAmount = 1000 } = req.query;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const params = new URLSearchParams({
    product: 'REMITTANCE',
    requiredCurrency,
    sellType: 'SELL',
    requiredAmount: String(requiredAmount),
  });

  try {
    const response = await fetch(`https://api.wsfx.in/wsfx/rateCalculator?${params}`, {
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
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
