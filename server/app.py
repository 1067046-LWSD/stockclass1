"""
StockClass API — Yahoo Finance backend (yfinance).

Module layout
─────────────
1. Data types   – Quote, CompanyInfo, Candle dataclasses.
2. PriceCache   – Thread-safe TTL cache with separate TTLs per data category.
3. YFinanceService – Single static abstraction layer; the only place that
                     imports yfinance.  Nothing else in this file should call
                     yfinance directly.
4. PriceStream  – Daemon thread; continuously refreshes subscribed tickers
                  by delegating to YFinanceService.get_quotes_batch().
5. Flask app    – Thin HTTP wrappers that serialise service output to JSON.

Design principles
─────────────────
• All yfinance calls are isolated inside YFinanceService — easy to swap
  provider in the future.
• fast_info is preferred over .info for price data (1–2× faster).
• .info is only used for company metadata; it is cached for 5 minutes.
• 1-minute intraday candles are served for the "1D" range.
• Concurrent thread-per-ticker polling in PriceStream keeps refresh latency
  low even for large watchlists.
• Every public method returns None / raises a named exception — never crashes
  the server.
"""

from __future__ import annotations

import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import resend
import yfinance as yf
from flask import Flask, jsonify, request
from flask_cors import CORS

# Resend is configured via environment variable RESEND_API_KEY.
# RESEND_FROM must also be set to a verified sender address/domain.
resend.api_key = os.environ.get("RESEND_API_KEY", "")


# ══════════════════════════════════════════════════════════════════════════════
# 1. DATA TYPES
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Quote:
    """Real-time (or most-recent) market snapshot for one ticker."""

    price:      float
    change:     float           # absolute $ change vs previous close
    change_pct: float           # % change vs previous close
    volume:     int   = 0       # 3-month average daily volume (fast_info)
    market_cap: Optional[int] = None

    def to_dict(self) -> dict[str, Any]:
        """Serialise to the JSON shape the frontend expects."""
        d: dict[str, Any] = {
            "price":     self.price,
            "change":    self.change,
            "changePct": self.change_pct,   # camelCase — matches existing frontend
            "volume":    self.volume,
        }
        if self.market_cap is not None:
            d["marketCap"] = self.market_cap
        return d


@dataclass
class CompanyInfo:
    """Static company metadata fetched from ticker.info."""

    ticker:      str
    name:        str
    sector:      str = ""
    industry:    str = ""
    description: str = ""
    employees:   int = 0
    website:     str = ""
    exchange:    str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker":      self.ticker,
            "name":        self.name,
            "sector":      self.sector,
            "industry":    self.industry,
            "description": self.description,
            "employees":   self.employees,
            "website":     self.website,
            "exchange":    self.exchange,
        }


@dataclass
class Candle:
    """One OHLCV bar."""

    t: int    # epoch milliseconds (UTC)
    o: float  # open
    h: float  # high
    l: float  # low
    c: float  # close  ← frontend calls this "p" (price)
    v: int    # volume

    def to_dict(self) -> dict[str, Any]:
        # "p" keeps backward-compat with the existing frontend chart components.
        return {"t": self.t, "o": self.o, "h": self.h, "l": self.l,
                "p": self.c, "v": self.v}


# ══════════════════════════════════════════════════════════════════════════════
# 2. PRICE CACHE
# ══════════════════════════════════════════════════════════════════════════════

