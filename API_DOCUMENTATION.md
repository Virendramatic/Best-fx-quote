# FX Rate Comparison API Documentation

This API provides real-time foreign exchange rates comparison between Zolve and competitors (Wise, WSFX, BookMyForex) for remittance corridors.

## Base URLs

**Local Development:**
```
http://localhost:3001
```

**Production (Vercel):**
```
https://your-vercel-domain.vercel.app/api
```

Replace `your-vercel-domain` with your actual Vercel project name.

---

## Endpoints

### 1. GET `/api/rates`

Returns only comparisons where **Zolve is competitive** (cheaper than competitors).

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `currency` | string | `USD` | Target currency (USD, GBP, EUR, AUD, CAD) |
| `amount` | number | `10000` | Amount to transfer in destination currency |

**Response Schema:**
```json
{
  "currency": "USD",
  "amount": 1000,
  "midRate": 83.45,
  "rates": [
    {
      "provider": "Zolve",
      "fees": 899,
      "total": 83450,
      "isBest": true
    },
    {
      "provider": "Wise",
      "fees": 1200,
      "total": 84200,
      "isBest": false
    }
  ],
  "timestamp": "2026-06-03T10:30:00.000Z"
}
```

**Example Request:**
```bash
curl "http://localhost:3001/api/rates?currency=USD&amount=1000"
```

---

### 2. GET `/api/comparison`

Returns **all provider rates** (unfiltered comparison).

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `currency` | string | `USD` | Target currency (USD, GBP, EUR, AUD, CAD) |
| `amount` | number | `10000` | Amount to transfer in destination currency |

**Response Schema:**
```json
{
  "currency": "USD",
  "amount": 1000,
  "midRate": 83.45,
  "rates": [
    {
      "provider": "Zolve",
      "fees": 899,
      "total": 83450
    },
    {
      "provider": "Wise",
      "fees": 1200,
      "total": 84200
    },
    {
      "provider": "WSFX",
      "fees": 950,
      "total": 83650
    },
    {
      "provider": "BookMyForex",
      "fees": 1100,
      "total": 84050
    }
  ],
  "timestamp": "2026-06-03T10:30:00.000Z"
}
```

**Example Request:**
```bash
curl "http://localhost:3001/api/comparison?currency=GBP&amount=5000"
```

---

## Zolve Pricing Configuration

Zolve pricing varies by destination currency. The system applies a markup on mid-market rate + SWIFT fees:

| Currency | Markup | SWIFT Fee (INR) |
|----------|--------|-----------------|
| USD | 0.35% | ₹899 |
| EUR | 0.35% | ₹1,399 |
| GBP | 0.35% | ₹1,499 |
| AUD | 0.35% | ₹1,399 |
| CAD | 0.35% | ₹1,399 |
| AED | 1.00% | ₹1,399 |
| SAR | 2.00% | ₹1,399 |
| DKK | 1.50% | ₹1,399 |
| NOK | 1.50% | ₹1,399 |
| SEK | 1.50% | ₹1,399 |
| NZD | 1.00% | ₹1,399 |
| SGD | 0.70% | ₹1,399 |
| HKD | 1.50% | ₹1,399 |
| ZAR | 1.50% | ₹1,399 |
| JPY | 12.00% | ₹1,399 |
| CHF | 1.00% | ₹1,399 |
| Other | 1.00% | ₹1,499 |

**Calculation Formula:**
```
Zolve Rate = Mid-Market Rate × (1 + Markup %)
Total Cost = (Zolve Rate × Amount) + SWIFT Fee
```

---

## Integration Examples

### JavaScript / Node.js

```javascript
// Using /api/rates (show only when Zolve wins)
async function getCompetitiveRates(currency, amount) {
  const response = await fetch(
    `/api/rates?currency=${currency}&amount=${amount}`
  );
  const data = await response.json();
  
  console.log(`Zolve: ₹${data.rates[0].total}`);
  data.rates.slice(1).forEach(rate => {
    console.log(`${rate.provider}: ₹${rate.total}`);
  });
}

getCompetitiveRates('USD', 1000);
```

