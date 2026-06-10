import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { searchTicker as searchTickerApi, getQuote, getHistory, refreshPrices, searchCompanies as searchCompaniesApi, sendVerificationCode as sendVerificationCodeApi, verifyCode as verifyCodeApi } from "./api";

// ─── CONSTANTS & HELPERS ──────────────────────────────────────────────────────
const fmt$ = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const fmtPct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const fmtChg = (n) => (n >= 0 ? "+" : "") + fmt$(n);
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// Popular stocks shown in the trade tab — names are bundled so we don't need
// an extra reference API call just to label the quick-select pills.
const POPULAR_STOCKS = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  GOOGL: "Alphabet Inc.",
  AMZN: "Amazon.com Inc.",
  TSLA: "Tesla Inc.",
  NVDA: "NVIDIA Corp.",
  META: "Meta Platforms Inc.",
  JPM: "JPMorgan Chase",
  WMT: "Walmart Inc.",
  DIS: "Walt Disney Co.",
  NFLX: "Netflix Inc.",
  V: "Visa Inc.",
};

// ─── INJECT GLOBAL STYLES (runs at module load) ───────────────────────────────
/* eslint-disable no-unused-expressions */
(() => {
  if (typeof document === "undefined") return;
  const id = "sc-premium-styles";
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700;800&family=IBM+Plex+Mono:wght@300;400;500;600&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0d0d0f; --surf: #111115; --card: #16161b; --card2: #1c1c23;
      --border: rgba(255,255,255,0.055); --borderB: rgba(255,255,255,0.12);
      --text: #eeeef2; --text2: rgba(238,238,242,0.52); --text3: rgba(238,238,242,0.28);
      --gain: #00c076; --loss: #ff3b5c;
      --gainBg: rgba(0,192,118,0.1); --lossBg: rgba(255,59,92,0.1);
      --blue: #5b78ff; --gold: #f0b429; --silver: #8a9bb5; --bronze: #c97540;
      --mono: 'IBM Plex Mono','SF Mono',monospace;
      --sans: 'DM Sans',system-ui,sans-serif;
      --display: 'Syne','DM Sans',sans-serif;
    }
    html,body,#root { height: 100%; }
    body {
      background: var(--bg); color: var(--text);
      font-family: var(--sans); font-size: 14px; line-height: 1.55;
      -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
    }
    input,select,textarea {
      background: rgba(255,255,255,0.04); border: 1px solid var(--border);
      border-radius: 8px; color: var(--text); font-family: var(--sans);
      font-size: 14px; padding: 10px 14px; outline: none;
      transition: border 0.15s,background 0.15s; width: 100%;
    }
    input:focus,select:focus,textarea:focus {
      border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.06);
    }
    input::placeholder,textarea::placeholder { color: var(--text3); }
    select option { background: #1c1c23; color: var(--text); }
    ::-webkit-scrollbar { width: 3px; height: 3px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
    @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    @keyframes scaleIn { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:scale(1)} }
    @keyframes notif { from{opacity:0;transform:translateY(-10px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .sc-anim { animation: fadeUp 0.32s ease both; }
    .sc-card-anim { animation: scaleIn 0.25s ease both; }
    .sc-nav-item {
      display:flex; align-items:center; gap:10px; padding:9px 14px;
      border-radius:8px; cursor:pointer; font-size:14px; font-weight:400;
      color:var(--text2); transition:background 0.15s,color 0.15s;
      border:none; background:transparent; width:100%; text-align:left;
      font-family:var(--sans);
    }
    .sc-nav-item:hover { background:rgba(255,255,255,0.04); color:var(--text); }
    .sc-nav-item.active { background:rgba(255,255,255,0.07); color:var(--text); font-weight:500; }
    .sc-stock-row {
      display:grid; align-items:center; padding:14px 20px;
      border-bottom:1px solid var(--border); transition:background 0.12s; cursor:default;
    }
    .sc-stock-row:last-child { border-bottom:none; }
    .sc-stock-row:hover { background:rgba(255,255,255,0.02); }
    .sc-ticker-pill {
      display:inline-flex; align-items:center; gap:6px;
      padding:5px 12px; background:rgba(255,255,255,0.04);
      border:1px solid var(--border); border-radius:20px;
      font-size:12px; cursor:pointer; transition:all 0.12s;
      font-family:var(--sans); color:var(--text2);
    }
    .sc-ticker-pill:hover { background:rgba(255,255,255,0.08); border-color:var(--borderB); color:var(--text); }
  `;
  document.head.appendChild(el);
})();

// ─── LOCALSTORAGE HELPERS ─────────────────────────────────────────────────────
const loadFromLS = (key, fallback) => {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
};
const saveToLS = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

const DEFAULT_USERS = [
  { id: "t1", name: "Ms. Johnson", email: "teacher@school.edu", password: "pass", role: "teacher" },
  { id: "s1", name: "Alex Kim", email: "alex@school.edu", password: "pass", role: "student" },
];

// ─── MINI SPARKLINE ───────────────────────────────────────────────────────────
function MiniChart({ data, positive }) {
  if (!data || data.length < 2) return null;
  const w = 72, h = 28;
  const prices = data.map(d => d.p);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const coords = data.map((d, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - 3 - ((d.p - min) / range) * (h - 6),
  }));
  const linePts = coords.map(c => `${c.x},${c.y}`).join(" ");
  const areaPts = `0,${h} ${linePts} ${w},${h}`;
  const color = positive ? "#00c076" : "#ff3b5c";
  const gid = `mg${positive ? "g" : "r"}${Math.random().toString(36).slice(2, 7)}`;
  return (
    <svg width={w} height={h} style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${gid})`} />
      <polyline points={linePts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── YAHOO FINANCE–STYLE PRICE CHART ─────────────────────────────────────────
function PriceChart({ data, purchasePrice, range }) {
  const [zoomDomain, setZoomDomain]   = useState(null); // { left, right } indices
  const [selStart,   setSelStart]     = useState(null);
  const [selEnd,     setSelEnd]       = useState(null);
  const [selecting,  setSelecting]    = useState(false);

  // Reset zoom when range or data changes
  useEffect(() => { setZoomDomain(null); setSelStart(null); setSelEnd(null); }, [range, data]);

  if (!data || data.length < 2) return null;

  // Apply zoom slice
  const visibleData = zoomDomain
    ? data.slice(zoomDomain.left, zoomDomain.right + 1)
    : data;

  const isIntraday = range === "1D" || range === "1W";
  const firstPrice = visibleData[0].p;
  const lastPrice  = visibleData[visibleData.length - 1].p;
  const positive   = lastPrice >= firstPrice;
  const color      = positive ? "#00c076" : "#ff3b5c";
  const gradId     = `pcg_${range}`; // unique per range to avoid SVG id collisions

  const chartData = visibleData.map((d, i) => ({
    i,
    t: d.t,
    label: isIntraday
      ? new Date(d.t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      : new Date(d.t).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    price: d.p,
  }));

  const prices = visibleData.map(d => d.p);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const pad  = (maxP - minP) * 0.15 || 1;

  // X-axis: show ~6 evenly-spaced ticks regardless of data density
  const tickEvery = Math.max(1, Math.floor(chartData.length / 6));
  const xTicks = chartData.filter((_, i) => i % tickEvery === 0).map(d => d.label);

  // Tooltip with crosshair — shows price + change from open + time
  const TooltipEl = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p   = payload[0].value;
    const chg = p - firstPrice;
    const pct = ((chg / firstPrice) * 100).toFixed(2);
    return (
      <div style={{
        background: "#16161e", border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8, padding: "9px 13px", pointerEvents: "none",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 700, color: "#eeeef2" }}>
          {fmt$(p)}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, marginTop: 2,
          color: chg >= 0 ? "#00c076" : "#ff3b5c" }}>
          {chg >= 0 ? "+" : ""}{fmt$(chg)} ({chg >= 0 ? "+" : ""}{pct}%)
        </div>
        <div style={{ fontSize: 10, color: "rgba(238,238,242,0.38)", marginTop: 4 }}>
          {payload[0].payload.label}
        </div>
      </div>
    );
  };

  // Zoom handlers — click-drag to select a region
  const handleMouseDown = (e) => {
    if (!e?.activeLabel) return;
    const idx = chartData.findIndex(d => d.label === e.activeLabel);
    if (idx < 0) return;
    setSelStart(idx);
    setSelEnd(idx);
    setSelecting(true);
  };
  const handleMouseMove = (e) => {
    if (!selecting || !e?.activeLabel) return;
    const idx = chartData.findIndex(d => d.label === e.activeLabel);
    if (idx >= 0) setSelEnd(idx);
  };
  const handleMouseUp = () => {
    if (!selecting) return;
    setSelecting(false);
    if (selStart !== null && selEnd !== null && Math.abs(selEnd - selStart) > 2) {
      const left  = zoomDomain ? zoomDomain.left  + Math.min(selStart, selEnd) : Math.min(selStart, selEnd);
      const right = zoomDomain ? zoomDomain.left  + Math.max(selStart, selEnd) : Math.max(selStart, selEnd);
      setZoomDomain({ left, right });
    }
    setSelStart(null);
    setSelEnd(null);
  };
  const resetZoom = () => { setZoomDomain(null); setSelStart(null); setSelEnd(null); };

  return (
    <div style={{ position: "relative", userSelect: "none" }}>
      {/* Zoom reset button */}
      {zoomDomain && (
        <button onClick={resetZoom} style={{
          position: "absolute", top: 4, right: 6, zIndex: 5,
          padding: "3px 10px", fontSize: 11, borderRadius: 6,
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.13)",
          color: "rgba(238,238,242,0.6)", cursor: "pointer", fontFamily: "DM Sans, sans-serif",
        }}>Reset zoom</button>
      )}

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 14, right: 4, left: 2, bottom: 0 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <XAxis dataKey="label" ticks={xTicks}
            tick={{ fontSize: 11, fill: "rgba(238,238,242,0.3)", fontFamily: "DM Sans" }}
            axisLine={false} tickLine={false} />

          <YAxis domain={[minP - pad, maxP + pad]} orientation="right"
            tick={{ fontSize: 10, fill: "rgba(238,238,242,0.3)", fontFamily: "'IBM Plex Mono',monospace" }}
            axisLine={false} tickLine={false} tickCount={6} width={62}
            tickFormatter={v => "$" + v.toFixed(v >= 100 ? 0 : 2)} />

          <Tooltip
            content={<TooltipEl />}
            cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1, strokeDasharray: "4 2" }}
            isAnimationActive={false}
          />

          {/* Purchase price reference line */}
          {purchasePrice && (
            <ReferenceLine y={purchasePrice} stroke="rgba(255,255,255,0.25)" strokeDasharray="5 3"
              label={{ value: "avg cost", position: "insideBottomLeft",
                fill: "rgba(238,238,242,0.4)", fontSize: 10 }} />
          )}

          {/* Drag-to-zoom selection highlight */}
          {selecting && selStart !== null && selEnd !== null && (
            <ReferenceLine x={chartData[Math.min(selStart, selEnd)]?.label}
              stroke="rgba(255,255,255,0.15)" />
          )}

          <Area type="linear" dataKey="price" stroke={color} strokeWidth={1.8}
            fill={`url(#${gradId})`} dot={false}
            activeDot={{ r: 4, fill: color, stroke: "#0d0d0f", strokeWidth: 2 }}
            isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>

      {/* Zoom hint */}
      {!zoomDomain && (
        <div style={{ textAlign: "center", fontSize: 10, color: "rgba(238,238,242,0.18)",
          marginTop: 4, fontFamily: "DM Sans, sans-serif" }}>
          Click and drag on the chart to zoom in
        </div>
      )}
    </div>
  );
}

// ─── PORTFOLIO GROWTH CHART ────────────────────────────────────────────────────
function PortfolioChart({ snapshots, startingBalance }) {
  const snaps = (snapshots && snapshots.length >= 2)
    ? snapshots
    : [{ t: Date.now() - 86400000 * 7, value: startingBalance }, { t: Date.now(), value: startingBalance }];
  const chartData = snaps.map(s => ({
    label: new Date(s.t).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value: s.value,
  }));
  const positive = snaps[snaps.length - 1].value >= startingBalance;
  const color = positive ? "#00c076" : "#ff3b5c";
  const vals = snaps.map(s => s.value);
  const minV = Math.min(...vals, startingBalance), maxV = Math.max(...vals, startingBalance);
  const pad = (maxV - minV) * 0.18 || 40;

  const TooltipEl = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const val = payload[0].value;
    const g = val - startingBalance;
    return (
      <div style={{ background: "#1c1c23", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 13px" }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 600, color: "#eeeef2" }}>{fmt$(val)}</div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: g >= 0 ? "#00c076" : "#ff3b5c", marginTop: 2 }}>{fmtChg(g)}</div>
        <div style={{ fontSize: 11, color: "rgba(238,238,242,0.4)", marginTop: 1 }}>{payload[0].payload.label}</div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={170}>
      <AreaChart data={chartData} margin={{ top: 5, right: 4, left: -28, bottom: 0 }}>
        <defs>
          <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "rgba(238,238,242,0.28)" }}
          axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis domain={[minV - pad, maxV + pad]} hide />
        <Tooltip content={<TooltipEl />} cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2}
          fill="url(#portGrad)" dot={false}
          activeDot={{ r: 4, fill: color, stroke: "#0d0d0f", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── ANIMATED NUMBER ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, formatter = fmt$ }) {
  const [display, setDisplay] = useState(value);
  const animRef = useRef(null);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (Math.abs(from - to) < 0.001) return;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const duration = 550;
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) { animRef.current = requestAnimationFrame(step); }
      else { setDisplay(to); fromRef.current = to; }
    };
    animRef.current = requestAnimationFrame(step);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [value]);

  return <>{formatter(display)}</>;
}