class PriceCache:
    """
    Thread-safe in-memory TTL cache.

    Different data categories expire at different rates:
      • Quote data   → 2 s   (near-real-time feel)
      • Company info → 300 s (static; no need to refetch often)
      • History      → 60 s  (candle arrays; expensive to re-fetch)
    """

    QUOTE_TTL:   float = 2.0
    INFO_TTL:    float = 300.0
    HISTORY_TTL: float = 60.0

    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}
        self._lock  = threading.Lock()

    # ── key helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def quote_key(symbol: str)              -> str: return f"q:{symbol}"
    @staticmethod
    def info_key(symbol: str)               -> str: return f"i:{symbol}"
    @staticmethod
    def history_key(symbol: str, rng: str)  -> str: return f"h:{symbol}:{rng}"

    # ── get / set ─────────────────────────────────────────────────────────────

    def get(self, key: str) -> Any | None:
        """Return cached value if still fresh, else None."""
        with self._lock:
            entry = self._store.get(key)
            if entry and (time.monotonic() - entry["ts"]) < entry["ttl"]:
                return entry["data"]
        return None

    def set(self, key: str, data: Any, ttl: float = QUOTE_TTL) -> None:
        with self._lock:
            self._store[key] = {"data": data, "ts": time.monotonic(), "ttl": ttl}


# ══════════════════════════════════════════════════════════════════════════════
# 3. YFINANCE SERVICE
# ══════════════════════════════════════════════════════════════════════════════

