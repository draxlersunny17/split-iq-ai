import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  Bot,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  FilePlus2,
  FileSpreadsheet,
  Globe,
  Home,
  MessageCircle,
  Moon,
  Plus,
  QrCode,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Split,
  Sun,
  Trash2,
  Upload,
  Users,
  Wallet,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import * as XLSX from "xlsx";
import { emptyBill, splitwiserActions } from "./store";

/* ─────────────────── utils ─────────────────── */

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value) {
  if (!value) return "";
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return "";
}

function formatMoney(value, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    maximumFractionDigits: 2,
  }).format(normalizeNumber(value));
}

function splitAmount(amount, ids) {
  if (!ids.length) return 0;
  return normalizeNumber(amount) / ids.length;
}

/* ─────────────────── Smart Item Auto-Tagger ─────────────────── */
const TAG_RULES = [
  [
    "🍺",
    /beer|alcohol|wine|whisky|whiskey|vodka|rum|gin|cocktail|lager|ale|spirits|brandy|champagne|mojito|shot|pint|draught/i,
  ],
  [
    "☕",
    /coffee|espresso|latte|cappuccino|americano|mocha|\btea\b|chai|macchiato|cold.?brew|frappe/i,
  ],
  [
    "🍰",
    /dessert|cake|ice.?cream|waffle|brownie|pudding|mousse|pastry|cookie|pie|cheesecake|gelato|sorbet|sundae|tiramisu/i,
  ],
  [
    "🥤",
    /juice|soda|\bwater\b|cola|pepsi|sprite|lemonade|smoothie|milkshake|soft.?drink|mocktail|lassi|nimbu/i,
  ],
];

function getItemTag(name) {
  for (const [emoji, re] of TAG_RULES) {
    if (re.test(name)) return emoji;
  }
  return "🍽️";
}

/* ─────────────────── Bill Anomaly Detector ─────────────────── */
function detectAnomalies(bill) {
  const anomalies = [];
  const subtotal = bill.items.reduce((s, i) => s + normalizeNumber(i.price), 0);
  if (subtotal <= 0) return anomalies;

  const scPct = (normalizeNumber(bill.serviceCharge) / subtotal) * 100;
  if (scPct > 15)
    anomalies.push({
      type: "warn",
      message: `Service charge is ${scPct.toFixed(1)}% — unusually high (typical ≤12.5%)`,
    });

  const taxPct = (normalizeNumber(bill.tax) / subtotal) * 100;
  if (taxPct > 20)
    anomalies.push({
      type: "warn",
      message: `Tax rate is ${taxPct.toFixed(1)}% — above typical GST rates (≤18%)`,
    });

  const expected =
    subtotal +
    normalizeNumber(bill.tax) +
    normalizeNumber(bill.serviceCharge) -
    normalizeNumber(bill.discount);
  const stated = normalizeNumber(bill.total);
  if (stated > 0 && Math.abs(expected - stated) / stated > 0.05)
    anomalies.push({
      type: "error",
      message: `Total mismatch: items sum to ${formatMoney(expected, bill.currency)}, bill says ${formatMoney(stated, bill.currency)}`,
    });

  const dominant = bill.items
    .slice()
    .sort((a, b) => normalizeNumber(b.price) - normalizeNumber(a.price))[0];
  if (dominant && normalizeNumber(dominant.price) / subtotal > 0.4)
    anomalies.push({
      type: "info",
      message: `"${dominant.name}" makes up ${((normalizeNumber(dominant.price) / subtotal) * 100).toFixed(0)}% of the bill subtotal`,
    });

  return anomalies;
}

/* ─────────────────── Duplicate Item Detector ─────────────────── */
function strSimilarity(a, b) {
  const s = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!s.length || !t.length) return 0;
  if (s === t) return 1;
  const longer = s.length >= t.length ? s : t;
  const shorter = s.length < t.length ? s : t;
  if (shorter.length < 3) return 0;
  if (longer.includes(shorter) && shorter.length / longer.length > 0.75)
    return 1;
  const dp = Array.from({ length: shorter.length + 1 }, (_, i) => i);
  for (let i = 1; i <= longer.length; i++) {
    let prev = i;
    for (let j = 1; j <= shorter.length; j++) {
      const cur =
        longer[i - 1] === shorter[j - 1]
          ? dp[j - 1]
          : 1 + Math.min(dp[j - 1], dp[j], prev);
      dp[j - 1] = prev;
      prev = cur;
    }
    dp[shorter.length] = prev;
  }
  return (longer.length - dp[shorter.length]) / longer.length;
}

function findDuplicates(items) {
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (strSimilarity(items[i].name, items[j].name) > 0.82)
        pairs.push([items[i].name, items[j].name]);
    }
  }
  return pairs;
}

function sanitizeParsedBill(parsed) {
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const subtotal = normalizeNumber(
    parsed.subtotal ||
      items.reduce((sum, item) => sum + normalizeNumber(item.price), 0),
  );
  const tax = normalizeNumber(parsed.tax);
  const serviceCharge = normalizeNumber(
    parsed.serviceCharge || parsed.service_charge,
  );
  const discount = normalizeNumber(parsed.discount);
  const total = normalizeNumber(
    parsed.total || subtotal + tax + serviceCharge - discount,
  );
  return {
    merchant: String(parsed.merchant || parsed.vendor || ""),
    date: normalizeDate(parsed.date),
    currency: String(parsed.currency || "INR").toUpperCase(),
    subtotal,
    tax,
    serviceCharge,
    discount,
    total,
    items: items.map((item) => ({
      id: crypto.randomUUID(),
      name: String(item.name || item.description || "Bill item"),
      quantity: normalizeNumber(item.quantity || 1) || 1,
      price: normalizeNumber(item.price || item.amount || item.total),
      assignedTo: [],
    })),
  };
}

function calculateSplit(bill, people) {
  const personTotals = Object.fromEntries(people.map((p) => [p.id, 0]));
  const subtotal = bill.items.reduce(
    (sum, item) => sum + normalizeNumber(item.price),
    0,
  );
  const extras =
    normalizeNumber(bill.tax) +
    normalizeNumber(bill.serviceCharge) -
    normalizeNumber(bill.discount);
  bill.items.forEach((item) => {
    const assignees = item.assignedTo?.length
      ? item.assignedTo
      : people.map((p) => p.id);
    const baseShare = splitAmount(item.price, assignees);
    const itemRatio = subtotal > 0 ? normalizeNumber(item.price) / subtotal : 0;
    const extraShare = splitAmount(extras * itemRatio, assignees);
    assignees.forEach((id) => {
      personTotals[id] =
        normalizeNumber(personTotals[id]) + baseShare + extraShare;
    });
  });
  return people.map((p) => ({
    ...p,
    total: personTotals[p.id] || 0,
    items: bill.items.filter(
      (item) => !item.assignedTo?.length || item.assignedTo.includes(p.id),
    ),
  }));
}