// ─── ALLOCATION RING ──────────────────────────────────────────────────────────
function AllocationRing({ holdings, cash, stockPrices }) {
  const COLORS = ["#5b78ff", "#00c076", "#f0b429", "#ff3b5c", "#a78bfa", "#38bdf8", "#fb923c", "#34d399"];
  const entries = Object.entries(holdings);
  let total = cash;
  entries.forEach(([t, h]) => { total += (stockPrices[t]?.price || 0) * h.shares; });
  if (total <= 0) return null;

  const segs = [
    { label: "Cash", value: cash, color: "rgba(255,255,255,0.18)" },
    ...entries.map(([t, h], i) => ({
      label: t,
      value: (stockPrices[t]?.price || 0) * h.shares,
      color: COLORS[i % COLORS.length],
    })),
  ].filter(s => s.value > 0).map(s => ({ ...s, pct: s.value / total }));

  const cx = 70, cy = 70, r = 52, sw = 16;
  const C = 2 * Math.PI * r;
  let cumPct = 0;
  const investedPct = 1 - (cash / total);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <svg width={140} height={140}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
          {segs.map((seg, i) => {
            const rot = cumPct * 360 - 90;
            const dashLen = Math.max(0, seg.pct * C - 2);
            const el = (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={seg.color} strokeWidth={sw}
                strokeDasharray={`${dashLen} ${C}`}
                transform={`rotate(${rot} ${cx} ${cy})`}
              />
            );
            cumPct += seg.pct;
            return el;
          })}
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{ fontSize: 10, color: "rgba(238,238,242,0.35)", letterSpacing: "0.07em", marginBottom: 2 }}>INVESTED</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 600 }}>
            {(investedPct * 100).toFixed(0)}%
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {segs.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", color: "rgba(238,238,242,0.65)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{seg.label}</span>
            <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: "rgba(238,238,242,0.4)", flexShrink: 0 }}>
              {(seg.pct * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── VIEWS ────────────────────────────────────────────────────────────────────
const VIEWS = { AUTH: "auth", TEACHER_DASH: "teacher_dash", STUDENT_DASH: "student_dash", STOCK_DETAIL: "stock_detail" };

// ─── NOTIFICATION ─────────────────────────────────────────────────────────────
function Notification({ n }) {
  if (!n) return null;
  const isErr = n.type === "error";
  return (
    <div style={{
      position: "fixed", top: 20, right: 20, zIndex: 9999,
      background: isErr ? "rgba(255,59,92,0.12)" : "rgba(0,192,118,0.12)",
      border: `1px solid ${isErr ? "rgba(255,59,92,0.3)" : "rgba(0,192,118,0.3)"}`,
      color: isErr ? "#ff3b5c" : "#00c076",
      borderRadius: 10, padding: "11px 18px",
      fontSize: 13, fontWeight: 500,
      backdropFilter: "blur(16px)",
      animation: "notif 0.25s ease both",
      maxWidth: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    }}>
      {n.msg}
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
const NAV_ICONS = {
  portfolio: "◈", trade: "⇄", history: "≡",
  overview: "◈", groups: "⊞", leaderboard: "▲", settings: "◎",
};

// ─── LOGO MARK ────────────────────────────────────────────────────────────────
const LogoMark = ({ size = 30, gradId = "lmg" }) => (
  <svg width={size} height={size} viewBox="0 0 30 30" fill="none" style={{ flexShrink: 0, display: "block" }}>
    <defs>
      <linearGradient id={gradId} x1="0" y1="0" x2="30" y2="30" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#00d080" />
        <stop offset="100%" stopColor="#008a50" />
      </linearGradient>
    </defs>
    <rect width="30" height="30" rx="8" fill={`url(#${gradId})`} />
    <polyline
      points="5,22 10,17 15,19.5 20,12 26,7"
      fill="none" stroke="#052e18" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" opacity="0.9"
    />
    {/* Arrowhead at peak pointing up-right */}
    <polyline
      points="20,7 26,7 26,13"
      fill="none" stroke="#052e18" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" opacity="0.9"
    />
  </svg>
);

function Sidebar({ items, active, setActive, user, subtitle, marketOpen, onLogout, cash, portfolioValue }) {
  return (
    <div style={{
      width: 220, minWidth: 220,
      background: "#0d0d0f",
      borderRight: "1px solid rgba(255,255,255,0.055)",
      display: "flex", flexDirection: "column",
      height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 10,
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <LogoMark size={30} gradId="lgSidebar" />
          <span style={{
            fontFamily: "Syne, sans-serif", fontSize: 14, fontWeight: 700,
            letterSpacing: "0.06em", color: "#eeeef2",
          }}>STOCKROOM</span>
        </div>
      </div>

      {/* Market status */}
      <div style={{ padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            background: marketOpen ? "#00c076" : "#ff3b5c",
            boxShadow: marketOpen ? "0 0 8px rgba(0,192,118,0.7)" : "0 0 6px rgba(255,59,92,0.5)",
            animation: marketOpen ? "blink 3s ease-in-out infinite" : "none",
          }} />
          <span style={{ color: "rgba(238,238,242,0.38)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: "0.08em" }}>
            {marketOpen ? "MARKET OPEN" : "MARKET CLOSED"}
          </span>
        </div>
      </div>

      {/* Money widget — student only */}
      {portfolioValue !== undefined && (
        <div style={{
          padding: "14px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(0,192,118,0.03)",
        }}>
          <div style={{ fontSize: 9, color: "rgba(238,238,242,0.3)", letterSpacing: "0.1em", marginBottom: 3 }}>PORTFOLIO VALUE</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 600, color: "#eeeef2", marginBottom: 10 }}>
            {fmt$(portfolioValue)}
          </div>
          <div style={{ fontSize: 9, color: "rgba(238,238,242,0.3)", letterSpacing: "0.1em", marginBottom: 3 }}>CASH AVAILABLE</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 500, color: "#00c076" }}>
            {fmt$(cash ?? 0)}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: "10px 10px", overflowY: "auto" }}>
        {items.map(item => (
          <button key={item.id}
            className={`sc-nav-item${active === item.id ? " active" : ""}`}
            onClick={() => setActive(item.id)}>
            <span style={{ fontSize: 14, opacity: 0.65, width: 18, textAlign: "center", flexShrink: 0 }}>
              {NAV_ICONS[item.id] || "•"}
            </span>
            <span>{item.label}</span>
            {active === item.id && (
              <span style={{
                marginLeft: "auto", width: 5, height: 5, borderRadius: "50%",
                background: "#00c076", flexShrink: 0,
              }} />
            )}
          </button>
        ))}
      </nav>

      {/* User info */}
      <div style={{ padding: "14px 14px 18px", borderTop: "1px solid rgba(255,255,255,0.055)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "linear-gradient(135deg, #5b78ff, #3a57cc)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0,
          }}>
            {user?.name?.[0]?.toUpperCase() || "?"}
          </div>
          <div style={{ overflow: "hidden", flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#eeeef2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user?.name}
            </div>
            {subtitle && (
              <div style={{ fontSize: 11, color: "rgba(238,238,242,0.38)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <button onClick={onLogout} style={{
          width: "100%", padding: "7px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 7, fontSize: 12,
          color: "rgba(238,238,242,0.4)", cursor: "pointer",
          transition: "all 0.15s", fontFamily: "DM Sans, sans-serif",
        }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#eeeef2"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(238,238,242,0.4)"; }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

// ─── LAYOUT ───────────────────────────────────────────────────────────────────
function Layout({ sidebar, children }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0d0d0f" }}>
      {sidebar}
      <main style={{ flex: 1, marginLeft: 220, overflowY: "auto", minHeight: "100vh" }}>
        {children}
      </main>
    </div>
  );
}

// ─── CARD ─────────────────────────────────────────────────────────────────────
const Card = ({ children, style = {}, className = "" }) => (
  <div className={className} style={{
    background: "#16161b",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 14,
    ...style,
  }}>{children}</div>
);

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState(VIEWS.AUTH);
  const [userType, setUserType] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [classes, setClasses] = useState(() => loadFromLS('sc_classes', []));
  const [currentClass, setCurrentClass] = useState(null);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);
  const [stockPrices, setStockPrices] = useState({});
  const [stockHistory, setStockHistory] = useState({}); // { [ticker]: [{ t, p }] }
  const [notification, setNotification] = useState(null);
  const [authTab, setAuthTab] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "", role: "student", classCode: "" });
  const [users, setUsers] = useState(() => loadFromLS('sc_users', DEFAULT_USERS));
  const [sessionConflict, setSessionConflict] = useState(null);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  };

  // Persist users and classes to localStorage
  useEffect(() => { saveToLS('sc_users', users); }, [users]);
  useEffect(() => { saveToLS('sc_classes', classes); }, [classes]);

  // Restore session on mount
  useEffect(() => {
    try {
      const session = loadFromLS('sc_session', null);
      if (!session) return;
      const storedUsers = loadFromLS('sc_users', DEFAULT_USERS);
      const user = storedUsers.find(u => u.id === session.id);
      if (!user) { localStorage.removeItem('sc_session'); return; }
      const storedClasses = loadFromLS('sc_classes', []);
      setCurrentUser(user);
      setUserType(user.role);
      if (user.role === "teacher") {
        const myClass = storedClasses.find(c => c.teacherId === user.id);
        setCurrentClass(myClass || null);
        setView(VIEWS.TEACHER_DASH);
      } else {
        const myClass = storedClasses.find(c => c.students?.includes(user.id));
        if (myClass) {
          setCurrentClass(myClass);
          const myGroup = myClass.groups?.find(g => g.members?.includes(user.id));
          setCurrentGroup(myGroup || null);
        }
        setView(VIEWS.STUDENT_DASH);
      }
    } catch { localStorage.removeItem('sc_session'); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll held tickers every 5 seconds for near-real-time prices
  useEffect(() => {
    const getHeldTickers = () => {
      const held = new Set();
      (classes || []).forEach(cls =>
        (cls.groups || []).forEach(g =>
          Object.keys(g.holdings || {}).forEach(t => held.add(t))
        )
      );
      return [...held];
    };
    const doRefresh = () => {
      const tickers = getHeldTickers();
      if (!tickers.length) return;
      refreshPrices(tickers).then(quotes => {
        setStockPrices(prev => {
          const next = { ...prev };
          Object.entries(quotes).forEach(([t, q]) => {
            next[t] = { ...next[t], ...q };
          });
          return next;
        });
      }).catch(() => {});
    };
    const id = setInterval(doRefresh, 1000);
    return () => clearInterval(id);
  }, [classes]);

  // Record one portfolio snapshot per calendar day so the chart has daily granularity.
  // Runs whenever stockPrices updates; the date-deduplication check exits immediately
  // if today's snapshot already exists, so the actual write only fires once per day.
  useEffect(() => {
    if (!currentGroup || !currentClass) return;
    const today = new Date().toDateString();
    const snaps = currentGroup.snapshots || [];
    const last  = snaps[snaps.length - 1];
    if (last && new Date(last.t).toDateString() === today) return; // already recorded today

    const value = parseFloat(
      (currentGroup.cash + Object.entries(currentGroup.holdings || {})
        .reduce((sum, [t, h]) => sum + (stockPrices[t]?.price || 0) * h.shares, 0)
      ).toFixed(2)
    );
    const newSnap = { t: Date.now(), value };

    setCurrentClass(prev => {
      if (!prev) return prev;
      const groups = prev.groups.map(g => {
        if (g.id !== currentGroup.id) return g;
        const l = g.snapshots[g.snapshots.length - 1];
        if (l && new Date(l.t).toDateString() === today) return g; // guard against stale closure
        return { ...g, snapshots: [...g.snapshots, newSnap] };
      });
      setClasses(cls => cls.map(c => c.id === prev.id ? { ...prev, groups } : c));
      const updated = groups.find(g => g.id === currentGroup.id);
      if (updated) setCurrentGroup(updated);
      return { ...prev, groups };
    });
  }, [stockPrices]); // eslint-disable-line react-hooks/exhaustive-deps

  const addStockPrice = (ticker, data) => {
    setStockPrices(prev => ({ ...prev, [ticker]: data }));
  };

  const cacheHistory = (ticker, range, history) => {
    setStockHistory(prev => ({
      ...prev,
      [ticker]: { ...(prev[ticker] || {}), [range]: history },
    }));
  };

  const handleLogin = (forceOverride = false) => {
    const user = users.find(u => u.email.toLowerCase() === authForm.email.trim().toLowerCase() && u.password === authForm.password);
    if (!user) { notify("Invalid email or password", "error"); return; }

    // Single-session enforcement
    const activeTs = localStorage.getItem('sc_active_' + user.email);
    if (activeTs && !forceOverride) {
      setSessionConflict(user);
      return;
    }

    localStorage.setItem('sc_active_' + user.email, Date.now().toString());
    saveToLS('sc_session', { id: user.id });
    setSessionConflict(null);
    setCurrentUser(user);
    setUserType(user.role);
    if (user.role === "teacher") {
      const myClass = classes.find(c => c.teacherId === user.id);
      setCurrentClass(myClass || null);
      setView(VIEWS.TEACHER_DASH);
    } else {
      const myClass = classes.find(c => c.students?.includes(user.id));
      if (myClass) {
        setCurrentClass(myClass);
        const myGroup = myClass.groups?.find(g => g.members?.includes(user.id));
        setCurrentGroup(myGroup || null);
      }
      setView(VIEWS.STUDENT_DASH);
    }
  };

  const handleSignup = () => {
    if (!authForm.name || !authForm.email || !authForm.password) { notify("Fill all fields", "error"); return; }
    if (authForm.role === "student" && !authForm.classCode) { notify("Enter a class code", "error"); return; }
    const emailNorm = authForm.email.trim().toLowerCase();
    if (users.find(u => u.email.toLowerCase() === emailNorm)) { notify("Email already registered", "error"); return; }
    const newUser = { id: "u" + Date.now(), name: authForm.name, email: emailNorm, password: authForm.password, role: authForm.role };
    setUsers(prev => [...prev, newUser]);
    if (authForm.role === "student") {
      const cls = classes.find(c => c.code === authForm.classCode.toUpperCase());
      if (!cls) { notify("Class code not found", "error"); return; }
      setClasses(prev => prev.map(c => c.id === cls.id ? { ...c, students: [...(c.students || []), newUser.id], pendingStudents: [...(c.pendingStudents || []), newUser.id] } : c));
      setCurrentClass({ ...cls, students: [...(cls.students || []), newUser.id] });
    }
    localStorage.setItem('sc_active_' + newUser.email, Date.now().toString());
    saveToLS('sc_session', { id: newUser.id });
    setCurrentUser(newUser);
    setUserType(authForm.role);
    setView(authForm.role === "teacher" ? VIEWS.TEACHER_DASH : VIEWS.STUDENT_DASH);
    notify("Account created!");
  };

  const createClass = (name, startingBalance) => {
    const newClass = {
      id: "c" + Date.now(), name, code: generateCode(), teacherId: currentUser.id,
      startingBalance: parseFloat(startingBalance) || 1000, students: [], pendingStudents: [], groups: [], createdAt: Date.now()
    };
    setClasses(prev => [...prev, newClass]);
    setCurrentClass(newClass);
    notify("Class created! Share the code with students.");
  };

  const createGroups = (classId, groupSize, manual, names) => {
    const cls = classes.find(c => c.id === classId);
    if (!cls) return;
    let groups;
    if (manual) {
      groups = names.map((name, i) => ({
        id: "g" + Date.now() + i, name, members: [], cash: cls.startingBalance,
        holdings: {}, transactions: [], snapshots: [{ t: Date.now(), value: cls.startingBalance }], citations: {}, analyses: {}
      }));
    } else {
      const shuffled = [...(cls.students || [])].sort(() => Math.random() - 0.5);
      const numGroups = Math.ceil(shuffled.length / groupSize);
      groups = Array.from({ length: numGroups }, (_, i) => ({
        id: "g" + Date.now() + i, name: `Group ${i + 1}`,
        members: shuffled.slice(i * groupSize, (i + 1) * groupSize),
        cash: cls.startingBalance, holdings: {}, transactions: [],
        snapshots: [{ t: Date.now(), value: cls.startingBalance }], citations: {}, analyses: {}
      }));
    }
    setClasses(prev => prev.map(c => c.id === classId ? { ...c, groups } : c));
    setCurrentClass(prev => ({ ...prev, groups }));
    notify("Groups created!");
  };

  const executeTrade = (groupId, ticker, shares, type, citations = [], analysisReport = "") => {
    const price = stockPrices[ticker]?.price;
    if (!price) { notify("Stock not found", "error"); return; }
    if (price < 2) { notify("Stock price too low (min $2)", "error"); return; }
    if (currentClass?.projectEnded) { notify("This project has ended — trading is closed", "error"); return; }
    if (currentClass?.tradingFrozen) { notify("Trading is frozen by your teacher", "error"); return; }
    setCurrentClass(prev => {
      const groups = prev.groups.map(g => {
        if (g.id !== groupId) return g;
        let { cash, holdings, transactions, snapshots, citations: cits, analyses: analys } = g;
        holdings = { ...holdings };
        const isFirstBuy = type === "buy" && (!holdings[ticker] || holdings[ticker].shares === 0);
        if (type === "buy") {
          const total = price * shares;
          if (total > cash) { notify("Insufficient funds", "error"); return g; }
          cash -= total;
          const existing = holdings[ticker] || { shares: 0, avgCost: 0, purchaseDate: Date.now() };
          const totalShares = existing.shares + shares;
          const avgCost = ((existing.avgCost * existing.shares) + (price * shares)) / totalShares;
          holdings[ticker] = { shares: totalShares, avgCost: parseFloat(avgCost.toFixed(4)), purchaseDate: existing.purchaseDate || Date.now() };
          const newCits = { ...cits };
          if (citations.length > 0) newCits[ticker] = [...(newCits[ticker] || []), ...citations];
          cits = newCits;
          const newAnalys = { ...(analys || {}) };
          if (isFirstBuy && analysisReport) newAnalys[ticker] = analysisReport;
          analys = newAnalys;
          notify(`Bought ${shares} share${shares > 1 ? "s" : ""} of ${ticker}`);
        } else {
          if (!holdings[ticker] || holdings[ticker].shares < shares) { notify("Not enough shares", "error"); return g; }
          cash += price * shares;
          holdings[ticker] = { ...holdings[ticker], shares: holdings[ticker].shares - shares };
          if (holdings[ticker].shares === 0) delete holdings[ticker];
          notify(`Sold ${shares} share${shares > 1 ? "s" : ""} of ${ticker}`);
        }
        const portfolioValue = cash + Object.entries(holdings).reduce((sum, [t, h]) => sum + (stockPrices[t]?.price || 0) * h.shares, 0);
        const newSnap = { t: Date.now(), value: parseFloat(portfolioValue.toFixed(2)) };
        transactions = [{ id: Date.now(), ticker, shares, price, type, total: price * shares, date: Date.now() }, ...transactions];
        return { ...g, cash: parseFloat(cash.toFixed(2)), holdings, transactions, snapshots: [...snapshots, newSnap], citations: cits, analyses: analys };
      });
      setClasses(cls => cls.map(c => c.id === prev.id ? { ...prev, groups } : c));
      const updatedGroup = groups.find(g => g.id === groupId);
      if (updatedGroup) setCurrentGroup(updatedGroup);
      return { ...prev, groups };
    });
  };

  const getPortfolioValue = (group) => {
    if (!group) return 0;
    const holdingsValue = Object.entries(group.holdings || {}).reduce((sum, [t, h]) => sum + (stockPrices[t]?.price || 0) * h.shares, 0);
    return parseFloat((group.cash + holdingsValue).toFixed(2));
  };

  const handleLogout = () => {
    if (currentUser) {
      localStorage.removeItem('sc_active_' + currentUser.email);
    }
    localStorage.removeItem('sc_session');
    setCurrentUser(null); setUserType(null);
    setCurrentClass(null); setCurrentGroup(null);
    setSessionConflict(null);
    setView(VIEWS.AUTH);
  };

  const handleResetPassword = (email, newPassword) => {
    const user = users.find(u => u.email === email);
    if (!user) return false;
    setUsers(prev => prev.map(u => u.email === email ? { ...u, password: newPassword } : u));
    return true;
  };

  const assignStudent = (studentId, toGroupId) => {
    setCurrentClass(prev => {
      if (!prev) return prev;
      const groups = (prev.groups || []).map(g => ({
        ...g,
        members: g.id === toGroupId
          ? [...(g.members || []).filter(m => m !== studentId), studentId]
          : (g.members || []).filter(m => m !== studentId),
      }));
      const updated = { ...prev, groups };
      setClasses(cls => cls.map(c => c.id === prev.id ? updated : c));
      return updated;
    });
    notify("Student assigned");
  };

  const removeFromGroup = (studentId, groupId) => {
    setCurrentClass(prev => {
      if (!prev) return prev;
      const groups = (prev.groups || []).map(g =>
        g.id === groupId ? { ...g, members: (g.members || []).filter(m => m !== studentId) } : g
      );
      const updated = { ...prev, groups };
      setClasses(cls => cls.map(c => c.id === prev.id ? updated : c));
      return updated;
    });
  };

  const toggleMarketOverride = () => {
    setCurrentClass(prev => {
      if (!prev) return prev;
      const updated = { ...prev, marketOverride: !prev.marketOverride };
      setClasses(cls => cls.map(c => c.id === prev.id ? updated : c));
      return updated;
    });
  };

  const resetGroups = () => {
    setCurrentClass(prev => {
      if (!prev) return prev;
      const updated = { ...prev, groups: [] };
      setClasses(cls => cls.map(c => c.id === prev.id ? updated : c));
      return updated;
    });
    notify("Groups cleared");
  };

  const toggleTradingFrozen = () => {
    setCurrentClass(prev => {
      if (!prev) return prev;
      const updated = { ...prev, tradingFrozen: !prev.tradingFrozen };
      setClasses(cls => cls.map(c => c.id === prev.id ? updated : c));
      return updated;
    });
  };

  const endProject = () => {
    setCurrentClass(prev => {
      if (!prev) return prev;
      const now = Date.now();
      const groups = prev.groups.map(g => {
        let { cash, holdings, transactions, snapshots } = g;
        holdings = { ...holdings };
        const autoTxns = [];
        Object.entries(holdings).forEach(([ticker, h]) => {
          const price = stockPrices[ticker]?.price;
          if (!price || !h.shares) return;
          const saleTotal = price * h.shares;
          cash += saleTotal;
          autoTxns.push({ id: now + Math.random(), ticker, shares: h.shares, price, type: "sell", total: saleTotal, date: now, autoSell: true });
        });
        const finalValue = parseFloat(cash.toFixed(2));
        const newSnap = { t: now, value: finalValue };
        return {
          ...g,
          cash: finalValue,
          holdings: {},
          transactions: [...autoTxns, ...transactions],
          snapshots: [...snapshots, newSnap],
          finalValue,
        };
      });
      const updated = { ...prev, groups, projectEnded: true, projectEndedAt: now, tradingFrozen: true };
      setClasses(cls => cls.map(c => c.id === prev.id ? updated : c));
      return updated;
    });
    notify("Project ended! All stocks sold automatically.");
  };

  if (view === VIEWS.AUTH) return <AuthScreen authTab={authTab} setAuthTab={setAuthTab} authForm={authForm} setAuthForm={setAuthForm} handleLogin={handleLogin} handleSignup={handleSignup} notification={notification} sessionConflict={sessionConflict} setSessionConflict={setSessionConflict} onResetPassword={handleResetPassword} />;
  if (view === VIEWS.TEACHER_DASH) return <TeacherDashboard currentUser={currentUser} currentClass={currentClass} classes={classes} stockPrices={stockPrices} createClass={createClass} createGroups={createGroups} getPortfolioValue={getPortfolioValue} setCurrentClass={setCurrentClass} setView={setView} setSelectedStock={setSelectedStock} notification={notification} notify={notify} setClasses={setClasses} onLogout={handleLogout} users={users} assignStudent={assignStudent} removeFromGroup={removeFromGroup} toggleMarketOverride={toggleMarketOverride} resetGroups={resetGroups} toggleTradingFrozen={toggleTradingFrozen} endProject={endProject} />;
  if (view === VIEWS.STUDENT_DASH) return <StudentDashboard currentUser={currentUser} currentGroup={currentGroup} currentClass={currentClass} stockPrices={stockPrices} stockHistory={stockHistory} executeTrade={executeTrade} getPortfolioValue={getPortfolioValue} setView={setView} setSelectedStock={setSelectedStock} notification={notification} notify={notify} onLogout={handleLogout} addStockPrice={addStockPrice} />;
  if (view === VIEWS.STOCK_DETAIL) return <StockDetail ticker={selectedStock} stockPrices={stockPrices} currentGroup={currentGroup} currentClass={currentClass} executeTrade={executeTrade} setView={setView} userType={userType} notify={notify} currentUser={currentUser} onLogout={handleLogout} stockHistory={stockHistory} cacheHistory={cacheHistory} addStockPrice={addStockPrice} />;
  return null;
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
// ── Password strength helpers ──────────────────────────────────────────────
const PW_RULES = [
  { label: "At least 8 characters",       test: (p) => p.length >= 8 },
  { label: "One uppercase letter (A–Z)",  test: (p) => /[A-Z]/.test(p) },
  { label: "One lowercase letter (a–z)",  test: (p) => /[a-z]/.test(p) },
  { label: "One number (0–9)",            test: (p) => /\d/.test(p) },
  { label: "One special character",       test: (p) => /[!@#$%^&*()\-_=+[\]{};':",.<>/?\\|`~]/.test(p) },
];
const getPasswordStrength = (pw) => {
  const passed = PW_RULES.map(r => r.test(pw));
  const score  = passed.filter(Boolean).length;
  const label  = score <= 2 ? "Weak" : score <= 4 ? "Medium" : "Strong";
  const color  = score <= 2 ? "#ff3b5c" : score <= 4 ? "#f0b429" : "#00c076";
  return { score, passed, label, color };
};

function AuthScreen({ authTab, setAuthTab, authForm, setAuthForm, handleLogin, handleSignup, notification, sessionConflict, setSessionConflict, onResetPassword }) {
  const [fpStep, setFpStep] = useState(0); // 0=enter email, 1=enter new password, 2=success
  const [fpEmail, setFpEmail] = useState("");
  const [fpPassword, setFpPassword] = useState("");
  const [fpConfirm, setFpConfirm] = useState("");
  const [fpError, setFpError] = useState("");

  // Email verification signup flow
  const [signupStep, setSignupStep] = useState("form"); // "form" | "verify" | "done"
  const [enteredCode, setEnteredCode] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef(null);

  const switchTab = (t) => {
    setAuthTab(t);
    setSessionConflict(null);
    setFpStep(0); setFpEmail(""); setFpPassword(""); setFpConfirm(""); setFpError("");
    setSignupStep("form"); setEnteredCode(""); setVerifyError("");
    setSendLoading(false); setVerifyLoading(false);
  };

  const startResendCooldown = () => {
    setResendCooldown(60);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const initiateSignup = async () => {
    if (!authForm.name.trim() || !authForm.email.trim() || !authForm.password) {
      setVerifyError("Please fill in all fields"); return;
    }
    if (authForm.role === "student" && !authForm.classCode.trim()) {
      setVerifyError("Enter a class access code"); return;
    }
    const { score } = getPasswordStrength(authForm.password);
    if (score < 5) { setVerifyError("Your password doesn't meet all requirements"); return; }
    setSendLoading(true); setVerifyError("");
    try {
      await sendVerificationCodeApi(authForm.email.trim().toLowerCase());
      setSignupStep("verify");
      startResendCooldown();
    } catch (err) {
      setVerifyError(err.message || "Failed to send verification email. Is the server running?");
    } finally {
      setSendLoading(false);
    }
  };

  const submitVerification = async () => {
    if (!enteredCode.trim()) { setVerifyError("Enter the 6-digit code"); return; }
    setVerifyLoading(true); setVerifyError("");
    try {
      await verifyCodeApi(authForm.email.trim().toLowerCase(), enteredCode.trim());
      setSignupStep("done");
      setTimeout(() => handleSignup(), 1500);
    } catch (err) {
      setVerifyError(err.message || "Incorrect or expired code");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleFpSubmitEmail = () => {
    const stored = loadFromLS('sc_users', DEFAULT_USERS);
    const user = stored.find(u => u.email === fpEmail.trim().toLowerCase());
    if (!user) { setFpError("No account found with that email."); return; }
    setFpError("");
    setFpStep(1);
  };

  const handleFpReset = () => {
    if (!fpPassword) { setFpError("Enter a new password."); return; }
    if (fpPassword !== fpConfirm) { setFpError("Passwords don't match."); return; }
    if (fpPassword.length < 4) { setFpError("Password must be at least 4 characters."); return; }
    const ok = onResetPassword(fpEmail.trim().toLowerCase(), fpPassword);
    if (ok) { setFpStep(2); setFpError(""); }
    else { setFpError("Something went wrong. Try again."); }
  };

  const Wordmark = () => (
    <div style={{ textAlign: "center", marginBottom: 28 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <LogoMark size={42} gradId="lgAuth" />
        <span style={{ fontFamily: "Syne, sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: "0.04em", color: "#eeeef2" }}>
          STOCKROOM
        </span>
      </div>
      <p style={{ fontSize: 13, color: "rgba(238,238,242,0.42)", margin: 0 }}>Classroom stock market simulator</p>
    </div>
  );

  const btnStyle = (color = "green") => ({
    width: "100%", padding: "13px", marginTop: 4,
    background: color === "green" ? "linear-gradient(135deg, #00c076, #00a566)" : "rgba(255,255,255,0.06)",
    border: color === "green" ? "none" : "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10, cursor: "pointer",
    fontSize: 15, fontWeight: 600,
    color: color === "green" ? "#0a2918" : "#eeeef2",
    fontFamily: "DM Sans, sans-serif",
    boxShadow: color === "green" ? "0 4px 24px rgba(0,192,118,0.25)" : "none",
    transition: "opacity 0.15s",
  });

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0d0d0f", position: "relative", overflow: "hidden",
    }}>
      <Notification n={notification} />
      <div style={{
        position: "absolute", width: 700, height: 700, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(0,192,118,0.05) 0%, transparent 65%)",
        top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
      }} />

      <div style={{
        width: 420, position: "relative", zIndex: 1,
        background: "rgba(22,22,27,0.92)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 20, padding: "36px 32px",
        backdropFilter: "blur(24px)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
      }}>
        <Wordmark />

        {/* ── FORGOT PASSWORD FLOW ── */}
        {authTab === "forgot" && (
          <div>
            <button onClick={() => switchTab("login")} style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(238,238,242,0.45)", fontSize: 13, marginBottom: 20,
              fontFamily: "DM Sans, sans-serif", padding: 0, display: "flex", alignItems: "center", gap: 6,
            }}>← Back to sign in</button>

            {fpStep === 0 && (
              <>
                <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Reset password</h3>
                <p style={{ fontSize: 13, color: "rgba(238,238,242,0.45)", marginBottom: 20 }}>Enter your email and we'll let you set a new password.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input type="email" placeholder="Email address" value={fpEmail}
                    onChange={e => setFpEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleFpSubmitEmail()} />
                  {fpError && <div style={{ fontSize: 12, color: "#ff3b5c", padding: "7px 10px", background: "rgba(255,59,92,0.08)", borderRadius: 7, border: "1px solid rgba(255,59,92,0.2)" }}>{fpError}</div>}
                  <button onClick={handleFpSubmitEmail} style={btnStyle("green")}>Continue</button>
                </div>
              </>
            )}

            {fpStep === 1 && (
              <>
                <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>New password</h3>
                <p style={{ fontSize: 13, color: "rgba(238,238,242,0.45)", marginBottom: 20 }}>
                  Setting new password for <strong style={{ color: "#eeeef2" }}>{fpEmail}</strong>
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input type="password" placeholder="New password" value={fpPassword}
                    onChange={e => setFpPassword(e.target.value)} />
                  <input type="password" placeholder="Confirm new password" value={fpConfirm}
                    onChange={e => setFpConfirm(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleFpReset()} />
                  {fpError && <div style={{ fontSize: 12, color: "#ff3b5c", padding: "7px 10px", background: "rgba(255,59,92,0.08)", borderRadius: 7, border: "1px solid rgba(255,59,92,0.2)" }}>{fpError}</div>}
                  <button onClick={handleFpReset} style={btnStyle("green")}>Reset password</button>
                </div>
              </>
            )}

            {fpStep === 2 && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{
                  width: 52, height: 52, borderRadius: "50%",
                  background: "rgba(0,192,118,0.15)", border: "2px solid rgba(0,192,118,0.3)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 16px", fontSize: 22, color: "#00c076",
                }}>✓</div>
                <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Password updated!</h3>
                <p style={{ fontSize: 13, color: "rgba(238,238,242,0.45)", marginBottom: 20 }}>You can now sign in with your new password.</p>
                <button onClick={() => switchTab("login")} style={btnStyle("green")}>Go to sign in</button>
              </div>
            )}
          </div>
        )}

        {/* ── LOGIN / SIGNUP TABS ── */}
        {authTab !== "forgot" && (
          <>
            {/* Tab switcher — hidden during email verification steps */}
            {!(authTab === "signup" && signupStep !== "form") && (
              <div style={{
                display: "flex", background: "rgba(255,255,255,0.04)",
                borderRadius: 10, padding: 3, marginBottom: 22,
              }}>
                {["login", "signup"].map(t => (
                  <button key={t} onClick={() => switchTab(t)} style={{
                    flex: 1, padding: "8px",
                    background: authTab === t ? "rgba(255,255,255,0.09)" : "transparent",
                    border: authTab === t ? "1px solid rgba(255,255,255,0.1)" : "1px solid transparent",
                    borderRadius: 8, cursor: "pointer",
                    fontSize: 13, fontWeight: authTab === t ? 600 : 400,
                    color: authTab === t ? "#eeeef2" : "rgba(238,238,242,0.42)",
                    transition: "all 0.2s", fontFamily: "DM Sans, sans-serif",
                  }}>
                    {t === "login" ? "Sign in" : "Sign up"}
                  </button>
                ))}
              </div>
            )}

            {/* ── VERIFY STEP ── */}
            {authTab === "signup" && signupStep === "verify" && (
              <div className="sc-anim">
                <button onClick={() => setSignupStep("form")} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "rgba(238,238,242,0.45)", fontSize: 13, marginBottom: 20,
                  fontFamily: "DM Sans, sans-serif", padding: 0, display: "flex", alignItems: "center", gap: 6,
                }}>← Back</button>
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: "50%",
                    background: "rgba(91,120,255,0.15)", border: "1px solid rgba(91,120,255,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 14px", fontSize: 22,
                  }}>✉</div>
                  <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Check your inbox</h3>
                  <p style={{ fontSize: 13, color: "rgba(238,238,242,0.45)", lineHeight: 1.6 }}>
                    We sent a 6-digit code to<br />
                    <strong style={{ color: "#eeeef2" }}>{authForm.email}</strong>
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input
                    type="text" inputMode="numeric" maxLength={6}
                    placeholder="000000"
                    value={enteredCode}
                    onChange={e => { setEnteredCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setVerifyError(""); }}
                    onKeyDown={e => e.key === "Enter" && submitVerification()}
                    style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 28, fontWeight: 700, textAlign: "center", letterSpacing: "0.3em", padding: "14px" }}
                  />
                  {verifyError && (
                    <div style={{ fontSize: 12, color: "#ff3b5c", padding: "7px 10px", background: "rgba(255,59,92,0.08)", borderRadius: 7, border: "1px solid rgba(255,59,92,0.2)" }}>
                      {verifyError}
                    </div>
                  )}
                  <button onClick={submitVerification} disabled={verifyLoading || enteredCode.length < 6} style={{
                    ...btnStyle("green"),
                    opacity: (verifyLoading || enteredCode.length < 6) ? 0.55 : 1,
                    cursor: (verifyLoading || enteredCode.length < 6) ? "default" : "pointer",
                  }}>
                    {verifyLoading ? "Verifying…" : "Verify email"}
                  </button>
                  <div style={{ textAlign: "center", marginTop: 4 }}>
                    {resendCooldown > 0 ? (
                      <span style={{ fontSize: 12, color: "rgba(238,238,242,0.35)" }}>
                        Resend code in {resendCooldown}s
                      </span>
                    ) : (
                      <button onClick={initiateSignup} disabled={sendLoading} style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 13, color: "#7b96ff", fontFamily: "DM Sans, sans-serif",
                      }}>
                        {sendLoading ? "Sending…" : "Resend code"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── DONE STEP ── */}
            {authTab === "signup" && signupStep === "done" && (
              <div className="sc-anim" style={{ textAlign: "center", padding: "12px 0" }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "rgba(0,192,118,0.15)", border: "2px solid rgba(0,192,118,0.35)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 16px", fontSize: 24, color: "#00c076",
                }}>✓</div>
                <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Email verified!</h3>
                <p style={{ fontSize: 13, color: "rgba(238,238,242,0.45)" }}>Setting up your account…</p>
              </div>
            )}

            {/* ── FORM STEP (login or signup step="form") ── */}
            {!(authTab === "signup" && signupStep !== "form") && (
              <>
                {/* Session conflict warning */}
                {sessionConflict && (
                  <div style={{
                    marginBottom: 16, padding: "12px 14px",
                    background: "rgba(240,180,41,0.08)", border: "1px solid rgba(240,180,41,0.25)",
                    borderRadius: 10, fontSize: 13,
                  }}>
                    <div style={{ fontWeight: 600, color: "#f0b429", marginBottom: 6 }}>Already logged in</div>
                    <div style={{ color: "rgba(238,238,242,0.55)", marginBottom: 10 }}>
                      This account is already active in another session. Continue to end that session and log in here.
                    </div>
                    <button onClick={() => handleLogin(true)} style={{
                      width: "100%", padding: "8px",
                      background: "rgba(240,180,41,0.15)", border: "1px solid rgba(240,180,41,0.3)",
                      borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                      color: "#f0b429", fontFamily: "DM Sans, sans-serif",
                    }}>Continue &amp; end other session</button>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {authTab === "signup" && (
                    <>
                      <input placeholder="Full name" value={authForm.name}
                        onChange={e => setAuthForm(p => ({ ...p, name: e.target.value }))} />
                      <select value={authForm.role} onChange={e => setAuthForm(p => ({ ...p, role: e.target.value }))}>
                        <option value="student">Student</option>
                        <option value="teacher">Teacher</option>
                      </select>
                      {authForm.role === "student" && (
                        <input placeholder="Class access code"
                          value={authForm.classCode}
                          onChange={e => setAuthForm(p => ({ ...p, classCode: e.target.value }))}
                          style={{ fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.12em", textTransform: "uppercase" }} />
                      )}
                    </>
                  )}
                  <input type="email" placeholder="Email address" value={authForm.email}
                    onChange={e => { setAuthForm(p => ({ ...p, email: e.target.value })); setSessionConflict(null); }} />
                  <div>
                    <input type="password" placeholder="Password" value={authForm.password}
                      onChange={e => { setAuthForm(p => ({ ...p, password: e.target.value })); setSessionConflict(null); setVerifyError(""); }}
                      onKeyDown={e => e.key === "Enter" && (authTab === "login" ? handleLogin() : initiateSignup())} />

                    {/* Password strength meter — signup only */}
                    {authTab === "signup" && authForm.password.length > 0 && (() => {
                      const { score, passed, label, color } = getPasswordStrength(authForm.password);
                      return (
                        <div style={{ marginTop: 8 }}>
                          {/* Bar */}
                          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                            {[0,1,2,3,4].map(i => (
                              <div key={i} style={{
                                flex: 1, height: 3, borderRadius: 2,
                                background: i < score ? color : "rgba(255,255,255,0.08)",
                                transition: "background 0.2s",
                              }} />
                            ))}
                            <span style={{ fontSize: 11, color, marginLeft: 6, fontWeight: 600, whiteSpace: "nowrap", lineHeight: "3px", alignSelf: "center" }}>{label}</span>
                          </div>
                          {/* Requirements checklist */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            {PW_RULES.map((rule, i) => (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                                <span style={{ color: passed[i] ? "#00c076" : "rgba(238,238,242,0.28)", fontSize: 10, flexShrink: 0 }}>
                                  {passed[i] ? "✓" : "○"}
                                </span>
                                <span style={{ color: passed[i] ? "rgba(238,238,242,0.6)" : "rgba(238,238,242,0.35)" }}>
                                  {rule.label}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {verifyError && authTab === "signup" && (
                    <div style={{ fontSize: 12, color: "#ff3b5c", padding: "7px 10px", background: "rgba(255,59,92,0.08)", borderRadius: 7, border: "1px solid rgba(255,59,92,0.2)" }}>
                      {verifyError}
                    </div>
                  )}

                  <button
                    onClick={authTab === "login" ? () => handleLogin() : initiateSignup}
                    disabled={sendLoading}
                    style={{ ...btnStyle("green"), opacity: sendLoading ? 0.7 : 1, cursor: sendLoading ? "default" : "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = sendLoading ? "0.7" : "0.9"}
                    onMouseLeave={e => e.currentTarget.style.opacity = sendLoading ? "0.7" : "1"}
                    onMouseDown={e => e.currentTarget.style.transform = "scale(0.98)"}
                    onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                  >
                    {authTab === "login" ? "Sign in" : (sendLoading ? "Sending code…" : "Continue")}
                  </button>
                </div>
              </>
            )}

            {authTab === "login" && (
              <>
                <div style={{ textAlign: "center", marginTop: 14 }}>
                  <button onClick={() => switchTab("forgot")} style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 13, color: "rgba(238,238,242,0.38)", fontFamily: "DM Sans, sans-serif",
                    textDecoration: "underline", textDecorationColor: "rgba(238,238,242,0.18)",
                  }}>Forgot password?</button>
                </div>
                <div style={{
                  marginTop: 14, padding: "11px 14px",
                  background: "rgba(91,120,255,0.07)",
                  border: "1px solid rgba(91,120,255,0.18)",
                  borderRadius: 8, fontSize: 12,
                  color: "rgba(238,238,242,0.48)", lineHeight: 1.8,
                }}>
                  <strong style={{ color: "rgba(238,238,242,0.65)", display: "block", marginBottom: 1 }}>Demo accounts</strong>
                  Teacher: teacher@school.edu / pass<br />
                  Student: alex@school.edu / pass
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── TEACHER DASHBOARD ────────────────────────────────────────────────────────
function TeacherDashboard({ currentUser, currentClass, classes, stockPrices, createClass, createGroups, getPortfolioValue, setCurrentClass, setView, setSelectedStock, notification, notify, setClasses, onLogout, users, assignStudent, removeFromGroup, toggleMarketOverride, resetGroups, toggleTradingFrozen, endProject }) {
  const [tab, setTab] = useState("overview");
  const [newClassName, setNewClassName] = useState("");
  const [newBalance, setNewBalance] = useState("1000");
  const [groupSize, setGroupSize] = useState("3");
  const [groupNames, setGroupNames] = useState("");
  const [groupMode, setGroupMode] = useState("random");
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingBalance, setEditingBalance] = useState(false);
  const [newBalanceEdit, setNewBalanceEdit] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [endProjectConfirm, setEndProjectConfirm] = useState(false);
  const myClasses = classes.filter(c => c.teacherId === currentUser.id);
  const activeClass = currentClass || myClasses[0];

  const getStudentName = (id) => users?.find(u => u.id === id)?.name || "Unknown";
  const allAssignedIds = new Set((activeClass?.groups || []).flatMap(g => g.members || []));
  const unassignedStudents = (activeClass?.students || []).filter(id => !allAssignedIds.has(id));

  const copyCode = () => {
    navigator.clipboard?.writeText(activeClass?.code || "").then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }).catch(() => notify("Couldn't copy — code: " + activeClass?.code, "error"));
  };

  const isMarketOpen = () => {
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = et.getDay(), h = et.getHours(), m = et.getMinutes();
    return day >= 1 && day <= 5 && h * 60 + m >= 570 && h * 60 + m < 960;
  };

  const handleUpdateBalance = () => {
    const val = parseFloat(newBalanceEdit);
    if (!val || val < 1) { notify("Invalid amount", "error"); return; }
    setClasses(prev => prev.map(c => c.id === activeClass.id ? { ...c, startingBalance: val, groups: c.groups.map(g => ({ ...g, cash: val })) } : c));
    setCurrentClass(prev => prev ? { ...prev, startingBalance: val, groups: prev.groups.map(g => ({ ...g, cash: val })) } : prev);
    setEditingBalance(false);
    notify("Starting balance updated");
  };


  const leaderboard = activeClass?.groups?.map(g => ({
    ...g, value: getPortfolioValue(g),
    gain: getPortfolioValue(g) - activeClass.startingBalance,
    gainPct: ((getPortfolioValue(g) - activeClass.startingBalance) / activeClass.startingBalance) * 100
  })).sort((a, b) => b.value - a.value) || [];

  const sidebar = (
    <Sidebar
      items={[{ id: "overview", label: "Overview" }, { id: "groups", label: "Groups" }, { id: "leaderboard", label: "Leaderboard" }, { id: "settings", label: "Settings" }]}
      active={tab} setActive={setTab}
      user={currentUser} subtitle={activeClass?.name || "Teacher"}
      marketOpen={isMarketOpen()} onLogout={onLogout}
    />
  );

  if (!activeClass) {
    return (
      <Layout sidebar={sidebar}>
        <Notification n={notification} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <Card style={{ padding: 40, width: 440 }} className="sc-card-anim">
            <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Create your first class</h2>
            <p style={{ fontSize: 14, color: "rgba(238,238,242,0.5)", marginBottom: 24 }}>Set up a class to invite students and start trading.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input placeholder="Class name (e.g. Period 3 Economics)" value={newClassName} onChange={e => setNewClassName(e.target.value)} />
              <input placeholder="Starting balance per group ($)" value={newBalance} onChange={e => setNewBalance(e.target.value)} type="number" />
              <button onClick={() => createClass(newClassName, newBalance)} style={{
                padding: "12px", background: "linear-gradient(135deg, #00c076, #00a566)",
                border: "none", borderRadius: 10, cursor: "pointer",
                fontSize: 15, fontWeight: 600, color: "#0a2918", fontFamily: "DM Sans, sans-serif",
                boxShadow: "0 4px 20px rgba(0,192,118,0.22)",
              }}>Create class</button>
            </div>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout sidebar={sidebar}>
      <Notification n={notification} />
      <div style={{ padding: "28px 32px", maxWidth: 1100 }}>

        {/* Class header */}
        <div style={{ marginBottom: 28 }}>
          {myClasses.length > 1 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {myClasses.map(c => (
                <button key={c.id} onClick={() => setCurrentClass(c)} style={{
                  padding: "5px 14px",
                  background: activeClass?.id === c.id ? "rgba(255,255,255,0.09)" : "transparent",
                  border: `1px solid ${activeClass?.id === c.id ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: 20, cursor: "pointer", fontSize: 13,
                  fontWeight: activeClass?.id === c.id ? 600 : 400,
                  color: activeClass?.id === c.id ? "#eeeef2" : "rgba(238,238,242,0.45)",
                  fontFamily: "DM Sans, sans-serif",
                }}>{c.name}</button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{activeClass.name}</h1>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div onClick={copyCode} title="Click to copy" style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "rgba(91,120,255,0.1)", border: "1px solid rgba(91,120,255,0.2)",
                  borderRadius: 8, padding: "5px 12px", cursor: "pointer",
                  transition: "background 0.15s",
                }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(91,120,255,0.18)"}
                  onMouseLeave={e => e.currentTarget.style.background = "rgba(91,120,255,0.1)"}
                >
                  <span style={{ fontSize: 11, color: "rgba(238,238,242,0.45)" }}>ACCESS CODE</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, letterSpacing: "0.15em", color: "#7b96ff" }}>
                    {activeClass.code}
                  </span>
                  <span style={{ fontSize: 11, color: codeCopied ? "#00c076" : "rgba(238,238,242,0.3)", transition: "color 0.2s" }}>
                    {codeCopied ? "✓ Copied" : "⎘"}
                  </span>
                </div>
                <span style={{ fontSize: 13, color: "rgba(238,238,242,0.42)" }}>
                  {activeClass.students?.length || 0} students · {activeClass.groups?.length || 0} groups
                </span>
                {unassignedStudents.length > 0 && (
                  <span onClick={() => setTab("groups")} style={{
                    fontSize: 12, color: "#f0b429", fontWeight: 600, cursor: "pointer",
                    background: "rgba(240,180,41,0.1)", border: "1px solid rgba(240,180,41,0.2)",
                    borderRadius: 6, padding: "3px 9px",
                  }}>
                    {unassignedStudents.length} unassigned →
                  </span>
                )}
                {activeClass.marketOverride && (
                  <span style={{
                    fontSize: 12, color: "#00c076", fontWeight: 600,
                    background: "rgba(0,192,118,0.1)", border: "1px solid rgba(0,192,118,0.2)",
                    borderRadius: 6, padding: "3px 9px",
                  }}>
                    ⚡ Market override ON
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* OVERVIEW TAB */}
        {tab === "overview" && (
          <div className="sc-anim">
            {/* Project ended banner */}
            {activeClass.projectEnded && (
              <div style={{
                marginBottom: 20, padding: "14px 18px",
                background: "rgba(240,180,41,0.07)", border: "1px solid rgba(240,180,41,0.25)",
                borderRadius: 10, display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ fontSize: 18 }}>🏁</span>
                <div>
                  <div style={{ fontWeight: 700, color: "#f0b429", fontSize: 14 }}>Project Ended</div>
                  <div style={{ fontSize: 12, color: "rgba(238,238,242,0.5)", marginTop: 2 }}>
                    All stocks were sold automatically on {new Date(activeClass.projectEndedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. Final balances are shown below.
                  </div>
                </div>
              </div>
            )}
            {/* Stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Groups", val: activeClass.groups?.length || 0, mono: false },
                { label: "Students", val: activeClass.students?.length || 0, mono: false },
                { label: "Starting Balance", val: fmt$(activeClass.startingBalance), mono: true },
                { label: "Top Portfolio", val: leaderboard[0] ? fmt$(leaderboard[0].value) : "—", mono: true, color: leaderboard[0]?.gain >= 0 ? "#00c076" : "#ff3b5c" },
              ].map(m => (
                <Card key={m.label} style={{ padding: "18px 20px" }}>
                  <div style={{ fontSize: 12, color: "rgba(238,238,242,0.45)", marginBottom: 6, letterSpacing: "0.04em" }}>{m.label.toUpperCase()}</div>
                  <div style={{ fontSize: 22, fontWeight: 600, fontFamily: m.mono ? "'IBM Plex Mono',monospace" : "Syne, sans-serif", color: m.color || "#eeeef2" }}>{m.val}</div>
                </Card>
              ))}
            </div>

            {/* Portfolio snapshot */}
            {leaderboard.length > 0 && (
              <Card>
                <div style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 600, fontSize: 15 }}>Portfolio Snapshot</span>
                </div>
                {leaderboard.map((g, i) => {
                  const maxVal = leaderboard[0]?.value || 1;
                  const barW = (g.value / maxVal) * 100;
                  return (
                    <div key={g.id} style={{
                      padding: "14px 20px",
                      borderBottom: i < leaderboard.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                      display: "grid", gridTemplateColumns: "28px 1fr 130px 100px", gap: 12, alignItems: "center",
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 700, flexShrink: 0,
                        background: i === 0 ? "rgba(240,180,41,0.15)" : i === 1 ? "rgba(138,155,181,0.1)" : i === 2 ? "rgba(201,117,64,0.1)" : "rgba(255,255,255,0.05)",
                        color: i === 0 ? "#f0b429" : i === 1 ? "#8a9bb5" : i === 2 ? "#c97540" : "rgba(238,238,242,0.45)",
                        border: `1px solid ${i === 0 ? "rgba(240,180,41,0.3)" : i === 1 ? "rgba(138,155,181,0.25)" : i === 2 ? "rgba(201,117,64,0.25)" : "rgba(255,255,255,0.07)"}`,
                      }}>{i + 1}</div>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{g.name}</div>
                        <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${barW}%`, background: g.gain >= 0 ? "#00c076" : "#ff3b5c", borderRadius: 2, transition: "width 0.6s ease" }} />
                        </div>
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: activeClass.projectEnded ? 15 : 14, fontWeight: activeClass.projectEnded ? 800 : 600, textAlign: "right", color: activeClass.projectEnded ? "#eeeef2" : undefined }}>{fmt$(g.value)}</div>
                      <div style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: g.gain >= 0 ? "#00c076" : "#ff3b5c", fontWeight: activeClass.projectEnded ? 700 : 400 }}>
                        {fmtPct(g.gainPct)}
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        )}

        {/* GROUPS TAB */}
        {tab === "groups" && (
          <div className="sc-anim">
            {!activeClass.groups?.length ? (
              <Card style={{ padding: "28px", maxWidth: 520 }}>
                <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Create groups</h3>
                <p style={{ fontSize: 13, color: "rgba(238,238,242,0.45)", marginBottom: 20 }}>
                  Organize students into trading teams. You can assign students manually after creating groups.
                </p>
                <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                  {["random", "manual"].map(m => (
                    <button key={m} onClick={() => setGroupMode(m)} style={{
                      flex: 1, padding: "8px",
                      background: groupMode === m ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${groupMode === m ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.07)"}`,
                      borderRadius: 8, cursor: "pointer", fontSize: 13,
                      fontWeight: groupMode === m ? 600 : 400,
                      color: groupMode === m ? "#eeeef2" : "rgba(238,238,242,0.45)",
                      textTransform: "capitalize", fontFamily: "DM Sans, sans-serif",
                    }}>{m === "random" ? "Auto-assign" : "Named groups"}</button>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {groupMode === "random" ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <label style={{ fontSize: 14, color: "rgba(238,238,242,0.5)", whiteSpace: "nowrap" }}>Students per group</label>
                        <input type="number" value={groupSize} onChange={e => setGroupSize(e.target.value)} min="2" max="8" style={{ width: 80, flex: "none" }} />
                      </div>
                      {activeClass.students?.length > 0 && (
                        <div style={{ fontSize: 12, color: "rgba(238,238,242,0.35)", padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 7 }}>
                          {activeClass.students.length} students → ~{Math.ceil(activeClass.students.length / (parseInt(groupSize) || 3))} groups
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      <label style={{ fontSize: 13, color: "rgba(238,238,242,0.5)", display: "block", marginBottom: 6 }}>
                        Group names (one per line) — assign students after creation
                      </label>
                      <textarea value={groupNames} onChange={e => setGroupNames(e.target.value)} rows={4}
                        placeholder={"Bulls\nBears\nWolves"} style={{ resize: "vertical", fontSize: 14 }} />
                    </div>
                  )}
                  <button onClick={() => {
                    if (groupMode === "random") createGroups(activeClass.id, parseInt(groupSize), false, []);
                    else createGroups(activeClass.id, 0, true, groupNames.split("\n").map(n => n.trim()).filter(Boolean));
                  }} style={{
                    padding: "12px", background: "linear-gradient(135deg, #00c076, #00a566)",
                    border: "none", borderRadius: 10, cursor: "pointer",
                    fontSize: 15, fontWeight: 600, color: "#0a2918", fontFamily: "DM Sans, sans-serif",
                  }}>Create groups</button>
                </div>
              </Card>
            ) : (
              <>
                {/* Controls row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, color: "rgba(238,238,242,0.45)" }}>
                    {activeClass.groups.length} groups · {activeClass.students?.length || 0} students enrolled
                  </div>
                  <button onClick={() => {
                    if (window.confirm("Clear all groups? Student portfolios are preserved but group assignments will be removed.")) resetGroups();
                  }} style={{
                    padding: "6px 14px", background: "rgba(255,59,92,0.07)",
                    border: "1px solid rgba(255,59,92,0.2)",
                    borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#ff3b5c",
                    fontFamily: "DM Sans, sans-serif", transition: "background 0.15s",
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,59,92,0.14)"}
                    onMouseLeave={e => e.currentTarget.style.background = "rgba(255,59,92,0.07)"}
                  >Reset groups</button>
                </div>

                {/* Unassigned students panel */}
                {unassignedStudents.length > 0 && (
                  <Card style={{ padding: "18px 20px", marginBottom: 18, border: "1px solid rgba(240,180,41,0.2)", background: "rgba(240,180,41,0.03)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f0b429", flexShrink: 0, boxShadow: "0 0 8px rgba(240,180,41,0.6)" }} />
                      <span style={{ fontSize: 12, color: "#f0b429", fontWeight: 600, letterSpacing: "0.07em" }}>
                        UNASSIGNED STUDENTS ({unassignedStudents.length})
                      </span>
                      <span style={{ fontSize: 12, color: "rgba(238,238,242,0.35)", marginLeft: 4 }}>— drag into a group using the dropdown</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {unassignedStudents.map(studentId => (
                        <div key={studentId} style={{
                          display: "flex", alignItems: "center", gap: 7,
                          padding: "6px 8px 6px 10px",
                          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
                          borderRadius: 22, fontSize: 13,
                        }}>
                          <div style={{
                            width: 22, height: 22, borderRadius: "50%",
                            background: "rgba(240,180,41,0.18)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, fontWeight: 700, color: "#f0b429", flexShrink: 0,
                          }}>{getStudentName(studentId)[0]?.toUpperCase() || "?"}</div>
                          <span style={{ color: "#eeeef2", whiteSpace: "nowrap" }}>{getStudentName(studentId)}</span>
                          <select
                            defaultValue=""
                            onChange={e => { if (e.target.value) { assignStudent(studentId, e.target.value); e.target.value = ""; }}}
                            style={{ fontSize: 11, padding: "2px 5px", borderRadius: 6, width: "auto", flex: "none", cursor: "pointer", marginLeft: 2 }}
                          >
                            <option value="" disabled>Assign →</option>
                            {activeClass.groups.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Group cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                  {activeClass.groups.map(g => {
                    const gVal = getPortfolioValue(g);
                    const gGain = gVal - activeClass.startingBalance;
                    const holdings = Object.entries(g.holdings || {});
                    const members = g.members || [];
                    return (
                      <Card key={g.id} style={{ padding: "20px" }}>
                        {/* Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {editingGroup === g.id ? (
                              <input defaultValue={g.name} onBlur={e => {
                                setCurrentClass(prev => {
                                  const groups = prev.groups.map(gr => gr.id === g.id ? { ...gr, name: e.target.value } : gr);
                                  setClasses(cls => cls.map(c => c.id === prev.id ? { ...prev, groups } : c));
                                  return { ...prev, groups };
                                });
                                setEditingGroup(null);
                              }} autoFocus style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 16, width: "100%" }} />
                            ) : (
                              <div onClick={() => setEditingGroup(g.id)} title="Click to rename" style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 16, cursor: "text" }}>{g.name}</div>
                            )}
                            <div style={{ fontSize: 11, color: "rgba(238,238,242,0.35)", marginTop: 3 }}>
                              {members.length} members · {holdings.length} positions
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600 }}>{fmt$(gVal)}</div>
                            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: gGain >= 0 ? "#00c076" : "#ff3b5c", marginTop: 2 }}>
                              {fmtChg(gGain)}
                            </div>
                          </div>
                        </div>

                        {/* Members */}
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 10, color: "rgba(238,238,242,0.28)", letterSpacing: "0.08em", marginBottom: 8 }}>MEMBERS</div>
                          {members.length === 0 ? (
                            <div style={{ fontSize: 12, color: "rgba(238,238,242,0.22)", fontStyle: "italic", padding: "8px 0" }}>
                              No members yet — assign from the panel above
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {members.map(memberId => (
                                <div key={memberId} style={{
                                  display: "flex", alignItems: "center", gap: 5,
                                  padding: "4px 4px 4px 8px",
                                  background: "rgba(91,120,255,0.08)", border: "1px solid rgba(91,120,255,0.15)",
                                  borderRadius: 14,
                                }}>
                                  <div style={{
                                    width: 18, height: 18, borderRadius: "50%",
                                    background: "rgba(91,120,255,0.22)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 9, fontWeight: 700, color: "#7b96ff", flexShrink: 0,
                                  }}>{getStudentName(memberId)[0]?.toUpperCase() || "?"}</div>
                                  <span style={{ fontSize: 12, color: "#eeeef2", whiteSpace: "nowrap" }}>{getStudentName(memberId)}</span>
                                  <button
                                    onClick={() => removeFromGroup(memberId, g.id)}
                                    title="Remove from group"
                                    style={{
                                      background: "none", border: "none", cursor: "pointer",
                                      color: "rgba(238,238,242,0.25)", fontSize: 14, padding: "0 4px",
                                      display: "flex", alignItems: "center", lineHeight: 1,
                                      borderRadius: 4, transition: "color 0.12s",
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.color = "#ff3b5c"}
                                    onMouseLeave={e => e.currentTarget.style.color = "rgba(238,238,242,0.25)"}
                                  >×</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Holdings */}
                        {holdings.length > 0 && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12 }}>
                            <div style={{ fontSize: 10, color: "rgba(238,238,242,0.28)", letterSpacing: "0.08em", marginBottom: 8 }}>HOLDINGS</div>
                            {holdings.slice(0, 3).map(([t, h]) => (
                              <div key={t} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", alignItems: "center" }}>
                                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: "#eeeef2" }}>{t}</span>
                                <span style={{ color: "rgba(238,238,242,0.45)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>
                                  {h.shares} sh · {fmt$(stockPrices[t]?.price * h.shares || 0)}
                                </span>
                              </div>
                            ))}
                            {holdings.length > 3 && <div style={{ fontSize: 11, color: "rgba(238,238,242,0.3)", marginTop: 4 }}>+{holdings.length - 3} more positions</div>}
                          </div>
                        )}
                        {holdings.length === 0 && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12, fontSize: 12, color: "rgba(238,238,242,0.22)" }}>
                            No trades yet
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* LEADERBOARD TAB */}
        {tab === "leaderboard" && (
          <div className="sc-anim">
            {activeClass.projectEnded && (
              <div style={{
                marginBottom: 20, padding: "12px 16px",
                background: "rgba(240,180,41,0.07)", border: "1px solid rgba(240,180,41,0.25)",
                borderRadius: 10, display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 16 }}>🏁</span>
                <span style={{ fontSize: 13, color: "#f0b429", fontWeight: 600 }}>Final Results — Project Ended</span>
              </div>
            )}
            {leaderboard.length === 0 ? (
              <Card style={{ padding: "40px", textAlign: "center" }}>
                <div style={{ fontSize: 14, color: "rgba(238,238,242,0.4)" }}>No groups yet. Create groups to see rankings.</div>
              </Card>
            ) : (
              <>
                {/* Top 3 podium */}
                {leaderboard.length >= 3 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                    {[leaderboard[1], leaderboard[0], leaderboard[2]].map((g, idx) => {
                      const rank = idx === 0 ? 2 : idx === 1 ? 1 : 3;
                      const rankColors = { 1: "#f0b429", 2: "#8a9bb5", 3: "#c97540" };
                      const rankBgs = { 1: "rgba(240,180,41,0.08)", 2: "rgba(138,155,181,0.06)", 3: "rgba(201,117,64,0.06)" };
                      if (!g) return null;
                      return (
                        <Card key={g.id} style={{
                          padding: "24px 20px", textAlign: "center",
                          background: rankBgs[rank],
                          border: `1px solid ${rank === 1 ? "rgba(240,180,41,0.2)" : "rgba(255,255,255,0.06)"}`,
                          marginTop: rank === 1 ? 0 : 20,
                        }}>
                          <div style={{
                            width: 44, height: 44, borderRadius: "50%", margin: "0 auto 12px",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 18, fontWeight: 800,
                            fontFamily: "Syne, sans-serif",
                            color: rankColors[rank],
                            background: `rgba(${rank === 1 ? "240,180,41" : rank === 2 ? "138,155,181" : "201,117,64"},0.15)`,
                            border: `2px solid ${rankColors[rank]}40`,
                          }}>{rank}</div>
                          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{g.name}</div>
                          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: activeClass.projectEnded ? 22 : 20, fontWeight: activeClass.projectEnded ? 800 : 600, marginBottom: 4 }}>{fmt$(g.value)}</div>
                          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: g.gain >= 0 ? "#00c076" : "#ff3b5c", fontWeight: activeClass.projectEnded ? 700 : 400 }}>
                            {fmtChg(g.gain)} ({fmtPct(g.gainPct)})
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Full list */}
                <Card>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "grid", gridTemplateColumns: "36px 1fr 130px 100px 100px 90px", gap: 12, fontSize: 11, color: "rgba(238,238,242,0.35)", fontWeight: 600, letterSpacing: "0.06em" }}>
                    <span>#</span><span>GROUP</span><span style={{ textAlign: "right" }}>PORTFOLIO</span>
                    <span style={{ textAlign: "right" }}>CASH</span><span style={{ textAlign: "right" }}>GAIN/LOSS</span><span style={{ textAlign: "right" }}>RETURN</span>
                  </div>
                  {leaderboard.map((g, i) => (
                    <div key={g.id} style={{
                      padding: "14px 20px",
                      borderBottom: i < leaderboard.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                      display: "grid", gridTemplateColumns: "36px 1fr 130px 100px 100px 90px", gap: 12, alignItems: "center",
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 700,
                        background: i === 0 ? "rgba(240,180,41,0.15)" : i === 1 ? "rgba(138,155,181,0.1)" : i === 2 ? "rgba(201,117,64,0.1)" : "rgba(255,255,255,0.05)",
                        color: i === 0 ? "#f0b429" : i === 1 ? "#8a9bb5" : i === 2 ? "#c97540" : "rgba(238,238,242,0.4)",
                        border: `1px solid ${i === 0 ? "rgba(240,180,41,0.3)" : i === 1 ? "rgba(138,155,181,0.25)" : i === 2 ? "rgba(201,117,64,0.25)" : "rgba(255,255,255,0.07)"}`,
                      }}>{i + 1}</div>
                      <span style={{ fontWeight: 500, fontSize: 14 }}>{g.name}</span>
                      <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontWeight: activeClass.projectEnded ? 800 : 600, fontSize: activeClass.projectEnded ? 15 : 14 }}>{fmt$(g.value)}</span>
                      <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "rgba(238,238,242,0.45)" }}>{fmt$(g.cash)}</span>
                      <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: g.gain >= 0 ? "#00c076" : "#ff3b5c", fontWeight: activeClass.projectEnded ? 700 : 400 }}>{fmtChg(g.gain)}</span>
                      <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: g.gainPct >= 0 ? "#00c076" : "#ff3b5c", fontWeight: activeClass.projectEnded ? 700 : 400 }}>{fmtPct(g.gainPct)}</span>
                    </div>
                  ))}
                </Card>
              </>
            )}
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab === "settings" && (
          <div className="sc-anim" style={{ maxWidth: 520 }}>
            <Card style={{ padding: "24px", marginBottom: 14 }}>
              <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Class settings</h3>

              {/* Starting balance */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 13, color: "rgba(238,238,242,0.5)", display: "block", marginBottom: 4 }}>Starting balance per group</label>
                <div style={{ fontSize: 12, color: "rgba(238,238,242,0.3)", marginBottom: 8 }}>Updates the reference balance for P&L calculations.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" value={editingBalance ? newBalanceEdit : activeClass.startingBalance}
                    onChange={e => { setEditingBalance(true); setNewBalanceEdit(e.target.value); }}
                    style={{ fontFamily: "'IBM Plex Mono',monospace" }} />
                  <button onClick={handleUpdateBalance} style={{
                    padding: "0 18px", background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                    color: "#eeeef2", whiteSpace: "nowrap", fontFamily: "DM Sans, sans-serif",
                  }}>Save</button>
                </div>
              </div>

              {/* Market override toggle */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 20, marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Classroom trading hours</div>
                    <div style={{ fontSize: 12, color: "rgba(238,238,242,0.4)", lineHeight: 1.6 }}>
                      By default, trading is restricted to 9:30am–4pm ET (Mon–Fri).<br />
                      Enable this to allow trading at any time — great for class demos.
                    </div>
                  </div>
                  <button
                    onClick={toggleMarketOverride}
                    title={activeClass.marketOverride ? "Disable override" : "Enable override"}
                    style={{
                      width: 48, height: 28, borderRadius: 14, cursor: "pointer", flexShrink: 0,
                      background: activeClass.marketOverride ? "#00c076" : "rgba(255,255,255,0.1)",
                      border: "none", position: "relative", transition: "background 0.25s",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 4, left: activeClass.marketOverride ? 24 : 4,
                      width: 20, height: 20, borderRadius: "50%",
                      background: "white", transition: "left 0.25s",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                    }} />
                  </button>
                </div>
                {activeClass.marketOverride && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#00c076", padding: "6px 10px", background: "rgba(0,192,118,0.08)", border: "1px solid rgba(0,192,118,0.2)", borderRadius: 7 }}>
                    ⚡ Market override is ON — students can trade at any time
                  </div>
                )}
              </div>

              {/* Freeze trading toggle */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 20, marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Freeze all trading</div>
                    <div style={{ fontSize: 12, color: "rgba(238,238,242,0.4)", lineHeight: 1.6 }}>
                      Instantly blocks all student trades — useful during lessons or exams.
                    </div>
                  </div>
                  <button
                    onClick={toggleTradingFrozen}
                    style={{
                      width: 48, height: 28, borderRadius: 14, cursor: "pointer", flexShrink: 0,
                      background: activeClass.tradingFrozen ? "#ff3b5c" : "rgba(255,255,255,0.1)",
                      border: "none", position: "relative", transition: "background 0.25s",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 4, left: activeClass.tradingFrozen ? 24 : 4,
                      width: 20, height: 20, borderRadius: "50%",
                      background: "white", transition: "left 0.25s",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                    }} />
                  </button>
                </div>
                {activeClass.tradingFrozen && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#ff3b5c", padding: "6px 10px", background: "rgba(255,59,92,0.08)", border: "1px solid rgba(255,59,92,0.2)", borderRadius: 7 }}>
                    🔒 Trading is frozen — students cannot execute trades
                  </div>
                )}
              </div>

              {/* End Project */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 20, marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>End project</div>
                <div style={{ fontSize: 12, color: "rgba(238,238,242,0.4)", lineHeight: 1.6, marginBottom: 12 }}>
                  Permanently ends the trading period. All stocks are automatically sold at current market prices for every team. Trading is locked and final amounts are displayed in bold.
                </div>
                {activeClass.projectEnded ? (
                  <div style={{ fontSize: 12, color: "#f0b429", padding: "8px 12px", background: "rgba(240,180,41,0.08)", border: "1px solid rgba(240,180,41,0.2)", borderRadius: 7 }}>
                    Project ended {new Date(activeClass.projectEndedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · All stocks were sold automatically
                  </div>
                ) : endProjectConfirm ? (
                  <div style={{ background: "rgba(255,59,92,0.07)", border: "1px solid rgba(255,59,92,0.2)", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 13, color: "#ff3b5c", fontWeight: 600, marginBottom: 6 }}>Are you sure?</div>
                    <div style={{ fontSize: 12, color: "rgba(238,238,242,0.55)", marginBottom: 14 }}>
                      All stocks will be sold at current prices for every team. This action cannot be undone.
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setEndProjectConfirm(false)} style={{
                        flex: 1, padding: "8px",
                        background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                        color: "rgba(238,238,242,0.6)", fontFamily: "DM Sans, sans-serif",
                      }}>Cancel</button>
                      <button onClick={() => { setEndProjectConfirm(false); endProject(); }} style={{
                        flex: 2, padding: "8px",
                        background: "linear-gradient(135deg, #ff3b5c, #d42e4e)",
                        border: "none", borderRadius: 8, cursor: "pointer",
                        fontSize: 13, fontWeight: 700, color: "#fff",
                        fontFamily: "DM Sans, sans-serif",
                      }}>End project &amp; sell all stocks</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setEndProjectConfirm(true)} style={{
                    padding: "9px 18px", background: "rgba(255,59,92,0.07)",
                    border: "1px solid rgba(255,59,92,0.2)",
                    borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                    color: "#ff3b5c", fontFamily: "DM Sans, sans-serif", transition: "background 0.15s",
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,59,92,0.14)"}
                    onMouseLeave={e => e.currentTarget.style.background = "rgba(255,59,92,0.07)"}
                  >End project</button>
                )}
              </div>

              {/* Create another class */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 20 }}>
                <label style={{ fontSize: 13, color: "rgba(238,238,242,0.5)", display: "block", marginBottom: 8 }}>Create another class</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input placeholder="Class name" value={newClassName} onChange={e => setNewClassName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && newClassName && createClass(newClassName, activeClass.startingBalance)} />
                  <button onClick={() => { if (newClassName) { createClass(newClassName, activeClass.startingBalance); setNewClassName(""); }}} style={{
                    padding: "0 18px", background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                    color: "#eeeef2", whiteSpace: "nowrap", fontFamily: "DM Sans, sans-serif",
                  }}>Create</button>
                </div>
              </div>
            </Card>

            {/* Class code card */}
            <Card style={{ padding: "20px" }}>
              <div style={{ fontSize: 13, color: "rgba(238,238,242,0.45)", marginBottom: 10 }}>Share this code with students to join your class</div>
              <div onClick={copyCode} style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
                padding: "20px", background: "rgba(91,120,255,0.07)", border: "1px solid rgba(91,120,255,0.18)",
                borderRadius: 12, cursor: "pointer", transition: "background 0.15s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(91,120,255,0.14)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(91,120,255,0.07)"}
              >
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 32, fontWeight: 700, letterSpacing: "0.2em", color: "#7b96ff" }}>
                  {activeClass.code}
                </span>
                <span style={{ fontSize: 13, color: codeCopied ? "#00c076" : "rgba(238,238,242,0.35)", transition: "color 0.2s" }}>
                  {codeCopied ? "✓ Copied!" : "Click to copy"}
                </span>
              </div>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ─── STUDENT DASHBOARD ────────────────────────────────────────────────────────
function StudentDashboard({ currentUser, currentGroup, currentClass, stockPrices, stockHistory, executeTrade, getPortfolioValue, setView, setSelectedStock, notification, notify, onLogout, addStockPrice }) {
  const [tab, setTab] = useState("portfolio");
  const [searchTicker, setSearchTicker] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [tradeModal, setTradeModal] = useState(null);
  const [tradeShares, setTradeShares] = useState(1);
  const [tradeType, setTradeType] = useState("buy");
  const [citations, setCitations] = useState([""]);
  const [analysisReport, setAnalysisReport] = useState("");
  const [searchError, setSearchError] = useState("");
  const [confirmPending, setConfirmPending] = useState(false);
  const [companySuggestions, setCompanySuggestions] = useState([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const suggestionClickRef = useRef(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (suggestionClickRef.current) { suggestionClickRef.current = false; return; }
    if (!searchTicker.trim() || searchTicker.length < 2) { setCompanySuggestions([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSuggestionLoading(true);
      try {
        const results = await searchCompaniesApi(searchTicker);
        setCompanySuggestions(results.slice(0, 5));
      } catch { setCompanySuggestions([]); }
      finally { setSuggestionLoading(false); }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [searchTicker]); // eslint-disable-line react-hooks/exhaustive-deps

  const group = currentGroup;
  const portfolioValue = getPortfolioValue(group);
  const startingBalance = currentClass?.startingBalance || 1000;
  const totalGain = group ? portfolioValue - startingBalance : 0;
  const totalGainPct = startingBalance ? (totalGain / startingBalance) * 100 : 0;
  const holdingsValue = group ? portfolioValue - (group.cash || 0) : 0;

  const isMarketOpen = () => {
    if (currentClass?.marketOverride) return true;
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = et.getDay();
    const h = et.getHours(), m = et.getMinutes();
    const mins = h * 60 + m;
    return day >= 1 && day <= 5 && mins >= 570 && mins < 960;
  };

  const marketOpen = isMarketOpen();

  const handleSearch = async (forceTicker) => {
    setCompanySuggestions([]);
    const q = (forceTicker || searchTicker).trim();
    if (!q) return;
    // If already loaded, show instantly
    const existing = stockPrices[q.toUpperCase()];
    if (existing && !forceTicker) {
      setSearchResult({ ticker: q.toUpperCase(), ...existing });
      setSearchError("");
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    setSearchResult(null);
    try {
      let result;
      try {
        result = await searchTickerApi(q);
      } catch {
        // Exact ticker lookup failed — try company name search and use the best match
        const suggestions = await searchCompaniesApi(q);
        if (!suggestions.length) throw new Error("No results found. Try a ticker (AAPL) or company name (Apple).");
        result = await searchTickerApi(suggestions[0].ticker);
      }
      setSearchResult(result);
      addStockPrice(result.ticker, { price: result.price, change: result.change, changePct: result.changePct, name: result.name });
    } catch (err) {
      setSearchError(err.message || "Not found. Try a ticker (AAPL) or company name (Apple).");
    } finally {
      setSearchLoading(false);
    }
  };

  const openTrade = (ticker, type) => {
    setTradeModal(ticker);
    setTradeType(type);
    setTradeShares(1);
    setCitations([""]);
    setAnalysisReport("");
    setConfirmPending(false);
  };

  const handleTrade = () => {
    if (!marketOpen) { notify("Market is closed (9:30am–4pm ET, Mon–Fri)", "error"); return; }
    const shares = parseInt(tradeShares, 10);
    if (!shares || shares < 1) { notify("Shares must be a whole number (minimum 1)", "error"); return; }
    const ticker = tradeModal;
    const isFirstBuy = tradeType === "buy" && !group?.holdings?.[ticker];
    if (isFirstBuy) {
      const validCitations = citations.filter(c => c.trim());
      if (validCitations.length === 0) { notify("At least one citation URL is required for a new investment", "error"); return; }
      if (!analysisReport.trim()) { notify("An analysis report is required for your first purchase of this stock", "error"); return; }
    }
    setConfirmPending(true);
  };

  const confirmTrade = () => {
    const ticker = tradeModal;
    executeTrade(group.id, ticker, parseInt(tradeShares, 10), tradeType, tradeType === "buy" ? citations.filter(c => c.trim()) : [], tradeType === "buy" ? analysisReport : "");
    setConfirmPending(false);
    setTradeModal(null);
  };

  const holdings = Object.entries(group?.holdings || {});
  const totalCost = tradeShares * (stockPrices[tradeModal]?.price || 0);
  const remainingCash = (group?.cash || 0) - totalCost;

  const sidebar = (
    <Sidebar
      items={[{ id: "portfolio", label: "Portfolio" }, { id: "trade", label: "Trade" }, { id: "history", label: "Activity" }]}
      active={tab} setActive={setTab}
      user={currentUser}
      subtitle={group ? group.name : "Awaiting group"}
      marketOpen={marketOpen} onLogout={onLogout}
      cash={group?.cash ?? 0}
      portfolioValue={group ? portfolioValue : undefined}
    />
  );

  return (
    <Layout sidebar={sidebar}>
      <Notification n={notification} />

      {/* Trade Modal */}
      {tradeModal && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, backdropFilter: "blur(8px)",
          animation: "fadeUp 0.15s ease both",
        }} onClick={e => { if (e.target === e.currentTarget) { setTradeModal(null); setConfirmPending(false); } }}>
          <div style={{
            background: "#16161b",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 18, padding: "28px",
            width: 420, maxWidth: "90vw",
            boxShadow: "0 40px 100px rgba(0,0,0,0.8)",
            animation: "scaleIn 0.2s ease both",
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: "Syne, sans-serif", fontSize: 20, fontWeight: 700 }}>{tradeModal}</div>
                <div style={{ fontSize: 12, color: "rgba(238,238,242,0.45)", marginTop: 2 }}>{stockPrices[tradeModal]?.name}</div>
              </div>
              <button onClick={() => { setTradeModal(null); setConfirmPending(false); }} style={{
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8, width: 32, height: 32,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 18, color: "rgba(238,238,242,0.6)",
              }}>×</button>
            </div>

            {/* Price */}
            <div style={{ marginBottom: 20, padding: "14px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ fontSize: 12, color: "rgba(238,238,242,0.45)", marginBottom: 4 }}>Current price</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 26, fontWeight: 600 }}>
                  {fmt$(stockPrices[tradeModal]?.price)}
                </span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: stockPrices[tradeModal]?.changePct >= 0 ? "#00c076" : "#ff3b5c" }}>
                  {fmtPct(stockPrices[tradeModal]?.changePct || 0)}
                </span>
              </div>
            </div>

            {/* Buy/Sell toggle */}
            <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 3, marginBottom: 16 }}>
              {["buy", "sell"].map(t => (
                <button key={t} onClick={() => { setTradeType(t); setConfirmPending(false); }} style={{
                  flex: 1, padding: "9px",
                  background: tradeType === t ? (t === "buy" ? "rgba(0,192,118,0.15)" : "rgba(255,59,92,0.15)") : "transparent",
                  border: tradeType === t ? `1px solid ${t === "buy" ? "rgba(0,192,118,0.3)" : "rgba(255,59,92,0.3)"}` : "1px solid transparent",
                  borderRadius: 8, cursor: "pointer",
                  fontSize: 13, fontWeight: tradeType === t ? 700 : 400,
                  color: tradeType === t ? (t === "buy" ? "#00c076" : "#ff3b5c") : "rgba(238,238,242,0.45)",
                  textTransform: "capitalize", fontFamily: "DM Sans, sans-serif",
                  transition: "all 0.2s",
                }}>{t}</button>
              ))}
            </div>

            {/* Shares input */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "rgba(238,238,242,0.45)", marginBottom: 8 }}>
                <span>Number of shares (whole numbers only)</span>
                {tradeType === "sell" && group?.holdings?.[tradeModal] && (
                  <span>Max: <strong style={{ color: "#eeeef2", fontFamily: "'IBM Plex Mono',monospace" }}>{group.holdings[tradeModal].shares}</strong></span>
                )}
              </div>
              <input type="number" value={tradeShares}
                onChange={e => { setTradeShares(e.target.value); setConfirmPending(false); }}
                min="1" step="1"
                max={tradeType === "sell" ? group?.holdings?.[tradeModal]?.shares : undefined}
                style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16 }} />
            </div>

            {/* Cost calculator */}
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: tradeType === "buy" ? 8 : 0 }}>
                <span style={{ color: "rgba(238,238,242,0.45)", fontSize: 13 }}>Estimated total</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 14 }}>{fmt$(totalCost)}</span>
              </div>
              {tradeType === "buy" && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "rgba(238,238,242,0.45)", fontSize: 13 }}>Remaining cash</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, color: remainingCash < 0 ? "#ff3b5c" : "#eeeef2" }}>
                    {fmt$(remainingCash)}
                  </span>
                </div>
              )}
            </div>

            {/* Citations + Analysis Report */}
            {tradeType === "buy" && !group?.holdings?.[tradeModal] && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "rgba(238,238,242,0.4)", marginBottom: 8, padding: "6px 10px", background: "rgba(91,120,255,0.08)", border: "1px solid rgba(91,120,255,0.15)", borderRadius: 6 }}>
                  Research required for first purchase of {tradeModal}
                </div>
                <div style={{ fontSize: 12, color: "rgba(238,238,242,0.5)", marginBottom: 5 }}>Website citations <span style={{ color: "#ff3b5c" }}>*</span></div>
                {citations.map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input placeholder="https://..." value={c}
                      onChange={e => setCitations(prev => prev.map((x, j) => j === i ? e.target.value : x))} />
                    {i === citations.length - 1 && (
                      <button onClick={() => setCitations(p => [...p, ""])} style={{
                        padding: "0 12px", background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                        cursor: "pointer", color: "#eeeef2", fontSize: 16, flexShrink: 0,
                      }}>+</button>
                    )}
                  </div>
                ))}
                <div style={{ fontSize: 12, color: "rgba(238,238,242,0.5)", marginTop: 10, marginBottom: 5 }}>Analysis report — explain your reasoning <span style={{ color: "#ff3b5c" }}>*</span></div>
                <textarea
                  placeholder={`Why are you buying ${tradeModal}? Describe your investment thesis, what you've researched, and why you believe this stock will perform well…`}
                  value={analysisReport}
                  onChange={e => setAnalysisReport(e.target.value)}
                  rows={4}
                  style={{ resize: "vertical", fontSize: 13, lineHeight: 1.55 }}
                />
              </div>
            )}

            {confirmPending ? (
              /* Confirmation screen */
              <div style={{ animation: "scaleIn 0.18s ease both" }}>
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "18px", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "rgba(238,238,242,0.45)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Confirm Order</div>
                  {[
                    { label: "Action", val: tradeType === "buy" ? "BUY" : "SELL", color: tradeType === "buy" ? "#00c076" : "#ff3b5c" },
                    { label: "Ticker", val: tradeModal, color: null },
                    { label: "Shares", val: parseInt(tradeShares, 10), color: null },
                    { label: "Price per share", val: fmt$(stockPrices[tradeModal]?.price), color: null },
                    { label: "Total", val: fmt$(parseInt(tradeShares, 10) * (stockPrices[tradeModal]?.price || 0)), color: "#eeeef2" },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 14 }}>
                      <span style={{ color: "rgba(238,238,242,0.45)" }}>{r.label}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: r.color || "#eeeef2" }}>{r.val}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setConfirmPending(false)} style={{
                    flex: 1, padding: "12px",
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600,
                    color: "rgba(238,238,242,0.7)", fontFamily: "DM Sans, sans-serif",
                  }}>Back</button>
                  <button onClick={confirmTrade} style={{
                    flex: 2, padding: "12px",
                    background: tradeType === "buy" ? "linear-gradient(135deg, #00c076, #00a566)" : "linear-gradient(135deg, #ff3b5c, #d42e4e)",
                    border: "none", borderRadius: 10, cursor: "pointer",
                    fontSize: 15, fontWeight: 700,
                    color: tradeType === "buy" ? "#0a2918" : "#fff",
                    fontFamily: "DM Sans, sans-serif",
                    boxShadow: tradeType === "buy" ? "0 4px 20px rgba(0,192,118,0.25)" : "0 4px 20px rgba(255,59,92,0.25)",
                  }}>Confirm {tradeType === "buy" ? "Buy" : "Sell"}</button>
                </div>
              </div>
            ) : (
              /* Submit button */
              <>
                <button onClick={handleTrade} style={{
                  width: "100%", padding: "13px",
                  background: tradeType === "buy"
                    ? "linear-gradient(135deg, #00c076, #00a566)"
                    : "linear-gradient(135deg, #ff3b5c, #d42e4e)",
                  border: "none", borderRadius: 10, cursor: "pointer",
                  fontSize: 15, fontWeight: 700,
                  color: tradeType === "buy" ? "#0a2918" : "#fff",
                  fontFamily: "DM Sans, sans-serif",
                  boxShadow: tradeType === "buy" ? "0 4px 20px rgba(0,192,118,0.25)" : "0 4px 20px rgba(255,59,92,0.25)",
                  transition: "opacity 0.15s",
                }}>
                  {tradeType === "buy" ? "Buy" : "Sell"} {parseInt(tradeShares, 10) || 0} share{parseInt(tradeShares, 10) !== 1 ? "s" : ""}
                </button>
                {!marketOpen && (
                  <div style={{ fontSize: 12, color: "#ff3b5c", textAlign: "center", marginTop: 10 }}>
                    Market is currently closed · 9:30am–4pm ET, Mon–Fri
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {!group ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <Card style={{ padding: "40px", textAlign: "center", maxWidth: 400 }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
            <h2 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Waiting for group assignment</h2>
            <p style={{ fontSize: 14, color: "rgba(238,238,242,0.45)" }}>
              Your teacher hasn't set up groups yet. Check back soon.
            </p>
          </Card>
        </div>
      ) : (
        <>
          {/* PORTFOLIO TAB */}
          {tab === "portfolio" && (
            <div className="sc-anim">
              {/* Hero section */}
              <div style={{
                background: `linear-gradient(180deg, ${totalGain >= 0 ? "rgba(0,192,118,0.06)" : "rgba(255,59,92,0.06)"} 0%, transparent 100%)`,
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                padding: "32px 32px 0",
              }}>
                <div style={{ marginBottom: 4, fontSize: 12, color: "rgba(238,238,242,0.4)", letterSpacing: "0.08em" }}>
                  {group.name.toUpperCase()} · TOTAL PORTFOLIO
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8 }}>
                  <span style={{
                    fontFamily: "'IBM Plex Mono',monospace",
                    fontSize: 48, fontWeight: 600, color: "#eeeef2",
                    lineHeight: 1.1,
                  }}><AnimatedNumber value={portfolioValue} formatter={fmt$} /></span>
                  <div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, fontWeight: 500, color: totalGain >= 0 ? "#00c076" : "#ff3b5c" }}>
                      <AnimatedNumber value={totalGain} formatter={fmtChg} />
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: totalGain >= 0 ? "#00c076" : "#ff3b5c" }}>
                      <AnimatedNumber value={totalGainPct} formatter={v => fmtPct(v) + " all time"} />
                    </div>
                  </div>
                </div>
                <PortfolioChart snapshots={group.snapshots} startingBalance={startingBalance} />
              </div>

              {/* Stat row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                {[
                  { label: "Cash", val: fmt$(group.cash) },
                  { label: "Invested", val: fmt$(holdingsValue) },
                  { label: "Positions", val: holdings.length },
                ].map((m, i) => (
                  <div key={m.label} style={{
                    padding: "16px 32px",
                    borderRight: i < 2 ? "1px solid rgba(255,255,255,0.05)" : "none",
                  }}>
                    <div style={{ fontSize: 11, color: "rgba(238,238,242,0.38)", letterSpacing: "0.06em", marginBottom: 4 }}>{m.label.toUpperCase()}</div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 18, fontWeight: 500 }}>{m.val}</div>
                  </div>
                ))}
              </div>

              {/* Allocation ring */}
              {holdings.length > 0 && (
                <div style={{ padding: "16px 32px 0" }}>
                  <Card style={{ padding: "20px 24px" }}>
                    <div style={{ fontSize: 10, color: "rgba(238,238,242,0.35)", letterSpacing: "0.08em", marginBottom: 14 }}>ALLOCATION</div>
                    <AllocationRing holdings={group.holdings || {}} cash={group.cash || 0} stockPrices={stockPrices} />
                  </Card>
                </div>
              )}

              {/* Holdings table */}
              <div style={{ padding: "24px 32px" }}>
                {holdings.length === 0 ? (
                  <Card style={{ padding: "40px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: "rgba(238,238,242,0.4)", marginBottom: 12 }}>No positions yet</div>
                    <button onClick={() => setTab("trade")} style={{
                      padding: "9px 20px", background: "rgba(0,192,118,0.12)",
                      border: "1px solid rgba(0,192,118,0.25)", borderRadius: 8,
                      cursor: "pointer", fontSize: 13, color: "#00c076", fontFamily: "DM Sans, sans-serif",
                    }}>Start trading →</button>
                  </Card>
                ) : (
                  <Card>
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "grid", gridTemplateColumns: "1fr 60px 90px 100px 100px 70px 110px", gap: 8, fontSize: 11, color: "rgba(238,238,242,0.35)", letterSpacing: "0.06em", fontWeight: 600 }}>
                      <span>STOCK</span><span style={{ textAlign: "right" }}>SHARES</span>
                      <span style={{ textAlign: "right" }}>AVG COST</span><span style={{ textAlign: "right" }}>PRICE</span>
                      <span style={{ textAlign: "right" }}>VALUE</span><span style={{ textAlign: "right" }}>P&L</span><span />
                    </div>
                    {holdings.map(([ticker, h]) => {
                      const price = stockPrices[ticker]?.price || 0;
                      const value = price * h.shares;
                      const cost = h.avgCost * h.shares;
                      const gain = value - cost;
                      const gainPct = cost ? (gain / cost) * 100 : 0;
                      const dayChange = stockPrices[ticker]?.changePct || 0;
                      return (
                        <div key={ticker} className="sc-stock-row" style={{ gridTemplateColumns: "1fr 60px 90px 100px 100px 70px 110px" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
                              <span
                                onClick={() => { setSelectedStock(ticker); setView(VIEWS.STOCK_DETAIL); }}
                                style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#7b96ff" }}>
                                {ticker}
                              </span>
                              <MiniChart data={stockHistory[ticker]?.["3M"]?.slice(-30)} positive={dayChange >= 0} />
                            </div>
                            <div style={{ fontSize: 12, color: "rgba(238,238,242,0.4)" }}>{stockPrices[ticker]?.name}</div>
                          </div>
                          <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14 }}>{h.shares}</span>
                          <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, color: "rgba(238,238,242,0.6)" }}>{fmt$(h.avgCost)}</span>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14 }}>{fmt$(price)}</div>
                            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: dayChange >= 0 ? "#00c076" : "#ff3b5c" }}>{fmtPct(dayChange)}</div>
                          </div>
                          <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 600 }}>{fmt$(value)}</span>
                          <div style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: gain >= 0 ? "#00c076" : "#ff3b5c" }}>
                            {fmtPct(gainPct)}
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button onClick={() => openTrade(ticker, "buy")} style={{
                              fontSize: 11, padding: "5px 12px",
                              background: "rgba(0,192,118,0.1)", border: "1px solid rgba(0,192,118,0.2)",
                              borderRadius: 6, cursor: "pointer", color: "#00c076", fontFamily: "DM Sans, sans-serif",
                              whiteSpace: "nowrap",
                            }}>Buy</button>
                            <button onClick={() => openTrade(ticker, "sell")} style={{
                              fontSize: 11, padding: "5px 12px",
                              background: "rgba(255,59,92,0.08)", border: "1px solid rgba(255,59,92,0.2)",
                              borderRadius: 6, cursor: "pointer", color: "#ff3b5c", fontFamily: "DM Sans, sans-serif",
                              whiteSpace: "nowrap",
                            }}>Sell</button>
                          </div>
                        </div>
                      );
                    })}
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* TRADE TAB */}
          {tab === "trade" && (
            <div className="sc-anim" style={{ padding: "28px 32px" }}>

              {/* Frozen banner */}
              {currentClass?.tradingFrozen && (
                <div style={{
                  marginBottom: 20, padding: "14px 18px",
                  background: "rgba(255,59,92,0.06)", border: "1px solid rgba(255,59,92,0.2)",
                  borderRadius: 10, display: "flex", alignItems: "center", gap: 12,
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>🔒</span>
                  <div>
                    <div style={{ fontWeight: 600, color: "#ff3b5c", fontSize: 14 }}>Trading is frozen</div>
                    <div style={{ fontSize: 12, color: "rgba(238,238,242,0.45)", marginTop: 2 }}>Your teacher has paused all trading. Check back later.</div>
                  </div>
                </div>
              )}

              {/* Search */}
              <div style={{ position: "relative", marginBottom: 20 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    placeholder="Search by ticker (AAPL) or company name (Apple Inc.)"
                    value={searchTicker}
                    onChange={e => setSearchTicker(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { setCompanySuggestions([]); handleSearch(); } }}
                    onBlur={() => setTimeout(() => setCompanySuggestions([]), 200)}
                    style={{ fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.04em", fontSize: 15 }}
                  />
                  <button onClick={() => handleSearch()} disabled={searchLoading} style={{
                    padding: "0 24px", background: searchLoading ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.09)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8, cursor: searchLoading ? "default" : "pointer", fontSize: 14, fontWeight: 600,
                    color: searchLoading ? "rgba(238,238,242,0.35)" : "#eeeef2", whiteSpace: "nowrap", fontFamily: "DM Sans, sans-serif",
                    flexShrink: 0,
                  }}>{searchLoading ? "Searching…" : "Search"}</button>
                </div>
                {/* Company suggestions dropdown */}
                {(companySuggestions.length > 0 || suggestionLoading) && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
                    background: "#1c1c23", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10, overflow: "hidden",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
                  }}>
                    {suggestionLoading && !companySuggestions.length && (
                      <div style={{ padding: "12px 16px", fontSize: 12, color: "rgba(238,238,242,0.35)" }}>Searching companies…</div>
                    )}
                    {companySuggestions.map((s, i) => (
                      <div key={s.ticker}
                        onMouseDown={() => {
                          suggestionClickRef.current = true;
                          setCompanySuggestions([]);
                          setSearchTicker(s.ticker);
                          handleSearch(s.ticker);
                        }}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "11px 16px", cursor: "pointer",
                          borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 13, color: "#7b96ff", flexShrink: 0 }}>{s.ticker}</span>
                          <span style={{ fontSize: 13, color: "rgba(238,238,242,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                        </div>
                        <span style={{ fontSize: 11, color: "rgba(238,238,242,0.25)", flexShrink: 0, marginLeft: 8 }}>{s.exchange}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {searchError && (
                <div style={{ fontSize: 13, color: "#ff3b5c", marginBottom: 14, padding: "8px 12px", background: "rgba(255,59,92,0.08)", border: "1px solid rgba(255,59,92,0.15)", borderRadius: 8 }}>
                  {searchError}
                </div>
              )}

              {/* Search result */}
              {searchResult && (
                <Card style={{ padding: "20px", marginBottom: 20, border: "1px solid rgba(255,255,255,0.1)" }} className="sc-card-anim">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 20 }}>{searchResult.ticker}</div>
                      <div style={{ fontSize: 13, color: "rgba(238,238,242,0.45)", marginTop: 2 }}>{searchResult.name}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 24, fontWeight: 600 }}>{fmt$(searchResult.price)}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: searchResult.changePct >= 0 ? "#00c076" : "#ff3b5c", marginTop: 2 }}>{fmtPct(searchResult.changePct || 0)}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => openTrade(searchResult.ticker, "buy")} style={{
                      flex: 1, padding: "11px",
                      background: "linear-gradient(135deg, #00c076, #00a566)",
                      border: "none", borderRadius: 9, cursor: "pointer",
                      fontSize: 14, fontWeight: 700, color: "#0a2918", fontFamily: "DM Sans, sans-serif",
                    }}>Buy</button>
                    {group?.holdings?.[searchResult.ticker] && (
                      <button onClick={() => openTrade(searchResult.ticker, "sell")} style={{
                        flex: 1, padding: "11px",
                        background: "rgba(255,59,92,0.1)", border: "1px solid rgba(255,59,92,0.3)",
                        borderRadius: 9, cursor: "pointer",
                        fontSize: 14, fontWeight: 700, color: "#ff3b5c", fontFamily: "DM Sans, sans-serif",
                      }}>Sell</button>
                    )}
                  </div>
                </Card>
              )}

              {/* Popular stocks */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: "rgba(238,238,242,0.35)", letterSpacing: "0.08em", marginBottom: 10 }}>QUICK SELECT</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.keys(POPULAR_STOCKS).map(t => {
                    const s = stockPrices[t];
                    return (
                      <button key={t} className="sc-ticker-pill"
                        onClick={() => { setSearchTicker(t); handleSearch(t); }}>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 12, color: "#eeeef2" }}>{t}</span>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: s ? (s.changePct >= 0 ? "#00c076" : "#ff3b5c") : "rgba(238,238,242,0.3)" }}>
                          {s ? fmtPct(s.changePct) : "···"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Popular stocks list — shows cached prices when available */}
              <div>
                <div style={{ fontSize: 11, color: "rgba(238,238,242,0.35)", letterSpacing: "0.08em", marginBottom: 12 }}>POPULAR STOCKS</div>
                <Card>
                  {Object.entries(POPULAR_STOCKS).map(([t, name]) => {
                    const s = stockPrices[t];
                    return (
                      <div key={t} className="sc-stock-row"
                        style={{ gridTemplateColumns: "1fr 80px 80px 80px", cursor: "pointer" }}
                        onClick={() => { setSelectedStock(t); setView(VIEWS.STOCK_DETAIL); }}>
                        <div>
                          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 14 }}>{t}</span>
                          <span style={{ fontSize: 12, color: "rgba(238,238,242,0.4)", marginLeft: 10 }}>{name}</span>
                        </div>
                        <MiniChart data={stockHistory[t]?.["3M"]?.slice(-30)} positive={s ? s.changePct >= 0 : true} />
                        <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14 }}>
                          {s ? fmt$(s.price) : "—"}
                        </span>
                        <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: s ? (s.changePct >= 0 ? "#00c076" : "#ff3b5c") : "rgba(238,238,242,0.3)" }}>
                          {s ? fmtPct(s.changePct) : "search"}
                        </span>
                      </div>
                    );
                  })}
                </Card>
              </div>
            </div>
          )}

          {/* HISTORY TAB */}
          {tab === "history" && (
            <div className="sc-anim" style={{ padding: "28px 32px" }}>
              <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Activity</h2>
              {!group.transactions?.length ? (
                <Card style={{ padding: "40px", textAlign: "center" }}>
                  <div style={{ fontSize: 13, color: "rgba(238,238,242,0.4)" }}>No transactions yet. Make your first trade.</div>
                </Card>
              ) : (
                <Card>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "grid", gridTemplateColumns: "1fr 60px 80px 100px 120px", gap: 8, fontSize: 11, color: "rgba(238,238,242,0.35)", letterSpacing: "0.06em", fontWeight: 600 }}>
                    <span>STOCK</span><span>TYPE</span><span style={{ textAlign: "right" }}>SHARES</span>
                    <span style={{ textAlign: "right" }}>PRICE</span><span style={{ textAlign: "right" }}>TOTAL</span>
                  </div>
                  {group.transactions.map(tx => (
                    <div key={tx.id} className="sc-stock-row" style={{ gridTemplateColumns: "1fr 60px 80px 100px 120px" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 14 }}>{tx.ticker}</span>
                          {tx.autoSell && <span style={{ fontSize: 10, color: "#f0b429", background: "rgba(240,180,41,0.1)", border: "1px solid rgba(240,180,41,0.2)", borderRadius: 4, padding: "1px 5px" }}>AUTO</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(238,238,242,0.38)", marginTop: 2, fontFamily: "'IBM Plex Mono',monospace" }}>
                          {new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                          {" · "}
                          {new Date(tx.date).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true })} PST
                        </div>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: tx.type === "buy" ? "#00c076" : "#ff3b5c", textTransform: "uppercase", fontFamily: "'IBM Plex Mono',monospace" }}>
                        {tx.type}
                      </span>
                      <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14 }}>{tx.shares}</span>
                      <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, color: "rgba(238,238,242,0.6)" }}>{fmt$(tx.price)}</span>
                      <span style={{ textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 600 }}>{fmt$(tx.total)}</span>
                    </div>
                  ))}
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