class YFinanceService:
    """
    Static abstraction layer for all Yahoo Finance data access.

    ▸ This is the ONLY place that calls yfinance.
    ▸ All methods return typed dataclasses or None on failure.
    ▸ No caching logic lives here — that belongs in PriceCache / the endpoints.
    """

    # Range code → (yfinance period, yfinance interval)
    # "1D" uses 1-minute bars to fulfil the intraday requirement.
    RANGE_MAP: dict[str, tuple[str, str]] = {
        "1D": ("1d",  "1m"),
        "1W": ("5d",  "1h"),
        "1M": ("1mo", "1d"),
        "3M": ("3mo", "1d"),
        "6M": ("6mo", "1d"),
        "1Y": ("1y",  "1d"),
    }

    # ── Single-ticker quote ───────────────────────────────────────────────────

    @staticmethod
    def get_quote(symbol: str) -> Optional[Quote]:
        """
        Fetch the current price for one ticker.

        Strategy:
          1. fast_info.last_price  — fastest path, updated ~1 min during
             market hours; returns None pre-market / for unknown tickers.
          2. 5-day daily history   — fallback for after-hours / weekends.

        Returns None (instead of raising) so callers can skip bad tickers
        gracefully in batch operations.
        """
        try:
            ticker = yf.Ticker(symbol)
            fi     = ticker.fast_info

            price = fi.last_price

            if price:
                prev = fi.previous_close or price
            else:
                # Fallback: last two daily closes
                hist = ticker.history(period="5d", interval="1d", auto_adjust=True)
                if hist.empty:
                    return None
                price = float(hist["Close"].iloc[-1])
                prev  = float(hist["Close"].iloc[-2]) if len(hist) > 1 else price

            change     = round(price - prev, 2)
            change_pct = round((change / prev) * 100, 2) if prev else 0.0

            # Volume (3-month avg) — present on fast_info but may be None
            volume = int(getattr(fi, "three_month_average_volume", 0) or 0)

            # Market cap
            raw_cap    = getattr(fi, "market_cap", None)
            market_cap = int(raw_cap) if raw_cap else None

            return Quote(
                price=round(price, 2),
                change=change,
                change_pct=change_pct,
                volume=volume,
                market_cap=market_cap,
            )

        except Exception:
            return None

    # ── Batch quotes (concurrent) ─────────────────────────────────────────────

    @staticmethod
    def get_quotes_batch(symbols: list[str]) -> dict[str, Quote]:
        """
        Fetch quotes for multiple tickers concurrently (one thread per symbol).

        Thread-per-ticker keeps total latency bounded by the slowest single
        request rather than the sum of all requests.  For typical classroom
        watchlists (≤ 30 tickers) this is perfectly safe.

        Returns a dict of {symbol: Quote} for every ticker that succeeded;
        failed tickers are silently omitted.
        """
        results: dict[str, Quote] = {}
        lock = threading.Lock()

        def fetch_one(sym: str) -> None:
            q = YFinanceService.get_quote(sym)
            if q is not None:
                with lock:
                    results[sym] = q

        threads = [
            threading.Thread(target=fetch_one, args=(sym,), daemon=True)
            for sym in symbols
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=8)   # 8-second cap per batch

        return results

    # ── History / candles ─────────────────────────────────────────────────────

    @staticmethod
    def get_history(symbol: str, range_: str) -> list[Candle]:
        """
        Fetch OHLCV candles for one ticker.

        Args:
            symbol: Ticker (e.g. "AAPL").
            range_: One of "1D" (1-min bars), "1W" (1-h bars),
                    "1M" (daily), "3M" (daily).

        Returns:
            List of Candle objects sorted chronologically.

        Raises:
            ValueError: Unknown range code.
            RuntimeError: No data returned by Yahoo.
        """
        if range_ not in YFinanceService.RANGE_MAP:
            raise ValueError(f"Unknown range '{range_}'. Use one of: "
                             f"{', '.join(YFinanceService.RANGE_MAP)}")

        period, interval = YFinanceService.RANGE_MAP[range_]

        hist = yf.Ticker(symbol).history(
            period=period, interval=interval, auto_adjust=True
        )

        if hist.empty:
            raise RuntimeError(f"No history found for {symbol}")

        # Drop rows where any OHLC value is NaN — yfinance can return NaN
        # for pre/post-market gaps; Python serialises NaN as literal `NaN`
        # which is not valid JSON and crashes the browser parser.
        hist = hist.dropna(subset=["Open", "High", "Low", "Close"])

        if hist.empty:
            raise RuntimeError(f"No valid price data found for {symbol}")

        return [
            Candle(
                t=int(row.Index.timestamp() * 1000),
                o=round(float(row.Open),  2),
                h=round(float(row.High),  2),
                l=round(float(row.Low),   2),
                c=round(float(row.Close), 2),
                v=int(row.Volume),
            )
            for row in hist.itertuples()
        ]

    # ── Company info ──────────────────────────────────────────────────────────

    @staticmethod
    def get_company_info(symbol: str) -> Optional[CompanyInfo]:
        """
        Fetch static company metadata.

        Uses ticker.info which makes a full HTTP round-trip (~0.5–1 s).
        Always go through the cache before calling this method.

        Returns None for unknown tickers or on network failure.
        """
        try:
            info = yf.Ticker(symbol).info

            # Yahoo returns a minimal dict for non-existent tickers;
            # the "symbol" field being absent or mismatched is the tell.
            if not info or info.get("symbol", "").upper() != symbol.upper():
                return None

            return CompanyInfo(
                ticker=symbol.upper(),
                name=info.get("longName") or info.get("shortName") or symbol,
                sector=info.get("sector", ""),
                industry=info.get("industry", ""),
                description=info.get("longBusinessSummary", ""),
                employees=int(info.get("fullTimeEmployees") or 0),
                website=info.get("website", ""),
                exchange=info.get("exchange", ""),
            )
        except Exception:
            return None

    # ── Search ────────────────────────────────────────────────────────────────

    @staticmethod
    def search_companies(query: str, max_results: int = 5) -> list[dict[str, str]]:
        """
        Search for equities/ETFs matching a company name or ticker fragment.

        Returns:
            List of {"ticker", "name", "exchange"} dicts (up to max_results).
            Returns [] on any failure.
        """
        try:
            hits = yf.Search(query, max_results=max_results * 2, news_count=0)
            results: list[dict[str, str]] = []
            for item in hits.quotes:
                sym   = item.get("symbol", "")
                name  = item.get("longname") or item.get("shortname") or sym
                qtype = item.get("quoteType", "")
                exch  = item.get("exchange", "")
                if qtype not in ("EQUITY", "ETF") or not sym:
                    continue
                results.append({"ticker": sym, "name": name, "exchange": exch})
                if len(results) >= max_results:
                    break
            return results
        except Exception:
            return []

    # ── Ticker validation (used by /search endpoint) ──────────────────────────

    @staticmethod
    def validate_and_quote(symbol: str) -> tuple[str, str, Quote]:
        """
        Validate a ticker and return its canonical symbol, company name, and
        current quote in a single call.

        Raises:
            ValueError: Ticker not found, no price data, or below $2 minimum.
        """
        sym = symbol.strip().upper()

        # .info is the reliable validation path; fast_info gives no company name.
        ticker = yf.Ticker(sym)
        info   = ticker.info

        if not info or info.get("symbol", "").upper() != sym:
            raise ValueError(f"No results found for '{sym}'")

        name = info.get("longName") or info.get("shortName") or sym

        # Fetch quote via fast_info (reuses the same Ticker object).
        fi    = ticker.fast_info
        price = fi.last_price

        if not price:
            # Fallback to last daily close
            hist = ticker.history(period="5d", interval="1d", auto_adjust=True)
            if hist.empty:
                raise ValueError(f"No price data available for '{sym}'")
            price = float(hist["Close"].iloc[-1])
            prev  = float(hist["Close"].iloc[-2]) if len(hist) > 1 else price
        else:
            prev = fi.previous_close or price

        if price < 2:
            raise ValueError(
                f"{sym} is below the $2 minimum (penny stocks not allowed)"
            )

        change     = round(price - prev, 2)
        change_pct = round((change / prev) * 100, 2) if prev else 0.0
        volume     = int(getattr(fi, "three_month_average_volume", 0) or 0)
        raw_cap    = getattr(fi, "market_cap", None)

        quote = Quote(
            price=round(price, 2),
            change=change,
            change_pct=change_pct,
            volume=volume,
            market_cap=int(raw_cap) if raw_cap else None,
        )
        return sym, name, quote