/* debt simplification: minimise transactions via net-balance model
   paymentAmounts = { [personId]: amountTheyPaid } — covers all modes:
   single payer, multiple payers, partial payments, everyone-paid-own */
function simplifyDebts(split, paymentAmounts) {
  if (!split.length || !Object.keys(paymentAmounts).length) return [];

  // net = paid - owed.  positive → creditor (is owed), negative → debtor (owes)
  const balances = split.map((p) => ({
    id: p.id,
    name: p.name,
    net: normalizeNumber(paymentAmounts[p.id] || 0) - normalizeNumber(p.total),
  }));

  const creditors = balances
    .filter((b) => b.net > 0.005)
    .map((b) => ({ ...b }));
  const debtors = balances
    .filter((b) => b.net < -0.005)
    .map((b) => ({ ...b, net: -b.net }));

  const transactions = [];
  const creds = [...creditors];
  const debts = [...debtors];

  while (creds.length && debts.length) {
    const c = creds[0];
    const d = debts[0];
    const amount = Math.min(c.net, d.net);
    transactions.push({ from: d, to: c, amount });
    c.net -= amount;
    d.net -= amount;
    if (c.net < 0.005) creds.shift();
    if (d.net < 0.005) debts.shift();
  }
  return transactions;
}

/* ─────────────────── API ─────────────────── */