### Python

```python
import requests
import json

# Using /api/comparison (show all providers)
def get_all_rates(currency='USD', amount=10000):
    url = f'http://localhost:3001/api/comparison'
    params = {'currency': currency, 'amount': amount}
    
    response = requests.get(url, params=params)
    data = response.json()
    
    for rate in data['rates']:
        print(f"{rate['provider']}: ₹{rate['total']} (Fees: ₹{rate['fees']})")

get_all_rates('USD', 1000)
```

### cURL

```bash
# Get rates where Zolve is cheaper
curl "http://localhost:3001/api/rates?currency=USD&amount=1000"

# Get all provider comparisons
curl "http://localhost:3001/api/comparison?currency=GBP&amount=5000"
```

---

## Use Cases for In-House Comparison

### 1. **Customer Dashboard Integration**
Display live rates on your dashboard when users select a destination country and amount.

```javascript
const response = await fetch(`/api/rates?currency=USD&amount=5000`);
const competitiveRates = await response.json();
// Show only when Zolve offers better rates
displayRates(competitiveRates.rates);
```

### 2. **Internal Rate Monitoring**
Track how Zolve pricing compares to competitors throughout the day.

```javascript
setInterval(async () => {
  const rates = await fetch('/api/comparison?currency=USD&amount=10000').then(r => r.json());
  logRatesToDatabase(rates);
}, 60000); // Check every minute
```

### 3. **Dynamic CTA Logic**
Show "Transfer Now" only when Zolve is winning:

```javascript
const rates = await fetch('/api/rates?currency=USD&amount=1000').then(r => r.json());
if (rates.rates.length > 1) {
  // Zolve won over at least one competitor
  showTransferButton();
}
```

---

## Error Handling

### Error Response Format

```json
{
  "error": "Could not fetch mid-market rate"
}
```

### Common Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| `Could not fetch mid-market rate` | Mid-market rate provider (Wise) failed | Retry request or check internet connection |
| `400 Bad Request` | Invalid currency or amount | Use valid currency codes (USD, GBP, EUR, AUD, CAD) and numeric amount |
| `500 Internal Server Error` | Server error | Check server logs or retry after a few seconds |

### Rate Limit Considerations

- No rate limiting enforced on this API
- Competitor APIs (Wise, WSFX, BookMyForex) may have rate limits
- Recommend caching results for 1-5 minutes to reduce load

---

## Rate Calculation Example

**Scenario:** Transfer $1000 USD from India

**Given:**
- Mid-market rate (Wise): 1 USD = ₹83.45
- Destination: USD
- Amount: 1000

**Zolve Calculation:**
```
Zolve markup: 0.40%
Zolve rate = 83.45 × (1 + 0.004) = 83.78
Total you receive: 1000 × 83.78 = ₹83,780
SWIFT fee: ₹899
Total cost: ₹83,780 + ₹899 = ₹84,679
```

**Wise Calculation (from live API):**
```
Total cost: ₹84,900
```

**Result:** Zolve saves ₹221 (0.26% cheaper)

---

## Important Notes

- **Mid-market rates** are provided by Wise API and update in real-time
- **Fees** shown are indicative and may vary based on payment method
- **Exchange rates** fluctuate constantly; rates are accurate at time of API call
- **Competitor APIs** occasionally fail; the system gracefully handles missing data
- **CORS enabled** for browser-based requests (Access-Control-Allow-Origin: *)

---

## Support & Questions

For technical issues or questions about integration:
- Check the `/api/rates` vs `/api/comparison` difference based on your use case
- Ensure valid currency codes are being passed
- Monitor response times; competitor APIs can be slow (up to 5 seconds)
- Contact the development team for production URL updates