# ══════════════════════════════════════════════════════════════════════════════
# 4. PRICE STREAM
# ══════════════════════════════════════════════════════════════════════════════

class PriceStream:
    """
    Daemon thread that proactively refreshes prices for all subscribed tickers.

    On each cycle it identifies which cache entries have expired, fetches those
    symbols concurrently via YFinanceService.get_quotes_batch(), and repopulates
    the cache.  Tickers with a fresh cache entry are skipped to avoid redundant
    network calls.
    """

    def __init__(self, cache: PriceCache, interval: float = 2.0) -> None:
        """
        Args:
            cache:    Shared PriceCache instance.
            interval: Seconds to sleep between poll cycles.
        """
        self._cache    = cache
        self._interval = interval
        self._subscribed: set[str] = set()
        self._lock     = threading.Lock()
        self._thread   = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def subscribe(self, tickers: list[str]) -> None:
        """Add tickers to the watchlist (idempotent)."""
        with self._lock:
            self._subscribed.update(t.upper() for t in tickers)

    def _run(self) -> None:
        """Main loop — runs forever in the daemon thread."""
        while True:
            # Only refetch symbols whose cache entry has expired.
            with self._lock:
                stale = [
                    s for s in self._subscribed
                    if self._cache.get(self._cache.quote_key(s)) is None
                ]

            if stale:
                fresh = YFinanceService.get_quotes_batch(stale)
                for sym, quote in fresh.items():
                    self._cache.set(
                        self._cache.quote_key(sym),
                        quote,
                        ttl=self._cache.QUOTE_TTL,
                    )

            time.sleep(self._interval)


# ══════════════════════════════════════════════════════════════════════════════
# 5. APP SETUP
# ══════════════════════════════════════════════════════════════════════════════

app    = Flask(__name__)
CORS(app)
cache  = PriceCache()
stream = PriceStream(cache, interval=2.0)


# ══════════════════════════════════════════════════════════════════════════════
# 6. ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/search_companies")
def search_companies():
    """
    GET /search_companies?q=<query>

    Typeahead search by ticker symbol or company name.

    Response: [ { ticker, name, exchange }, … ]   (up to 5 results)
    Errors:   []  (never 4xx — callers treat empty as "no match")
    """
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify([])
    return jsonify(YFinanceService.search_companies(query))