async function analyzeBillWithAi({ file }) {
  const reader = new FileReader();
  const fileData = await new Promise((res, rej) => {
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
  const response = await fetch("/api/analyze-bill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileData, fileType: file.type }),
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const jsonText = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return sanitizeParsedBill(JSON.parse(jsonText));
}

async function fetchBillInsights({ bill, people }) {
  const response = await fetch("/api/bill-insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bill, people }),
  });
  if (!response.ok) throw new Error("Insights unavailable");
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const jsonText = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(jsonText);
}

async function fetchSmartSplit({ items, people }) {
  const taggedItems = items.map((i) => ({
    id: i.id,
    name: i.name,
    price: i.price,
    tag: getItemTag(i.name),
  }));
  const response = await fetch("/api/smart-split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: taggedItems, people }),
  });
  if (!response.ok) throw new Error("Smart split unavailable");
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const jsonText = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(jsonText);
}

async function generateShareMessage({
  bill,
  people,
  split,
  transactions,
  paymentAmounts,
}) {
  const response = await fetch("/api/share-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bill, people, split, transactions, paymentAmounts }),
  });
  if (!response.ok) throw new Error("Message generation failed");
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

/* ─────────────────── App ─────────────────── */

function App() {
  const dispatch = useDispatch();
  const { view, people, bill, status, insightLoading, insight } = useSelector(
    (state) => state.splitwiser,
  );
  const split = useMemo(() => calculateSplit(bill, people), [bill, people]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [animKey, setAnimKey] = useState(view);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [qrTarget, setQrTarget] = useState(null);

  const [dark, setDark] = useState(() => {
    try {
      return (
        localStorage.getItem("theme") === "dark" ||
        (!localStorage.getItem("theme") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  function toggleTheme() {
    setDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("theme", next ? "dark" : "light");
      } catch {}
      return next;
    });
  }

  function setView(nextView) {
    setAnimKey(nextView);
    dispatch(splitwiserActions.setView(nextView));
  }

  async function handleAnalyze(file) {
    if (!file) return;
    dispatch(
      splitwiserActions.setStatus({
        kind: "loading",
        message: "Analyzing bill with AI…",
      }),
    );
    try {
      const parsed = await analyzeBillWithAi({ file });
      dispatch(
        splitwiserActions.setBill(
          parsed.items.length ? parsed : { ...parsed, items: emptyBill.items },
        ),
      );
      setView("split");
      dispatch(
        splitwiserActions.setStatus({
          kind: "success",
          message: "Bill parsed — assign items and review.",
        }),
      );
      dispatch(splitwiserActions.setInsight(null));
      dispatch(splitwiserActions.setInsightLoading(true));
      fetchBillInsights({ bill: parsed, people })
        .then((insight) => dispatch(splitwiserActions.setInsight(insight)))
        .catch(() => {})
        .finally(() => dispatch(splitwiserActions.setInsightLoading(false)));
    } catch (error) {
      dispatch(
        splitwiserActions.setStatus({ kind: "error", message: error.message }),
      );
    }
  }

  async function handleMerge(files) {
    if (!files.length) return;
    dispatch(
      splitwiserActions.setStatus({
        kind: "loading",
        message: `Analyzing ${files.length} bills with AI…`,
      }),
    );
    try {
      const results = await Promise.all(
        files.map((f) => analyzeBillWithAi({ file: f })),
      );
      const merged = {
        merchant:
          results
            .map((r) => r.merchant)
            .filter(Boolean)
            .join(" + ") || "",
        date: results[0]?.date || "",
        currency: results[0]?.currency || "INR",
        subtotal: results.reduce((s, r) => s + r.subtotal, 0),
        tax: results.reduce((s, r) => s + r.tax, 0),
        serviceCharge: results.reduce((s, r) => s + r.serviceCharge, 0),
        discount: results.reduce((s, r) => s + r.discount, 0),
        total: results.reduce((s, r) => s + r.total, 0),
        items: results.flatMap((r) => r.items),
      };
      dispatch(splitwiserActions.setBill(merged));
      setView("split");
      dispatch(
        splitwiserActions.setStatus({
          kind: "success",
          message: `Merged ${files.length} bills — ${merged.items.length} items total.`,
        }),
      );
      dispatch(splitwiserActions.setInsight(null));
      dispatch(splitwiserActions.setInsightLoading(true));
      fetchBillInsights({ bill: merged, people })
        .then((insight) => dispatch(splitwiserActions.setInsight(insight)))
        .catch(() => {})
        .finally(() => dispatch(splitwiserActions.setInsightLoading(false)));
    } catch (error) {
      dispatch(
        splitwiserActions.setStatus({ kind: "error", message: error.message }),
      );
    }
  }

  function exportExcel() {
    if (!bill.items.length || !people.length) {
      dispatch(
        splitwiserActions.setStatus({
          kind: "error",
          message: "Add a bill and at least one person first.",
        }),
      );
      return;
    }
    const rows = split.map((p) => ({
      Person: p.name,
      Amount: Number(p.total.toFixed(2)),
      Items: p.items.map((i) => i.name).join(", "),
    }));
    const itemRows = bill.items.map((item) => ({
      Item: item.name,
      Quantity: item.quantity,
      Price: item.price,
      AssignedTo: item.assignedTo.length
        ? item.assignedTo
            .map((id) => people.find((p) => p.id === id)?.name)
            .filter(Boolean)
            .join(", ")
        : "Everyone",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      "Split Summary",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(itemRows),
      "Bill Items",
    );
    XLSX.writeFile(wb, `split-iq-${bill.merchant || "bill"}.xlsx`);
  }

  const nav = [
    ["dashboard", Home, "Overview"],
    ["upload", Upload, "Upload"],
    ["split", Split, "Split"],
    ["settle", Wallet, "Settle"],
    ["people", Users, "People"],
  ];

  const isLoading = status.kind === "loading";

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-mark">
              <ReceiptText size={18} />
            </div>
            <div className="brand-text">
              <strong>Split-IQ</strong>
              <span>Bill splitting AI</span>
            </div>
          </div>
          <button
            className="sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <div className="side-note">
          <ShieldCheck size={15} />
          <span>Session-only workspace</span>
        </div>
        <nav>
          {nav.map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
                setSidebarOpen(false);
              }}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-title">
              <p className="eyebrow">Split-IQ AI</p>
              <h1>{viewTitle(view)}</h1>
            </div>
          </div>
          <div className="actions">
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="ghost"
              onClick={() => dispatch(splitwiserActions.resetCurrentSplit())}
            >
              <RotateCcw size={16} /> Reset
            </button>
            <button onClick={exportExcel}>
              <FileSpreadsheet size={16} /> Export
            </button>
          </div>
        </header>

        {status.kind !== "idle" && !isLoading && (
          <div className={`status ${status.kind}`}>
            {status.kind === "error" ? (
              <AlertCircle size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            <span>{status.message}</span>
          </div>
        )}

        <div key={animKey} className="view-animate">
          {view === "dashboard" && (
            <Dashboard
              bill={bill}
              people={people}
              split={split}
              setView={setView}
            />
          )}
          {view === "upload" && (
            <UploadView
              onAnalyze={handleAnalyze}
              onMerge={handleMerge}
              loading={isLoading}
            />
          )}
          {view === "split" && (
            <SplitView
              bill={bill}
              people={people}
              split={split}
              loading={isLoading}
              insight={insight}
              insightLoading={insightLoading}
            />
          )}
          {view === "settle" && (
            <SettleView
              split={split}
              bill={bill}
              people={people}
              onShareOpen={(data) => {
                setShareData(data);
                setShareModalOpen(true);
              }}
              onQrOpen={setQrTarget}
            />
          )}
          {view === "people" && <PeopleView people={people} />}
        </div>
      </main>

      <BottomNav view={view} setView={setView} nav={nav} />
      {shareModalOpen && (
        <ShareMessageModal
          bill={bill}
          people={people}
          split={split}
          shareData={shareData}
          onClose={() => setShareModalOpen(false)}
        />
      )}
      {qrTarget && (
        <QrModal
          transaction={qrTarget}
          bill={bill}
          onClose={() => setQrTarget(null)}
        />
      )}
    </div>
  );
}

function viewTitle(view) {
  return {
    dashboard: "Overview",
    upload: "Upload bill",
    split: "Assign & split",
    settle: "Settle up",
    people: "People",
  }[view];
}

/* ─────────────────── Dashboard ─────────────────── */

function Dashboard({ bill, people, split, setView }) {
  const settled = split.filter((p) => p.total > 0);
  const hasBill = bill.items.length > 0;
  return (
    <section className="dashboard-grid">
      <div className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Active session</p>
          <h2>{bill.merchant || "Ready when you are"}</h2>
          <p>
            {hasBill
              ? "Review item assignments, adjust splits, and settle up."
              : "Upload a receipt and AI will extract every line item instantly."}
          </p>
        </div>

        {/* stat row — always visible */}
        <div className="hero-stats">
          <div className="hstat">
            <span className="hstat-val">
              {formatMoney(bill.total, bill.currency)}
            </span>
            <span className="hstat-label">Bill total</span>
          </div>
          <div className="hstat-sep" />
          <div className="hstat">
            <span className="hstat-val">{bill.items.length}</span>
            <span className="hstat-label">Items</span>
          </div>
          <div className="hstat-sep" />
          <div className="hstat">
            <span className="hstat-val">{people.length}</span>
            <span className="hstat-label">People</span>
          </div>
          <div className="hstat-sep" />
          <div className="hstat">
            <span className="hstat-val">{settled.length}</span>
            <span className="hstat-label">Settling</span>
          </div>
        </div>

        <button onClick={() => setView("upload")}>
          Upload bill <ArrowRight size={16} />
        </button>
      </div>

      <div className="panel wide">
        <div className="section-head">
          <h3>Split preview</h3>
          <span>{bill.currency || "INR"}</span>
        </div>
        <div className="settlement-list">
          {people.length === 0 && (
            <EmptyState
              icon={Users}
              title="No participants yet"
              message="Add people in the People tab, then upload a bill."
            />
          )}
          {split.map((person) => {
            const pct = bill.total > 0 ? (person.total / bill.total) * 100 : 0;
            return (
              <div key={person.id} className="settlement-row">
                <span className="name-cell">
                  <Avatar name={person.name} />
                  {person.name}
                </span>
                <div className="settlement-bar-wrap">
                  <div
                    className="settlement-bar"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <strong>{formatMoney(person.total, bill.currency)}</strong>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────── Upload ─────────────────── */

function UploadView({ onAnalyze, onMerge, loading }) {
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState([]); // File[]

  function addFiles(incoming) {
    if (!incoming?.length) return;
    setQueue((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      const fresh = Array.from(incoming).filter(
        (f) => !existing.has(f.name + f.size),
      );
      return [...prev, ...fresh];
    });
  }

  function removeFile(idx) {
    setQueue((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  function handleGo() {
    if (!queue.length) return;
    if (queue.length === 1) onAnalyze(queue[0]);
    else onMerge(queue);
  }

  const isMulti = queue.length > 1;

  if (loading) return <SkeletonBill />;

  return (
    <section
      className={`upload-zone-v2${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* ── Top area: icon + text ── */}
      <div className="uzv2-header">
        <div className="uzv2-icon">
          <Bot size={28} />
        </div>
        <div className="uzv2-copy">
          <h2>
            {queue.length === 0
              ? "Got a bill to split?"
              : isMulti
                ? `${queue.length} bills ready to merge`
                : queue[0].name}
          </h2>
          <p>
            {queue.length === 0
              ? "Drop a receipt image or file — AI reads every item, tax, and total in seconds. Add multiple files to merge bills."
              : isMulti
                ? "AI will analyze each bill and combine all items into one session."
                : "AI will extract every line item, tax, and total instantly."}
          </p>
        </div>
      </div>

      {/* ── File queue pills ── */}
      {queue.length > 0 && (
        <div className="uzv2-queue">
          {queue.map((f, i) => (
            <div key={i} className="uzv2-pill">
              <span className="uzv2-pill-icon">
                {f.type.startsWith("image/") ? "🖼️" : "📄"}
              </span>
              <span className="uzv2-pill-name" title={f.name}>
                {f.name}
              </span>
              <span className="uzv2-pill-size">
                {(f.size / 1024).toFixed(0)} KB
              </span>
              <button
                className="uzv2-pill-remove"
                onClick={() => removeFile(i)}
                aria-label={`Remove ${f.name}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Action bar ── */}
      <div className="uzv2-actions">
        <label className="uzv2-add-btn">
          <Plus size={16} />
          {queue.length === 0 ? "Choose file" : "Add more"}
          <input
            type="file"
            accept="image/*,.txt,.csv,.json"
            multiple
            onChange={(e) => addFiles(e.target.files)}
          />
        </label>

        {queue.length > 0 && (
          <button className="uzv2-go-btn" onClick={handleGo}>
            {isMulti ? (
              <>
                <FilePlus2 size={16} /> Merge {queue.length} bills
              </>
            ) : (
              <>
                <Upload size={16} /> Analyze bill
              </>
            )}
          </button>
        )}

        {queue.length > 1 && (
          <button className="uzv2-clear-btn ghost" onClick={() => setQueue([])}>
            <RotateCcw size={14} /> Clear all
          </button>
        )}
      </div>

      {/* ── Format hints ── */}
      {queue.length === 0 && (
        <div className="upload-tags">
          <span>PNG · JPG</span>
          <span>PDF text</span>
          <span>TXT · CSV</span>
          <span>JSON</span>
        </div>
      )}

      {/* ── Multi-bill tip ── */}
      {queue.length === 1 && (
        <p className="uzv2-tip">
          <FilePlus2 size={13} /> Add more files to merge multiple bills into
          one session
        </p>
      )}
    </section>
  );
}

/* ─────────────────── Skeleton ─────────────────── */

function SkeletonBill() {
  return (
    <div className="skeleton-bill">
      <div className="skeleton-header">
        <div className="skel skel-title" />
        <div className="skel skel-sub" />
      </div>
      <div className="skeleton-fields">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="skeleton-field">
            <div className="skel skel-label" />
            <div className="skel skel-input" />
          </div>
        ))}
      </div>
      <div className="skeleton-items">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton-item-row">
            <div
              className="skel skel-name"
              style={{ animationDelay: `${i * 80}ms` }}
            />
            <div
              className="skel skel-num"
              style={{ animationDelay: `${i * 80 + 40}ms` }}
            />
            <div
              className="skel skel-num"
              style={{ animationDelay: `${i * 80 + 80}ms` }}
            />
          </div>
        ))}
      </div>
      <div className="skeleton-label-row">
        <div className="skel skel-tag" />
      </div>
    </div>
  );
}

/* ─────────────────── Split view ─────────────────── */

function SplitView({ bill, people, split, loading, insight, insightLoading }) {
  const dispatch = useDispatch();
  const [activeTab, setActiveTab] = useState("details");
  const [smartState, setSmartState] = useState(null); // null | { loading } | { suggestions }

  async function handleSmartSplit() {
    if (!people.length || !bill.items.length) return;
    setSmartState({ loading: true });
    try {
      const result = await fetchSmartSplit({ items: bill.items, people });
      setSmartState({ suggestions: result.assignments || [] });
    } catch (e) {
      setSmartState({ error: e.message });
    }
  }

  function autoAssignAll() {
    bill.items.forEach((item) => {
      people.forEach((person) => {
        if (!item.assignedTo.includes(person.id)) {
          dispatch(
            splitwiserActions.toggleAssignee({
              itemId: item.id,
              personId: person.id,
            }),
          );
        }
      });
    });
  }

  function clearAllAssignees() {
    bill.items.forEach((item) => {
      item.assignedTo.forEach((personId) => {
        dispatch(
          splitwiserActions.toggleAssignee({ itemId: item.id, personId }),
        );
      });
    });
  }

  const unassignedCount = bill.items.filter(
    (i) => i.assignedTo.length === 0,
  ).length;

  if (loading) return <SkeletonBill />;

  return (
    <div>
      <InsightCard insight={insight} loading={insightLoading} />
      <div className="split-tabs">
        <button
          className={`split-tab${activeTab === "details" ? " active" : ""}`}
          onClick={() => setActiveTab("details")}
        >
          Bill details
        </button>
        <button
          className={`split-tab${activeTab === "summary" ? " active" : ""}`}
          onClick={() => setActiveTab("summary")}
        >
          Each person owes
        </button>
      </div>
      <div className="split-layout" data-tab={activeTab}>
        <section className="panel tab-panel-details">
          <div className="section-head">
            <h3>Bill details</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="icon-btn"
                onClick={() => dispatch(splitwiserActions.addItem())}
                aria-label="Add item"
                title="Add item"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
          <div className="form-grid">
            <Field
              label="Merchant"
              value={bill.merchant}
              onChange={(v) =>
                dispatch(splitwiserActions.updateBill({ merchant: v }))
              }
            />
            <Field
              label="Date"
              type="date"
              value={bill.date}
              onChange={(v) =>
                dispatch(splitwiserActions.updateBill({ date: v }))
              }
            />
            <Field
              label="Currency"
              value={bill.currency}
              onChange={(v) =>
                dispatch(
                  splitwiserActions.updateBill({ currency: v.toUpperCase() }),
                )
              }
            />
            <Field
              label="Tax"
              type="number"
              value={bill.tax}
              onChange={(v) =>
                dispatch(
                  splitwiserActions.updateBill({ tax: normalizeNumber(v) }),
                )
              }
            />
            <Field
              label="Service charge"
              type="number"
              value={bill.serviceCharge}
              onChange={(v) =>
                dispatch(
                  splitwiserActions.updateBill({
                    serviceCharge: normalizeNumber(v),
                  }),
                )
              }
            />
            <Field
              label="Discount"
              type="number"
              value={bill.discount}
              onChange={(v) =>
                dispatch(
                  splitwiserActions.updateBill({
                    discount: normalizeNumber(v),
                  }),
                )
              }
            />
          </div>

          <AnomalyAlerts bill={bill} />

          {people.length > 0 && bill.items.length > 0 && (
            <div className="auto-assign-bar">
              <div className="auto-assign-info">
                {unassignedCount > 0 ? (
                  <>
                    <span className="badge-warn">
                      {unassignedCount} unassigned
                    </span>
                    <span className="muted">
                      {" "}
                      — split unassigned equally among all
                    </span>
                  </>
                ) : (
                  <span className="badge-ok">All items assigned</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-auto" onClick={autoAssignAll}>
                  <Zap size={14} /> Split equally
                </button>
                {people.length >= 2 && (
                  <button
                    className="btn-auto btn-smart"
                    onClick={handleSmartSplit}
                    disabled={smartState?.loading}
                    title="AI assigns items based on names & food type"
                  >
                    <Wand2 size={14} />
                    {smartState?.loading ? "Thinking…" : "Smart assign"}
                  </button>
                )}
                <button
                  className="btn-auto ghost-sm"
                  onClick={clearAllAssignees}
                >
                  <RotateCcw size={13} /> Clear
                </button>
              </div>
            </div>
          )}

          <div className="items">
            {bill.items.length > 1 && <DuplicateWarning items={bill.items} />}
            {smartState?.error && (
              <div
                className="anomaly-item anomaly-error"
                style={{ marginBottom: 8 }}
              >
                <AlertTriangle size={13} />
                <span>Smart assign failed: {smartState.error}</span>
              </div>
            )}
            {bill.items.length === 0 && (
              <EmptyState
                icon={ReceiptText}
                title="No items"
                message="Upload a bill or add line items manually."
              />
            )}
            {bill.items.length > 0 && (
              <div className="item-header">
                <span>Item</span>
                <span>Qty</span>
                <span>Amount</span>
                <span />
              </div>
            )}
            {bill.items.map((item) => (
              <div key={item.id} className="item-row">
                <div className="item-row-main">
                  <input
                    placeholder="Item name"
                    value={item.name}
                    onChange={(e) =>
                      dispatch(
                        splitwiserActions.updateItem({
                          id: item.id,
                          patch: { name: e.target.value },
                        }),
                      )
                    }
                  />
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) =>
                      dispatch(
                        splitwiserActions.updateItem({
                          id: item.id,
                          patch: { quantity: normalizeNumber(e.target.value) },
                        }),
                      )
                    }
                  />
                  <input
                    type="number"
                    value={item.price}
                    onChange={(e) =>
                      dispatch(
                        splitwiserActions.updateItem({
                          id: item.id,
                          patch: { price: normalizeNumber(e.target.value) },
                        }),
                      )
                    }
                  />
                  <button
                    className="icon-btn danger"
                    onClick={() =>
                      dispatch(splitwiserActions.removeItem(item.id))
                    }
                    aria-label="Remove"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="item-assignees">
                  <span className="item-tag-pill">{getItemTag(item.name)}</span>
                  {people.length === 0 && (
                    <span className="muted">Add people to assign.</span>
                  )}
                  {people.map((person) => (
                    <label
                      key={person.id}
                      className={
                        item.assignedTo.includes(person.id)
                          ? "chip selected"
                          : "chip"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={item.assignedTo.includes(person.id)}
                        onChange={() =>
                          dispatch(
                            splitwiserActions.toggleAssignee({
                              itemId: item.id,
                              personId: person.id,
                            }),
                          )
                        }
                      />
                      {person.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel tab-panel-summary">
          <div className="section-head">
            <h3>Each person owes</h3>
            <span>{formatMoney(bill.total, bill.currency)}</span>
          </div>
          <div className="pay-list">
            {people.length === 0 && (
              <EmptyState
                icon={CircleDollarSign}
                title="No participants"
                message="Add people to see individual balances."
                compact
              />
            )}
            {split.map((person) => {
              const pct =
                bill.total > 0 ? (person.total / bill.total) * 100 : 0;
              return (
                <div key={person.id} className="pay-card">
                  <div className="pay-card-left">
                    <Avatar name={person.name} />
                    <div>
                      <div className="pay-card-name">{person.name}</div>
                      <div className="pay-card-sub">
                        {person.items.length} items · {pct.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                  <strong>{formatMoney(person.total, bill.currency)}</strong>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      {smartState?.suggestions && (
        <SmartSplitModal
          suggestions={smartState.suggestions}
          bill={bill}
          people={people}
          onApply={(accepted) => {
            accepted.forEach(({ itemId, personIds }) => {
              const item = bill.items.find((i) => i.id === itemId);
              if (!item) return;
              // clear existing first
              item.assignedTo.forEach((pid) =>
                dispatch(
                  splitwiserActions.toggleAssignee({ itemId, personId: pid }),
                ),
              );
              personIds.forEach((pid) =>
                dispatch(
                  splitwiserActions.toggleAssignee({ itemId, personId: pid }),
                ),
              );
            });
            setSmartState(null);
          }}
          onClose={() => setSmartState(null)}
        />
      )}
    </div>
  );
}

function SettleView({ split, bill, people, onShareOpen, onQrOpen }) {
  // mode: "single" | "own" | "custom"
  const [mode, setMode] = useState(null); // null = nothing picked yet
  const [singleId, setSingleId] = useState(null);
  const [customAmounts, setCustomAmounts] = useState({}); // personId → number
  const [settled, setSettled] = useState({});

  const grandTotal = split.reduce((s, p) => s + p.total, 0);

  const paymentAmounts = useMemo(() => {
    if (mode === "single") return singleId ? { [singleId]: grandTotal } : {};
    if (mode === "own")
      return Object.fromEntries(split.map((p) => [p.id, p.total]));
    if (mode === "custom") return customAmounts;
    return {};
  }, [mode, singleId, grandTotal, split, customAmounts]);

  const transactions = useMemo(
    () => simplifyDebts(split, paymentAmounts),
    [split, paymentAmounts],
  );
  const totalPaid = Object.values(paymentAmounts).reduce(
    (s, v) => s + normalizeNumber(v),
    0,
  );
  const paidDiff = totalPaid - grandTotal;
  const hasEnteredAny =
    mode === "custom" &&
    Object.values(customAmounts).some((v) => normalizeNumber(v) > 0);
  const hasPayments =
    mode === "single" ? !!singleId : mode === "own" ? true : hasEnteredAny;
  const settledCount = Object.values(settled).filter(Boolean).length;

  function switchMode(next) {
    setMode(next);
    setSingleId(null);
    setCustomAmounts({});
    setSettled({});
  }

  function setPersonPaid(id, raw) {
    setCustomAmounts((prev) => ({ ...prev, [id]: normalizeNumber(raw) }));
  }

  function fillExactShare(id) {
    const share = split.find((p) => p.id === id)?.total ?? 0;
    setCustomAmounts((prev) => ({ ...prev, [id]: Number(share.toFixed(2)) }));
  }

  function fillAllExact() {
    setCustomAmounts(
      Object.fromEntries(split.map((p) => [p.id, Number(p.total.toFixed(2))])),
    );
  }

  function fillAllEqual() {
    const each = people.length ? grandTotal / people.length : 0;
    setCustomAmounts(
      Object.fromEntries(people.map((p) => [p.id, Number(each.toFixed(2))])),
    );
  }

  function toggleSettled(key) {
    setSettled((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const SCENARIOS = [
    {
      id: "single",
      icon: Banknote,
      title: "One person paid",
      desc: "Someone fronted the full bill — others will pay them back.",
    },
    {
      id: "custom",
      icon: Wand2,
      title: "Multiple payers",
      desc: "e.g. You paid Bill 1, John paid Bill 2 — enter what each person paid.",
    },
  ];

  return (
    <div className="settle-wrap">
      {/* ── Header summary ── */}
      <div className="settle-header-card panel">
        <div className="settle-hc-left">
          <div className="settle-hc-icon">
            <Wallet size={22} />
          </div>
          <div>
            <div className="settle-hc-label">Total to settle</div>
            <div className="settle-hc-amount">
              {formatMoney(grandTotal, bill.currency)}
            </div>
            <div className="settle-hc-sub">
              {hasPayments
                ? `${transactions.length} transfer${transactions.length !== 1 ? "s" : ""} needed · ${settledCount}/${transactions.length} done`
                : "Pick a scenario below to get started"}
            </div>
          </div>
        </div>
        <div className="settle-hc-right">
          <div className="settle-progress-wrap">
            <div className="settle-progress-bar">
              <div
                className="settle-progress-fill"
                style={{
                  width:
                    hasPayments && transactions.length
                      ? `${(settledCount / transactions.length) * 100}%`
                      : "0%",
                }}
              />
            </div>
          </div>
          <button
            className="ghost settle-share-btn"
            onClick={() => onShareOpen({ transactions, paymentAmounts })}
          >
            <MessageCircle size={15} /> Share
          </button>
        </div>
      </div>

      {/* ── Scenario cards ── */}
      <div className="scenario-grid">
        {SCENARIOS.map(({ id, icon: Icon, title, desc }) => (
          <button
            key={id}
            className={`scenario-card${mode === id ? " active" : ""}`}
            onClick={() => switchMode(id)}
          >
            <div className="scenario-icon">
              <Icon size={18} />
            </div>
            <div className="scenario-text">
              <strong>{title}</strong>
              <span>{desc}</span>
            </div>
            {mode === id && <Check size={14} className="scenario-check" />}
          </button>
        ))}
      </div>

      {/* ── Single payer: person grid ── */}
      {mode === "single" && (
        <div className="settle-payer-row panel">
          <div className="settle-panel-label">
            <Banknote size={15} />
            <span>
              Who paid the full {formatMoney(grandTotal, bill.currency)}?
            </span>
          </div>
          <div className="settle-single-grid">
            {people.length === 0 && (
              <EmptyState
                icon={Users}
                title="No participants"
                message="Add people in the People tab first."
                compact
              />
            )}
            {people.map((p) => (
              <button
                key={p.id}
                className={`payer-person-btn${singleId === p.id ? " selected" : ""}`}
                onClick={() =>
                  setSingleId((prev) => (prev === p.id ? null : p.id))
                }
              >
                <Avatar name={p.name} />
                <div className="ppb-info">
                  <span className="ppb-name">{p.name}</span>
                  <span className="ppb-amount">
                    {formatMoney(grandTotal, bill.currency)}
                  </span>
                </div>
                {singleId === p.id && <Check size={14} className="ppb-check" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Own share: instant confirmation ── */}
      {mode === "own" && (
        <div className="own-share-card panel">
          <div className="own-share-rows">
            {people.length === 0 && (
              <EmptyState
                icon={Users}
                title="No participants"
                message="Add people in the People tab first."
                compact
              />
            )}
            {split.map((p) => (
              <div key={p.id} className="own-share-row">
                <Avatar name={p.name} />
                <span className="own-share-name">{p.name}</span>
                <span className="own-share-label">paid their share</span>
                <strong className="own-share-amount">
                  {formatMoney(p.total, bill.currency)}
                </strong>
                <CheckCircle2 size={15} className="own-share-tick" />
              </div>
            ))}
          </div>
          {people.length > 0 && (
            <p className="own-share-note">
              If anyone actually paid more or less, switch to{" "}
              <strong>Custom amounts</strong> instead.
            </p>
          )}
        </div>
      )}

      {/* ── Custom / Multiple payers ── */}
      {mode === "custom" && (
        <div className="multi-payer-card panel">
          <div className="multi-payer-head">
            <p className="multi-payer-desc">
              For each person, enter how much they{" "}
              <strong>physically paid</strong> (the bill they paid at the
              counter). Leave at <strong>0</strong> if they paid nothing
              upfront.
            </p>
            <div className="multi-payer-presets">
              <button className="preset-btn" onClick={fillAllExact}>
                <Zap size={13} /> Everyone paid own share
              </button>
              <button className="preset-btn ghost" onClick={fillAllEqual}>
                <RotateCcw size={13} /> Divide equally
              </button>
            </div>
          </div>

          <div className="payer-table">
            {people.length === 0 && (
              <EmptyState
                icon={Users}
                title="No participants"
                message="Add people in the People tab first."
                compact
              />
            )}
            {split.map((p) => {
              const paid = normalizeNumber(customAmounts[p.id] ?? 0);
              const hasPaid = customAmounts[p.id] !== undefined;
              const diff = hasPaid ? paid - p.total : null;
              const chipNone = hasPaid && paid === 0;
              const chipShare = hasPaid && Math.abs(paid - p.total) < 0.5;
              const chipAll =
                hasPaid &&
                Math.abs(paid - grandTotal) < 0.5 &&
                grandTotal !== p.total;
              return (
                <div
                  key={p.id}
                  className={`payer-row-v2${hasPaid ? " has-value" : ""}`}
                >
                  {/* top row: avatar + name + input */}
                  <div className="prv2-top">
                    <Avatar name={p.name} />
                    <div className="prv2-person">
                      <span className="prv2-name">{p.name}</span>
                      <span className="prv2-share">
                        owes {formatMoney(p.total, bill.currency)}
                      </span>
                    </div>
                    <div className="prv2-input-group">
                      <span className="prv2-ccy">{bill.currency}</span>
                      <input
                        type="number"
                        className="prv2-input"
                        placeholder="0"
                        value={customAmounts[p.id] ?? ""}
                        min="0"
                        step="0.01"
                        onChange={(e) => setPersonPaid(p.id, e.target.value)}
                      />
                    </div>
                    {diff !== null && (
                      <span
                        className={`payer-diff${diff > 0.5 ? " pos" : diff < -0.5 ? " neg" : " zero"}`}
                      >
                        {diff > 0.5
                          ? `+${formatMoney(diff, bill.currency)} extra`
                          : diff < -0.5
                            ? `${formatMoney(diff, bill.currency)} short`
                            : "exact ✓"}
                      </span>
                    )}
                  </div>
                  {/* chip row: quick picks */}
                  <div className="prv2-chips">
                    <button
                      className={`prv2-chip${chipNone ? " active" : ""}`}
                      onClick={() => setPersonPaid(p.id, 0)}
                    >
                      Paid nothing
                    </button>
                    <button
                      className={`prv2-chip accent${chipShare ? " active" : ""}`}
                      onClick={() => fillExactShare(p.id)}
                    >
                      {formatMoney(p.total, bill.currency)} (their share)
                    </button>
                    {grandTotal !== p.total && (
                      <button
                        className={`prv2-chip${chipAll ? " active" : ""}`}
                        onClick={() =>
                          setCustomAmounts((prev) => ({
                            ...prev,
                            [p.id]: Number(grandTotal.toFixed(2)),
                          }))
                        }
                      >
                        {formatMoney(grandTotal, bill.currency)} (full bill)
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {hasEnteredAny && (
            <div
              className={`payment-total-row${Math.abs(paidDiff) > 0.5 ? " mismatch" : " match"}`}
            >
              <span>Total entered</span>
              <span>
                <strong>{formatMoney(totalPaid, bill.currency)}</strong>
                {Math.abs(paidDiff) > 0.5 ? (
                  <span className="payment-diff-label">
                    {paidDiff > 0
                      ? ` — ₹${paidDiff.toFixed(0)} over`
                      : ` — ₹${(-paidDiff).toFixed(0)} short`}
                  </span>
                ) : (
                  <span className="payment-ok-label"> = bill total ✓</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── No scenario picked yet ── */}
      {!mode && (
        <EmptyState
          icon={Wallet}
          title="How was the bill paid?"
          message="Pick a scenario above — we'll calculate who owes whom instantly."
        />
      )}

      {/* ── All settled ── */}
      {hasPayments && transactions.length === 0 && (
        <div className="settle-all-done">
          <CheckCircle2 size={40} />
          <strong>All settled up!</strong>
          <p>No transfers needed — everyone is even.</p>
        </div>
      )}
      {transactions.length > 0 && settledCount === transactions.length && (
        <div className="settle-all-done">
          <CheckCircle2 size={40} />
          <strong>All settled up!</strong>
          <p>Every transfer has been marked as settled.</p>
        </div>
      )}

      {/* ── Transaction cards ── */}
      {transactions.length > 0 &&
        settledCount < transactions.length &&
        transactions.map((tx, i) => {
          const key = `${tx.from.id}-${tx.to.id}`;
          const done = !!settled[key];
          return (
            <div
              key={key}
              className={`txn-card${done ? " txn-done" : ""}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="txn-avatars">
                <Avatar name={tx.from.name} />
                <div className="txn-arrow">
                  <ArrowLeftRight size={16} />
                </div>
                <Avatar name={tx.to.name} />
              </div>
              <div className="txn-info">
                <div className="txn-headline">
                  <span className="txn-from">{tx.from.name}</span>
                  <span className="txn-pays"> pays </span>
                  <span className="txn-to">{tx.to.name}</span>
                </div>
                <div className="txn-amount">
                  {formatMoney(tx.amount, bill.currency)}
                </div>
              </div>
              <div className="txn-actions">
                <button
                  className="icon-btn"
                  onClick={() => onQrOpen(tx)}
                  title="Payment QR"
                  aria-label="Payment QR"
                >
                  <QrCode size={14} />
                </button>
                <button
                  className={`txn-settle-btn${done ? " done" : ""}`}
                  onClick={() => toggleSettled(key)}
                >
                  {done ? (
                    <>
                      <CheckCircle2 size={14} /> Settled
                    </>
                  ) : (
                    "Mark settled"
                  )}
                </button>
              </div>
            </div>
          );
        })}
    </div>
  );
}

/* ─────────────────── People ─────────────────── */

function PeopleView({ people }) {
  const dispatch = useDispatch();
  const [newName, setNewName] = useState("");
  function addPerson(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    dispatch(splitwiserActions.addPerson(newName.trim()));
    setNewName("");
  }
  return (
    <section className="panel">
      <div className="section-head">
        <h3>Participants</h3>
        <form className="inline-form" onSubmit={addPerson}>
          <input
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit">
            <Plus size={16} /> Add
          </button>
        </form>
      </div>
      <div className="people-grid">
        {people.length === 0 && (
          <EmptyState
            icon={Users}
            title="No people added"
            message="Add everyone who shared the bill."
          />
        )}
        {people.map((person) => (
          <div className="person-card" key={person.id}>
            <Avatar name={person.name} />
            <input
              value={person.name}
              onChange={(e) =>
                dispatch(
                  splitwiserActions.updatePerson({
                    id: person.id,
                    name: e.target.value,
                  }),
                )
              }
            />
            <button
              className="icon-btn danger"
              onClick={() =>
                dispatch(splitwiserActions.removePerson(person.id))
              }
              aria-label="Remove"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────── Shared components ─────────────────── */

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Avatar({ name }) {
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  return <span className="avatar">{initials}</span>;
}

function EmptyState({ icon: Icon, title, message, compact = false }) {
  return (
    <div className={`empty-state${compact ? " compact" : ""}`}>
      <div className="empty-icon">
        <Icon size={20} />
      </div>
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}

/* ─────────────────── Bottom Nav (mobile) ─────────────────── */

function BottomNav({ view, setView, nav }) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {nav.map(([id, Icon, label]) => {
        const isActive = view === id;
        return (
          <button
            key={id}
            className={`bottom-nav-item${isActive ? " active" : ""}`}
            onClick={() => setView(id)}
            aria-label={label}
          >
            <span className="bottom-nav-icon">
              <Icon size={22} />
            </span>
            <span className="bottom-nav-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ─────────────────── InsightCard ─────────────────── */

function InsightCard({ insight, loading }) {
  if (loading) {
    return (
      <div className="insight-card insight-loading">
        <Sparkles size={14} className="spin" />
        <span>AI is reading your bill…</span>
      </div>
    );
  }
  if (!insight?.summary) return null;
  return (
    <div className="insight-card">
      <div className="insight-meta">
        <Globe size={13} />
        <span className="insight-badge">{insight.cuisine}</span>
        <span className="insight-dot">·</span>
        <span className="insight-badge">{insight.vibe}</span>
        <Sparkles size={13} className="insight-sparkle" />
      </div>
      <p className="insight-summary">{insight.summary}</p>
    </div>
  );
}

/* ─────────────────── AnomalyAlerts ─────────────────── */

function AnomalyAlerts({ bill }) {
  const anomalies = detectAnomalies(bill);
  if (!anomalies.length) return null;
  return (
    <div className="anomaly-list">
      {anomalies.map((a, i) => (
        <div key={i} className={`anomaly-item anomaly-${a.type}`}>
          <AlertTriangle size={13} />
          <span>{a.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────── DuplicateWarning ─────────────────── */

function DuplicateWarning({ items }) {
  const dupes = findDuplicates(items);
  if (!dupes.length) return null;
  return (
    <div className="duplicate-warning">
      <Copy size={13} />
      <span>
        Possible duplicates:{" "}
        {dupes.map(([a, b], i) => (
          <span key={i}>
            {i > 0 && " · "}
            &ldquo;{a}&rdquo; &amp; &ldquo;{b}&rdquo;
          </span>
        ))}
      </span>
    </div>
  );
}

/* ─────────────────── ShareMessageModal ─────────────────── */

function ShareMessageModal({ bill, people, split, onClose, shareData }) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  const transactions = shareData?.transactions || [];
  const paymentAmounts = shareData?.paymentAmounts || {};

  const payers = split.filter((p) => (paymentAmounts[p.id] || 0) > 0.005);

  useEffect(() => {
    generateShareMessage({ bill, people, split, transactions, paymentAmounts })
      .then(setMsg)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  function copyMsg() {
    if (!msg) return;
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <MessageCircle size={16} />
            <span>WhatsApp / Telegram</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        {loading && (
          <div className="modal-loading">
            <Sparkles size={16} className="spin" />
            <span>Generating message…</span>
          </div>
        )}
        {err && <div className="modal-error">{err}</div>}
        {!loading && !err && (
          <>
            <textarea
              className="share-textarea"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              rows={7}
            />
            <div className="modal-actions">
              <button onClick={copyMsg} className={copied ? "btn-success" : ""}>
                {copied ? (
                  <>
                    <Check size={15} /> Copied!
                  </>
                ) : (
                  <>
                    <Copy size={15} /> Copy message
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── QrModal ─────────────────── */

function QrModal({ transaction, bill, onClose }) {
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    const text = [
      `Pay: ${bill.currency} ${Number(transaction.amount).toFixed(2)}`,
      `From: ${transaction.from.name}`,
      `To: ${transaction.to.name}`,
      bill.merchant ? `For: ${bill.merchant}` : "",
      bill.date ? `Date: ${bill.date}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    QRCode.toDataURL(text, { width: 220, margin: 2 })
      .then(setQrUrl)
      .catch(() => {});
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <QrCode size={16} />
            <span>Payment QR</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="qr-body">
          <div className="qr-from-to">
            <Avatar name={transaction.from.name} />
            <div className="qr-from-to-text">
              <strong>{transaction.from.name}</strong>
              <span>pays</span>
              <strong>{transaction.to.name}</strong>
            </div>
            <Avatar name={transaction.to.name} />
          </div>
          <div className="qr-amount-display">
            {formatMoney(transaction.amount, bill.currency)}
          </div>
          {qrUrl ? (
            <img src={qrUrl} alt="Payment QR code" className="qr-image" />
          ) : (
            <div className="qr-placeholder">
              <Sparkles size={20} className="spin" />
            </div>
          )}
          <small className="qr-hint">
            Scan or screenshot to share payment details
          </small>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── SmartSplitModal ─────────────────── */

function SmartSplitModal({ suggestions, bill, people, onApply, onClose }) {
  // Build mutable per-item selection state: itemId → Set of personIds
  const [selections, setSelections] = useState(() => {
    const map = {};
    suggestions.forEach((s) => {
      const personIds = s.peopleNames
        .map(
          (name) =>
            people.find(
              (p) => p.name.toLowerCase().trim() === name.toLowerCase().trim(),
            )?.id,
        )
        .filter(Boolean);
      map[s.itemId] = new Set(
        personIds.length ? personIds : people.map((p) => p.id),
      );
    });
    return map;
  });

  function togglePerson(itemId, personId) {
    setSelections((prev) => {
      const next = new Set(prev[itemId]);
      if (next.has(personId)) {
        if (next.size === 1) return prev; // keep at least one
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return { ...prev, [itemId]: next };
    });
  }

  function applyAll() {
    const accepted = Object.entries(selections).map(([itemId, ids]) => ({
      itemId,
      personIds: Array.from(ids),
    }));
    onApply(accepted);
  }

  const assignedCount = suggestions.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal smart-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Wand2 size={16} />
            <span>AI Smart Assign</span>
            <span className="smart-modal-badge">{assignedCount} items</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <p className="smart-modal-hint">
          AI suggested these assignments. Adjust any chips then apply.
        </p>
        <div className="smart-item-list">
          {suggestions.map((s) => {
            const item = bill.items.find((i) => i.id === s.itemId);
            if (!item) return null;
            const selected = selections[s.itemId] || new Set();
            return (
              <div key={s.itemId} className="smart-item-row">
                <div className="smart-item-top">
                  <span className="smart-item-tag">
                    {getItemTag(item.name)}
                  </span>
                  <div className="smart-item-info">
                    <span className="smart-item-name">{item.name}</span>
                    <span className="smart-item-price">
                      {formatMoney(item.price, bill.currency)}
                    </span>
                  </div>
                  {s.shared && (
                    <span className="smart-shared-badge">shared</span>
                  )}
                </div>
                {s.reason && <p className="smart-item-reason">{s.reason}</p>}
                <div className="smart-chips">
                  {people.map((person) => (
                    <button
                      key={person.id}
                      className={`smart-chip${selected.has(person.id) ? " selected" : ""}`}
                      onClick={() => togglePerson(s.itemId, person.id)}
                    >
                      {selected.has(person.id) && <Check size={11} />}
                      {person.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="smart-modal-footer">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button onClick={applyAll}>
            <Check size={15} /> Apply {assignedCount} assignments
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
