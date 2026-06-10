const BASE = process.env.REACT_APP_API_URL || "http://localhost:5001";

async function apiFetch(url, options) {
  const res = await fetch(url, options);
  // Python/Flask can serialise NaN as literal `NaN` which is not valid JSON.
  // Read as text first and sanitise before parsing.
  const text = await res.text();
  const safe = text.replace(/:\s*NaN/g, ":null");
  const data = JSON.parse(safe);
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// Exact ticker lookup — returns { ticker, name, price, change, changePct }
export async function searchTicker(query) {
  const q = query.trim().toUpperCase();
  if (!q) throw new Error("Enter a ticker symbol");
  return apiFetch(`${BASE}/search/${encodeURIComponent(q)}`);
}

// Single ticker quote — returns { price, change, changePct }
export async function getQuote(ticker) {
  return apiFetch(`${BASE}/quote/${encodeURIComponent(ticker)}`);
}

// Daily close history — returns [{ t, p }, ...]
export async function getHistory(ticker, range) {
  return apiFetch(`${BASE}/history/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}`);
}

// Company/name search — returns [{ ticker, name, exchange }, ...]
export async function searchCompanies(query) {
  if (!query.trim()) return [];
  const res = await fetch(`${BASE}/search_companies?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (!res.ok) return [];
  return Array.isArray(data) ? data : [];
}

// Batch refresh — returns { TICKER: { price, change, changePct }, ... }
export async function refreshPrices(tickers) {
  if (!tickers.length) return {};
  return apiFetch(`${BASE}/refresh?tickers=${tickers.map(encodeURIComponent).join(",")}`);
}

// Send a 6-digit verification code to the given email address.
export async function sendVerificationCode(email) {
  return apiFetch(`${BASE}/auth/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

// Verify the 6-digit code sent to email.
export async function verifyCode(email, code) {
  return apiFetch(`${BASE}/auth/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
}