@app.route("/search/<symbol>")
def search(symbol: str):
    """
    GET /search/<symbol>

    Validate a ticker and return a full quote + company name.

    Response: { ticker, name, price, change, changePct, volume, marketCap? }
    Errors:   { error } with 404 (not found) or 400 (below $2 minimum)
    """
    sym = symbol.strip().upper()

    # Check cache first (search is triggered by user action, not the stream)
    cached_quote = cache.get(cache.quote_key(sym))
    cached_info  = cache.get(cache.info_key(sym))

    if cached_quote and cached_info:
        return jsonify({
            "ticker": sym,
            "name":   cached_info.name,
            **cached_quote.to_dict(),
        })

    try:
        sym, name, quote = YFinanceService.validate_and_quote(sym)
    except ValueError as exc:
        status = 400 if "minimum" in str(exc) else 404
        return jsonify({"error": str(exc)}), status
    except Exception:
        return jsonify({"error": "Failed to fetch data — please try again"}), 502

    # Warm caches and subscribe to background refresh.
    cache.set(cache.quote_key(sym), quote, ttl=cache.QUOTE_TTL)
    stream.subscribe([sym])

    return jsonify({"ticker": sym, "name": name, **quote.to_dict()})


@app.route("/quote/<symbol>")
def quote(symbol: str):
    """
    GET /quote/<symbol>

    Fast single-ticker price check.  Uses cache when fresh.

    Response: { price, change, changePct, volume, marketCap? }
    Errors:   { error } with 404
    """
    sym = symbol.strip().upper()

    data = cache.get(cache.quote_key(sym))
    if data is None:
        data = YFinanceService.get_quote(sym)
        if data is None:
            return jsonify({"error": f"No data available for {sym}"}), 404
        cache.set(cache.quote_key(sym), data, ttl=cache.QUOTE_TTL)

    stream.subscribe([sym])
    return jsonify(data.to_dict())


@app.route("/history/<symbol>")
def history(symbol: str):
    """
    GET /history/<symbol>?range=1D|1W|1M|3M

    OHLCV candle history.

    • 1D → 1-minute bars  (intraday)
    • 1W → 1-hour bars
    • 1M → daily bars
    • 3M → daily bars (default)

    Response: [ { t, o, h, l, p, v }, … ]   ("p" = close price)
    Errors:   { error } with 400 (bad range) or 404 (no data)
    """
    sym   = symbol.strip().upper()
    rng   = request.args.get("range", "3M").upper()
    key   = cache.history_key(sym, rng)

    cached = cache.get(key)
    if cached is not None:
        return jsonify(cached)

    try:
        candles = YFinanceService.get_history(sym, rng)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception:
        return jsonify({"error": f"Failed to fetch history for {sym}"}), 502

    serialised = [c.to_dict() for c in candles]
    cache.set(key, serialised, ttl=cache.HISTORY_TTL)
    return jsonify(serialised)


@app.route("/company/<symbol>")
def company(symbol: str):
    """
    GET /company/<symbol>

    Full company metadata (name, sector, industry, description, …).
    Cached for 5 minutes.

    Response: { ticker, name, sector, industry, description,
                employees, website, exchange }
    Errors:   { error } with 404
    """
    sym = symbol.strip().upper()
    key = cache.info_key(sym)

    cached = cache.get(key)
    if cached is not None:
        return jsonify(cached.to_dict())

    info = YFinanceService.get_company_info(sym)
    if info is None:
        return jsonify({"error": f"Company not found: {sym}"}), 404

    cache.set(key, info, ttl=cache.INFO_TTL)
    return jsonify(info.to_dict())


