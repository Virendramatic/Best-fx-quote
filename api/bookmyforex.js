module.exports = async (req, res) => {
  const { currencyCode = 'USD' } = req.body;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const response = await fetch('https://www.bookmyforex.com/api/secure/v1/get-products-rates', {
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
          currency_code: currencyCode,
          order_type: 'R',
          city: 'BNG',
        },
      ]),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