// ─── STOCK DETAIL ─────────────────────────────────────────────────────────────
function StockDetail({ ticker, stockPrices, currentGroup, currentClass, executeTrade, setView, userType, notify, currentUser, onLogout, stockHistory, cacheHistory, addStockPrice }) {
  const [range, setRange] = useState("3M");
  const [tradeType, setTradeType] = useState("buy");
  const [tradeShares, setTradeShares] = useState(1);
  const [tradeCitations, setTradeCitations] = useState([""]);
  const [tradeAnalysisReport, setTradeAnalysisReport] = useState("");
  const [confirmPending, setConfirmPending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const stock = stockPrices[ticker];
  const holding = currentGroup?.holdings?.[ticker];

  // Fetch history when ticker or range changes (per-range cache)
  useEffect(() => {
    if (!ticker) return;
    const cached = stockHistory?.[ticker]?.[range];
    if (cached && cached.length >= 2) return; // already loaded for this range
    setHistoryLoading(true);
    setHistoryError("");
    getHistory(ticker, range)
      .then(hist => { cacheHistory(ticker, range, hist); })
      .catch(err => { setHistoryError(err.message || "Could not load chart data"); })
      .finally(() => setHistoryLoading(false));
  }, [ticker, range]); // eslint-disable-line react-hooks/exhaustive-deps

  // If quote not yet in stockPrices (edge case), fetch it
  useEffect(() => {
    if (!ticker || stock) return;
    getQuote(ticker).then(q => addStockPrice(ticker, q)).catch(() => {});
  }, [ticker, stock]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredHistory = stockHistory?.[ticker]?.[range] || [];
  const existingCitations = currentGroup?.citations?.[ticker] || [];

  const isMarketOpen = () => {
    if (currentClass?.marketOverride) return true;
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = et.getDay(), h = et.getHours(), m = et.getMinutes();
    return day >= 1 && day <= 5 && h * 60 + m >= 570 && h * 60 + m < 960;
  };

  const marketOpen = isMarketOpen();

  const handleTrade = () => {
    if (!marketOpen) { notify("Market is closed (9:30am–4pm ET, Mon–Fri)", "error"); return; }
    const shares = parseInt(tradeShares, 10);
    if (!shares || shares < 1) { notify("Shares must be a whole number (minimum 1)", "error"); return; }
    const isFirstBuy = tradeType === "buy" && !holding;
    if (isFirstBuy) {
      const validCitations = tradeCitations.filter(c => c.trim());
      if (validCitations.length === 0) { notify("At least one citation URL is required for a new investment", "error"); return; }
      if (!tradeAnalysisReport.trim()) { notify("An analysis report is required for your first purchase of this stock", "error"); return; }
    }
    setConfirmPending(true);
  };

  const confirmTrade = () => {
    executeTrade(currentGroup.id, ticker, parseInt(tradeShares, 10), tradeType, tradeType === "buy" ? tradeCitations.filter(c => c.trim()) : [], tradeType === "buy" ? tradeAnalysisReport : "");
    notify(tradeType === "buy" ? `Bought ${parseInt(tradeShares, 10)} share(s) of ${ticker}` : `Sold ${parseInt(tradeShares, 10)} share(s) of ${ticker}`);
    setConfirmPending(false);
    setTradeShares(1);
    setTradeAnalysisReport("");
  };

  const totalCost = tradeShares * (stock?.price || 0);
  const remainingCash = (currentGroup?.cash || 0) - totalCost;

  const backView = userType === "teacher" ? VIEWS.TEACHER_DASH : VIEWS.STUDENT_DASH;

  const navItems = userType === "teacher"
    ? [{ id: "overview", label: "Overview" }, { id: "groups", label: "Groups" }, { id: "leaderboard", label: "Leaderboard" }, { id: "settings", label: "Settings" }]
    : [{ id: "portfolio", label: "Portfolio" }, { id: "trade", label: "Trade" }, { id: "history", label: "Activity" }];

  const livePortfolioValue = currentGroup
    ? parseFloat((currentGroup.cash + Object.entries(currentGroup.holdings || {})
        .reduce((sum, [t, h]) => sum + (stockPrices[t]?.price || 0) * h.shares, 0)).toFixed(2))
    : undefined;

  const sidebar = (
    <Sidebar
      items={navItems}
      active={null}
      setActive={() => setView(backView)}
      user={currentUser}
      subtitle={currentGroup?.name || (userType === "teacher" ? "Teacher" : "")}
      marketOpen={isMarketOpen()}
      onLogout={onLogout}
      cash={userType !== "teacher" ? (currentGroup?.cash ?? 0) : undefined}
      portfolioValue={userType !== "teacher" ? livePortfolioValue : undefined}
    />
  );

  if (!stock) {
    return (
      <Layout sidebar={sidebar}>
        <div style={{ padding: "40px", fontSize: 14, color: "rgba(238,238,242,0.5)" }}>
          Loading quote for {ticker}…
        </div>
      </Layout>
    );
  }

  const positive = stock.changePct >= 0;
  const holdingGain = holding ? (stock.price - holding.avgCost) * holding.shares : 0;
  const holdingGainPct = holding ? ((stock.price - holding.avgCost) / holding.avgCost) * 100 : 0;

  return (
    <Layout sidebar={sidebar}>
      {/* Header bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "16px 32px",
        borderBottom: "1px solid rgba(255,255,255,0.055)",
        background: "#0d0d0f",
        position: "sticky", top: 0, zIndex: 5,
      }}>
        <button onClick={() => setView(backView)} style={{
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, width: 34, height: 34,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", fontSize: 16, color: "rgba(238,238,242,0.6)",
        }}>←</button>
        <div>
          <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 18 }}>{ticker}</span>
          <span style={{ fontSize: 13, color: "rgba(238,238,242,0.42)", marginLeft: 10 }}>{stock.name}</span>
        </div>
        {holding && (
          <div style={{
            marginLeft: "auto", padding: "5px 14px",
            background: "rgba(91,120,255,0.1)", border: "1px solid rgba(91,120,255,0.2)",
            borderRadius: 20, fontSize: 12, color: "#7b96ff",
            fontFamily: "'IBM Plex Mono',monospace",
          }}>
            {holding.shares} shares held
          </div>
        )}
      </div>

      <div style={{ padding: "28px 32px", maxWidth: 960 }}>
        {/* Price hero */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 4 }}>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 44, fontWeight: 600, lineHeight: 1.1 }}>
              {fmt$(stock.price)}
            </span>
            <div>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, color: positive ? "#00c076" : "#ff3b5c" }}>
                {fmtChg(stock.change)}
              </span>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, color: positive ? "#00c076" : "#ff3b5c", marginLeft: 8 }}>
                ({fmtPct(stock.changePct)})
              </span>
              <span style={{ fontSize: 12, color: "rgba(238,238,242,0.35)", marginLeft: 8 }}>today</span>
            </div>
          </div>
        </div>

        {/* Chart card */}
        <Card style={{ padding: "20px", marginBottom: 16 }}>
          {/* Range selector */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {["1D", "1W", "1M", "3M", "6M", "1Y"].map(r => (
              <button key={r} onClick={() => setRange(r)} style={{
                padding: "5px 14px",
                background: range === r ? "rgba(255,255,255,0.09)" : "transparent",
                border: `1px solid ${range === r ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 20, cursor: "pointer",
                fontSize: 12, fontWeight: range === r ? 700 : 400,
                color: range === r ? "#eeeef2" : "rgba(238,238,242,0.4)",
                fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.04em",
              }}>{r}</button>
            ))}
          </div>
          {historyLoading ? (
            <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(238,238,242,0.35)", fontSize: 13 }}>
              Loading chart…
            </div>
          ) : historyError ? (
            <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#ff3b5c", fontSize: 13 }}>
              {historyError}
            </div>
          ) : (
            <PriceChart data={filteredHistory} purchasePrice={holding?.avgCost} range={range} />
          )}
        </Card>

        {/* Position & citations */}
        {(() => {
          const existingAnalysis = currentGroup?.analyses?.[ticker] || "";
          const hasResearch = existingCitations.length > 0 || existingAnalysis;
          return (
            <div style={{ display: "grid", gridTemplateColumns: holding && hasResearch ? "1fr 1fr" : "1fr", gap: 16 }}>
              {holding && (
                <Card style={{ padding: "20px" }}>
                  <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Your Position</div>
                  {[
                    { label: "Shares owned", val: holding.shares, color: null },
                    { label: "Avg cost", val: fmt$(holding.avgCost), color: null },
                    { label: "Current value", val: fmt$(stock.price * holding.shares), color: null },
                    { label: "Total gain/loss", val: fmtChg(holdingGain), color: holdingGain >= 0 ? "#00c076" : "#ff3b5c" },
                    { label: "Return", val: fmtPct(holdingGainPct), color: holdingGainPct >= 0 ? "#00c076" : "#ff3b5c" },
                  ].map(r => (
                    <div key={r.label} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 14,
                    }}>
                      <span style={{ color: "rgba(238,238,242,0.45)" }}>{r.label}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: r.color || "#eeeef2" }}>{r.val}</span>
                    </div>
                  ))}
                </Card>
              )}

              {hasResearch && (
                <Card style={{ padding: "20px" }}>
                  <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Research &amp; Analysis</div>
                  {existingAnalysis && (
                    <div style={{ marginBottom: existingCitations.length > 0 ? 16 : 0 }}>
                      <div style={{ fontSize: 10, color: "rgba(238,238,242,0.35)", letterSpacing: "0.08em", marginBottom: 8 }}>INVESTMENT ANALYSIS</div>
                      <div style={{
                        fontSize: 13, color: "rgba(238,238,242,0.75)", lineHeight: 1.65,
                        padding: "12px 14px",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 8,
                        whiteSpace: "pre-wrap",
                      }}>{existingAnalysis}</div>
                    </div>
                  )}
                  {existingCitations.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: "rgba(238,238,242,0.35)", letterSpacing: "0.08em", marginBottom: 8 }}>SOURCES</div>
                      {existingCitations.map((c, i) => (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <a href={c} target="_blank" rel="noreferrer" style={{
                            fontSize: 13, color: "#7b96ff",
                            wordBreak: "break-all", lineHeight: 1.5,
                            display: "block",
                            padding: "8px 10px",
                            background: "rgba(91,120,255,0.06)",
                            border: "1px solid rgba(91,120,255,0.12)",
                            borderRadius: 7,
                          }}>{c}</a>
                        </div>
                      ))}
                    </>
                  )}
                </Card>
              )}
            </div>
          );
        })()}

        {/* Trade panel — students only */}
        {userType !== "teacher" && currentGroup && (
          <Card style={{ padding: "24px", marginTop: 16 }}>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
              Place Order
              {!marketOpen && (
                <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 400, color: "#ff3b5c", fontFamily: "DM Sans, sans-serif" }}>
                  Market closed · {currentClass?.marketOverride ? "" : "9:30am–4pm ET Mon–Fri"}
                </span>
              )}
            </div>

            {/* Buy/Sell toggle */}
            <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 3, marginBottom: 16 }}>
              {["buy", "sell"].map(t => (
                <button key={t} onClick={() => { setTradeType(t); setConfirmPending(false); }} style={{
                  flex: 1, padding: "9px",
                  background: tradeType === t ? (t === "buy" ? "rgba(0,192,118,0.15)" : "rgba(255,59,92,0.15)") : "transparent",
                  border: tradeType === t ? `1px solid ${t === "buy" ? "rgba(0,192,118,0.3)" : "rgba(255,59,92,0.3)"}` : "1px solid transparent",
                  borderRadius: 8, cursor: "pointer",
                  fontSize: 13, fontWeight: tradeType === t ? 700 : 400,
                  color: tradeType === t ? (t === "buy" ? "#00c076" : "#ff3b5c") : "rgba(238,238,242,0.45)",
                  textTransform: "capitalize", fontFamily: "DM Sans, sans-serif",
                  transition: "all 0.2s",
                }}>{t}</button>
              ))}
            </div>

            {/* Shares input */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "rgba(238,238,242,0.45)", marginBottom: 8 }}>
                <span>Number of shares (whole numbers only)</span>
                {tradeType === "sell" && holding && (
                  <span>Max: <strong style={{ color: "#eeeef2", fontFamily: "'IBM Plex Mono',monospace" }}>{holding.shares}</strong></span>
                )}
                {tradeType === "buy" && (
                  <span>Cash: <strong style={{ color: "#eeeef2", fontFamily: "'IBM Plex Mono',monospace" }}>{fmt$(currentGroup.cash)}</strong></span>
                )}
              </div>
              <input type="number" value={tradeShares}
                onChange={e => { setTradeShares(e.target.value); setConfirmPending(false); }}
                min="1" step="1"
                max={tradeType === "sell" ? holding?.shares : undefined}
                style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16 }} />
            </div>

            {/* Cost summary */}
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: tradeType === "buy" ? 8 : 0 }}>
                <span style={{ color: "rgba(238,238,242,0.45)", fontSize: 13 }}>Estimated total</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 14 }}>{fmt$(totalCost)}</span>
              </div>
              {tradeType === "buy" && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "rgba(238,238,242,0.45)", fontSize: 13 }}>Remaining cash</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, color: remainingCash < 0 ? "#ff3b5c" : "#eeeef2" }}>
                    {fmt$(remainingCash)}
                  </span>
                </div>
              )}
            </div>

            {/* Citations + Analysis Report for first buy */}
            {tradeType === "buy" && !holding && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "rgba(238,238,242,0.4)", marginBottom: 8, padding: "6px 10px", background: "rgba(91,120,255,0.08)", border: "1px solid rgba(91,120,255,0.15)", borderRadius: 6 }}>
                  Research required for first purchase of {ticker}
                </div>
                <div style={{ fontSize: 12, color: "rgba(238,238,242,0.5)", marginBottom: 5 }}>Website citations <span style={{ color: "#ff3b5c" }}>*</span></div>
                {tradeCitations.map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input placeholder="https://..." value={c}
                      onChange={e => setTradeCitations(prev => prev.map((x, j) => j === i ? e.target.value : x))} />
                    {i === tradeCitations.length - 1 && (
                      <button onClick={() => setTradeCitations(p => [...p, ""])} style={{
                        padding: "0 12px", background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                        cursor: "pointer", color: "#eeeef2", fontSize: 16, flexShrink: 0,
                      }}>+</button>
                    )}
                  </div>
                ))}
                <div style={{ fontSize: 12, color: "rgba(238,238,242,0.5)", marginTop: 10, marginBottom: 5 }}>Analysis report — explain your reasoning <span style={{ color: "#ff3b5c" }}>*</span></div>
                <textarea
                  placeholder={`Why are you buying ${ticker}? Describe your investment thesis, what you've researched, and why you believe this stock will perform well…`}
                  value={tradeAnalysisReport}
                  onChange={e => setTradeAnalysisReport(e.target.value)}
                  rows={4}
                  style={{ resize: "vertical", fontSize: 13, lineHeight: 1.55 }}
                />
              </div>
            )}

            {confirmPending ? (
              <div style={{ animation: "scaleIn 0.18s ease both" }}>
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "18px", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "rgba(238,238,242,0.45)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Confirm Order</div>
                  {[
                    { label: "Action", val: tradeType === "buy" ? "BUY" : "SELL", color: tradeType === "buy" ? "#00c076" : "#ff3b5c" },
                    { label: "Ticker", val: ticker, color: null },
                    { label: "Shares", val: parseInt(tradeShares, 10), color: null },
                    { label: "Price per share", val: fmt$(stock?.price), color: null },
                    { label: "Total", val: fmt$(parseInt(tradeShares, 10) * (stock?.price || 0)), color: "#eeeef2" },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 14 }}>
                      <span style={{ color: "rgba(238,238,242,0.45)" }}>{r.label}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: r.color || "#eeeef2" }}>{r.val}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setConfirmPending(false)} style={{
                    flex: 1, padding: "12px",
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600,
                    color: "rgba(238,238,242,0.7)", fontFamily: "DM Sans, sans-serif",
                  }}>Back</button>
                  <button onClick={confirmTrade} style={{
                    flex: 2, padding: "12px",
                    background: tradeType === "buy" ? "linear-gradient(135deg, #00c076, #00a566)" : "linear-gradient(135deg, #ff3b5c, #d42e4e)",
                    border: "none", borderRadius: 10, cursor: "pointer",
                    fontSize: 15, fontWeight: 700,
                    color: tradeType === "buy" ? "#0a2918" : "#fff",
                    fontFamily: "DM Sans, sans-serif",
                    boxShadow: tradeType === "buy" ? "0 4px 20px rgba(0,192,118,0.25)" : "0 4px 20px rgba(255,59,92,0.25)",
                  }}>Confirm {tradeType === "buy" ? "Buy" : "Sell"}</button>
                </div>
              </div>
            ) : (
              <button onClick={handleTrade} disabled={!marketOpen} style={{
                width: "100%", padding: "13px",
                background: !marketOpen ? "rgba(255,255,255,0.06)"
                  : tradeType === "buy" ? "linear-gradient(135deg, #00c076, #00a566)"
                  : "linear-gradient(135deg, #ff3b5c, #d42e4e)",
                border: "none", borderRadius: 10,
                cursor: marketOpen ? "pointer" : "not-allowed",
                fontSize: 15, fontWeight: 700,
                color: !marketOpen ? "rgba(238,238,242,0.3)"
                  : tradeType === "buy" ? "#0a2918" : "#fff",
                fontFamily: "DM Sans, sans-serif",
                boxShadow: marketOpen
                  ? (tradeType === "buy" ? "0 4px 20px rgba(0,192,118,0.25)" : "0 4px 20px rgba(255,59,92,0.25)")
                  : "none",
                transition: "opacity 0.15s",
              }}>
                {marketOpen
                  ? `${tradeType === "buy" ? "Buy" : "Sell"} ${parseInt(tradeShares, 10) || 0} share${parseInt(tradeShares, 10) !== 1 ? "s" : ""}`
                  : "Market closed"}
              </button>
            )}
          </Card>
        )}
      </div>
    </Layout>
  );
}