@app.route("/refresh")
def refresh():
    """
    GET /refresh?tickers=AAPL,MSFT,GOOGL

    Batch price poll for the frontend's periodic refresh cycle.
    Cache-first: only tickers with stale entries are re-fetched from Yahoo.

    Response: { TICKER: { price, change, changePct, volume, marketCap? }, … }
    """
    raw     = request.args.get("tickers", "")
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]
    if not symbols:
        return jsonify({})

    stream.subscribe(symbols)

    results:  dict[str, Any] = {}
    need_fetch: list[str]    = []

    for sym in symbols:
        cached = cache.get(cache.quote_key(sym))
        if cached is not None:
            results[sym] = cached.to_dict()
        else:
            need_fetch.append(sym)

    if need_fetch:
        fresh = YFinanceService.get_quotes_batch(need_fetch)
        for sym, q in fresh.items():
            cache.set(cache.quote_key(sym), q, ttl=cache.QUOTE_TTL)
            results[sym] = q.to_dict()

    return jsonify(results)


# ══════════════════════════════════════════════════════════════════════════════
# 7. AUTH — EMAIL VERIFICATION
# ══════════════════════════════════════════════════════════════════════════════

# email → { "code": str, "expires": float }
_pending_codes: dict[str, dict] = {}
_codes_lock = threading.Lock()
CODE_TTL = 600  # 10 minutes

RESEND_FROM = os.environ.get("RESEND_FROM", "StockRoom <onboarding@resend.dev>")


def _purge_expired() -> None:
    """Remove stale entries (called on every write to keep the dict tidy)."""
    now = time.time()
    expired = [e for e, v in _pending_codes.items() if v["expires"] < now]
    for e in expired:
        del _pending_codes[e]


@app.route("/auth/send-code", methods=["POST"])
def send_code():
    """
    POST /auth/send-code
    Body: { "email": "..." }

    Generates a 6-digit verification code, stores it for 10 minutes,
    and sends it to the given address via Resend.

    Response: { "ok": true }
    Errors:   { "error": "..." } with 400 or 502
    """
    body  = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()

    if not email or "@" not in email:
        return jsonify({"error": "A valid email address is required"}), 400

    if not resend.api_key:
        return jsonify({"error": "Email service not configured on the server"}), 502

    code = f"{secrets.randbelow(1_000_000):06d}"

    with _codes_lock:
        _purge_expired()
        _pending_codes[email] = {"code": code, "expires": time.time() + CODE_TTL}

    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1a1a2e; margin-bottom: 8px;">Verify your StockRoom account</h2>
      <p style="color: #555; margin-bottom: 24px;">
        Enter the code below to complete your sign-up. It expires in 10 minutes.
      </p>
      <div style="
        font-family: monospace; font-size: 36px; font-weight: 700;
        letter-spacing: 0.25em; color: #1a1a2e;
        background: #f4f4f8; border-radius: 12px;
        padding: 20px 32px; text-align: center;
        margin-bottom: 24px;
      ">{code}</div>
      <p style="color: #999; font-size: 13px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
    """

    try:
        resend.Emails.send({
            "from":    RESEND_FROM,
            "to":      [email],
            "subject": f"Your StockRoom verification code: {code}",
            "html":    html_body,
        })
    except Exception as exc:
        return jsonify({"error": f"Failed to send email: {exc}"}), 502

    return jsonify({"ok": True})


@app.route("/auth/verify-code", methods=["POST"])
def verify_code():
    """
    POST /auth/verify-code
    Body: { "email": "...", "code": "..." }

    Checks the code against the pending store.  On success the entry is
    deleted (single-use).

    Response: { "ok": true }
    Errors:   { "error": "..." } with 400
    """
    body  = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    code  = str(body.get("code") or "").strip()

    if not email or not code:
        return jsonify({"error": "Email and code are required"}), 400

    with _codes_lock:
        entry = _pending_codes.get(email)

        if not entry:
            return jsonify({"error": "No verification code found for this email. Please request a new one."}), 400

        if time.time() > entry["expires"]:
            del _pending_codes[email]
            return jsonify({"error": "Code has expired. Please request a new one."}), 400

        if not secrets.compare_digest(entry["code"], code):
            return jsonify({"error": "Incorrect code. Please try again."}), 400

        # Valid — consume the code
        del _pending_codes[email]

    return jsonify({"ok": True})


# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"StockClass API  →  http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
