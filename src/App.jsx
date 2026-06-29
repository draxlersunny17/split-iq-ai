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
  LogIn,
  LogOut,
  MessageCircle,
  Moon,
  Plus,
  QrCode,
  ReceiptText,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Split,
  Sun,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wallet,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import * as XLSX from "xlsx";
import {
  createSession,
  deleteSession,
  loadSession,
  saveFullExpense,
  searchUsers,
  signIn,
  signUp,
  syncSessionItems,
  syncSessionPeople,
  syncSettleState,
  updateGroupDescription,
} from "./service/supabaseApi";
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
    maximumFractionDigits: 0,
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
  ["☕", /coffee|espresso|latte|cappuccino|americano|mocha|\btea\b|chai|macchiato|cold.?brew|frappe/i],
  [
    "🍰",
    /dessert|cake|ice.?cream|waffle|brownie|pudding|mousse|pastry|cookie|pie|cheesecake|gelato|sorbet|sundae|tiramisu/i,
  ],
  ["🥤", /juice|soda|\bwater\b|cola|pepsi|sprite|lemonade|smoothie|milkshake|soft.?drink|mocktail|lassi|nimbu/i],
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
    subtotal + normalizeNumber(bill.tax) + normalizeNumber(bill.serviceCharge) - normalizeNumber(bill.discount);
  const stated = normalizeNumber(bill.total);
  if (stated > 0 && Math.abs(expected - stated) / stated > 0.05)
    anomalies.push({
      type: "error",
      message: `Total mismatch: items sum to ${formatMoney(expected, bill.currency)}, bill says ${formatMoney(stated, bill.currency)}`,
    });

  const dominant = bill.items.slice().sort((a, b) => normalizeNumber(b.price) - normalizeNumber(a.price))[0];
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
  if (longer.includes(shorter) && shorter.length / longer.length > 0.75) return 1;
  const dp = Array.from({ length: shorter.length + 1 }, (_, i) => i);
  for (let i = 1; i <= longer.length; i++) {
    let prev = i;
    for (let j = 1; j <= shorter.length; j++) {
      const cur = longer[i - 1] === shorter[j - 1] ? dp[j - 1] : 1 + Math.min(dp[j - 1], dp[j], prev);
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
      if (strSimilarity(items[i].name, items[j].name) > 0.82) pairs.push([items[i].name, items[j].name]);
    }
  }
  return pairs;
}

function sanitizeParsedBill(parsed) {
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const subtotal = normalizeNumber(
    parsed.subtotal || items.reduce((sum, item) => sum + normalizeNumber(item.price), 0),
  );
  const tax = normalizeNumber(parsed.tax);
  const serviceCharge = normalizeNumber(parsed.serviceCharge || parsed.service_charge);
  const discount = normalizeNumber(parsed.discount);
  const total = normalizeNumber(parsed.total || subtotal + tax + serviceCharge - discount);
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
  const subtotal = bill.items.reduce((sum, item) => sum + normalizeNumber(item.price), 0);
  // Prefer explicit tax/service/discount fields when available (stored in notes, always accurate).
  // Fall back to deriving extras from bill.total (handles cases where notes fields are zero).
  const extrasFromFields =
    normalizeNumber(bill.tax) + normalizeNumber(bill.serviceCharge) - normalizeNumber(bill.discount);
  const extras = extrasFromFields !== 0 ? extrasFromFields : Math.max(0, normalizeNumber(bill.total) - subtotal);
  bill.items.forEach((item) => {
    const assignees = item.assignedTo?.length ? item.assignedTo : people.map((p) => p.id);
    const baseShare = splitAmount(item.price, assignees);
    const itemRatio = subtotal > 0 ? normalizeNumber(item.price) / subtotal : 0;
    const extraShare = splitAmount(extras * itemRatio, assignees);
    assignees.forEach((id) => {
      personTotals[id] = normalizeNumber(personTotals[id]) + baseShare + extraShare;
    });
  });
  return people.map((p) => ({
    ...p,
    total: Math.round((personTotals[p.id] || 0) * 100) / 100,
    items: bill.items.filter((item) => !item.assignedTo?.length || item.assignedTo.includes(p.id)),
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

  const creditors = balances.filter((b) => b.net > 0.005).map((b) => ({ ...b }));
  const debtors = balances.filter((b) => b.net < -0.005).map((b) => ({ ...b, net: -b.net }));

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

async function generateShareMessage({ bill, people, split, transactions, paymentAmounts }) {
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
  const { view, people, bill, status, insightLoading, insight, currentUser, activeSession } = useSelector(
    (state) => state.splitwiser,
  );
  const settle = useSelector((state) => state.splitwiser.settle);
  const split = useMemo(() => calculateSplit(bill, people), [bill, people]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [animKey, setAnimKey] = useState(view);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(() => !!activeSession?.expenseId);

  // ── Refs for DB sync
  const syncTimerRef = useRef(null);
  const settledTimerRef = useRef(null);
  const sessionRestoredRef = useRef(false);
  const sessionLoadStartedRef = useRef(false); // prevents StrictMode double-invoke
  const isRestoringRef = useRef(false); // suppresses syncs during restore

  // ── Restore session from DB on mount (after login)
  useEffect(() => {
    if (!currentUser || !activeSession?.expenseId) {
      sessionRestoredRef.current = true;
      setSessionLoading(false);
      return;
    }
    if (sessionLoadStartedRef.current) return; // StrictMode guard
    sessionLoadStartedRef.current = true;
    isRestoringRef.current = true;
    loadSession(activeSession.expenseId)
      .then(({ bill: b, people: ps, settle: s, description }) => {
        if (b.items.length > 0 || ps.length > 0) {
          dispatch(splitwiserActions.setBill(b));
          ps.forEach((p) => dispatch(splitwiserActions.addPerson(p)));
          // Restore settle scenario if it was saved
          if (s?.mode) {
            // Merge DB-restored settled (source of truth) with localStorage
            // (localStorage may have more recent ticks not yet written to DB)
            let localSettled = {};
            try {
              const raw = localStorage.getItem(`settled-${activeSession.expenseId}`);
              if (raw) localSettled = JSON.parse(raw);
            } catch {}
            const mergedSettled = { ...(s.settled || {}), ...localSettled };
            dispatch(splitwiserActions.restoreSettle({ ...s, settled: mergedSettled }));
          }
          // Restore AI insight from stored description — no API call needed
          if (description) {
            const [summary, cuisine, vibe] = description.split(" · ");
            dispatch(
              splitwiserActions.setInsight({
                summary: summary || description,
                cuisine: cuisine || "",
                vibe: vibe || "",
              }),
            );
          }
        }
      })
      .catch(() => {
        dispatch(splitwiserActions.setActiveSession({ expenseId: null, groupId: null }));
      })
      .finally(() => {
        // Use setTimeout so React flushes all dispatched state updates before
        // we allow sync effects to fire — prevents immediately overwriting
        // the restored settle/bill state with stale values.
        setTimeout(() => {
          isRestoringRef.current = false;
          sessionRestoredRef.current = true;
          setSessionLoading(false);
        }, 0);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync people into group_members whenever the list changes
  const supabaseIdsKey = people
    .map((p) => p.supabaseId)
    .filter(Boolean)
    .join(",");
  useEffect(() => {
    if (isRestoringRef.current || !sessionRestoredRef.current || !activeSession?.groupId || !supabaseIdsKey) return;
    const userIds = supabaseIdsKey.split(",");
    syncSessionPeople(activeSession.groupId, userIds).catch(() => {});
  }, [supabaseIdsKey, activeSession?.groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a ref to latest settle so bill-sync can read it without depending on it
  const settleRef = useRef(settle);
  useEffect(() => {
    settleRef.current = settle;
  });

  // ── Save AI insight summary as expense_group description when it arrives
  useEffect(() => {
    if (!insight?.summary || !activeSession?.groupId) return;
    const description = [insight.summary, insight.cuisine, insight.vibe].filter(Boolean).join(" · ");
    updateGroupDescription(activeSession.groupId, description).catch(() => {});
  }, [insight, activeSession?.groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced bill / item-assignment sync (2 s after last change)
  useEffect(() => {
    if (isRestoringRef.current || !sessionRestoredRef.current || !activeSession?.expenseId || !bill.items.length)
      return;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncSessionItems(activeSession.expenseId, bill, people, settleRef.current).catch(() => {});
    }, 2000);
    return () => clearTimeout(syncTimerRef.current);
  }, [bill, activeSession?.expenseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist settled map to localStorage so it survives page refresh
  const { settled } = settle;
  useEffect(() => {
    if (!activeSession?.expenseId) return;
    try {
      if (Object.keys(settled).length > 0) {
        localStorage.setItem(`settled-${activeSession.expenseId}`, JSON.stringify(settled));
      } else {
        localStorage.removeItem(`settled-${activeSession.expenseId}`);
      }
    } catch {}
  }, [settled, activeSession?.expenseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced settled-state sync to DB (1 s after marking a transaction)
  useEffect(() => {
    if (isRestoringRef.current || !sessionRestoredRef.current || !activeSession?.expenseId || !bill.items.length)
      return;
    clearTimeout(settledTimerRef.current);
    settledTimerRef.current = setTimeout(() => {
      syncSettleState(activeSession.expenseId, settle, people, bill).catch(() => {});
    }, 1000);
    return () => clearTimeout(settledTimerRef.current);
  }, [settled, activeSession?.expenseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [dark, setDark] = useState(() => {
    try {
      return (
        localStorage.getItem("theme") === "dark" ||
        (!localStorage.getItem("theme") && window.matchMedia("(prefers-color-scheme: dark)").matches)
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Compute allSettled early so the redirect effect and nav can use it
  const { mode: settleMode, singleId: settleSingleId, customAmounts: settleCustom, settled: settledMap } = settle;
  const appGrandTotal = Math.round(split.reduce((s, p) => s + p.total, 0) * 100) / 100;
  const appPaymentAmounts =
    settleMode === "single"
      ? settleSingleId
        ? { [settleSingleId]: appGrandTotal }
        : {}
      : settleMode === "own"
        ? Object.fromEntries(split.map((p) => [p.id, p.total]))
        : settleMode === "custom"
          ? settleCustom
          : {};
  const appTxns = simplifyDebts(split, appPaymentAmounts);
  const allSettledApp = appTxns.length > 0 && Object.values(settledMap).filter(Boolean).length === appTxns.length;
  const hasBillItems = bill.items.length > 0;

  // Redirect away from People tab if it becomes hidden
  useEffect(() => {
    if (view === "people" && (allSettledApp || !hasBillItems)) {
      dispatch(splitwiserActions.setView("dashboard"));
    }
  }, [allSettledApp, hasBillItems, view]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTheme() {
    setDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("theme", next ? "dark" : "light");
      } catch {}
      return next;
    });
  }

  function handleSignOut() {
    dispatch(splitwiserActions.setCurrentUser(null));
    dispatch(splitwiserActions.resetCurrentSplit());
  }

  function handleReset() {
    dispatch(splitwiserActions.resetCurrentSplit());
  }

  // Show auth page if not logged in
  if (!currentUser) {
    return <AuthPage onAuth={(user) => dispatch(splitwiserActions.setCurrentUser(user))} />;
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
      dispatch(splitwiserActions.setBill(parsed.items.length ? parsed : { ...parsed, items: emptyBill.items }));
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
      // Create new DB session (replace existing)
      if (activeSession?.groupId) deleteSession(activeSession.groupId).catch(() => {});
      createSession({
        title: parsed.merchant || "Split session",
        createdBy: currentUser.id,
        date: parsed.date,
        notes: JSON.stringify({
          currency: parsed.currency || "INR",
          tax: parsed.tax || 0,
          serviceCharge: parsed.serviceCharge || 0,
          discount: parsed.discount || 0,
        }),
      })
        .then((session) => dispatch(splitwiserActions.setActiveSession(session)))
        .catch(() => {});
    } catch (error) {
      dispatch(splitwiserActions.setStatus({ kind: "error", message: error.message }));
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
      const results = await Promise.all(files.map((f) => analyzeBillWithAi({ file: f })));
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
      // Create new DB session (replace existing)
      if (activeSession?.groupId) deleteSession(activeSession.groupId).catch(() => {});
      createSession({
        title: merged.merchant || "Split session",
        createdBy: currentUser.id,
        date: merged.date,
        notes: JSON.stringify({
          currency: merged.currency || "INR",
          tax: merged.tax || 0,
          serviceCharge: merged.serviceCharge || 0,
          discount: merged.discount || 0,
        }),
      })
        .then((session) => dispatch(splitwiserActions.setActiveSession(session)))
        .catch(() => {});
    } catch (error) {
      dispatch(splitwiserActions.setStatus({ kind: "error", message: error.message }));
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
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Split Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), "Bill Items");
    XLSX.writeFile(wb, `split-iq-${bill.merchant || "bill"}.xlsx`);
  }

  const nav = [
    ["dashboard", Home, "Overview"],
    ["upload", Upload, "Upload"],
    ["split", Split, "Split"],
    ["settle", Wallet, "Settle"],
    ...(!allSettledApp && hasBillItems ? [["people", Users, "People"]] : []),
  ];

  const isLoading = status.kind === "loading";

  return (
    <div className="app-shell">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

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
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
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
            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="ghost" onClick={handleReset}>
              <RotateCcw size={16} /> <span className="btn-label">Reset</span>
            </button>
            <button onClick={exportExcel}>
              <FileSpreadsheet size={16} /> <span className="btn-label">Export</span>
            </button>
            <ProfileBubble user={currentUser} onSignOut={handleSignOut} />
          </div>
        </header>

        {status.kind !== "idle" && !isLoading && (
          <div className={`status ${status.kind}`}>
            {status.kind === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
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
              currentUser={currentUser}
              loading={sessionLoading}
            />
          )}
          {view === "upload" && <UploadView onAnalyze={handleAnalyze} onMerge={handleMerge} loading={isLoading} />}
          {view === "split" &&
            (() => {
              const { mode, singleId, customAmounts, settled: settledMap } = settle;
              const grandTotal = Math.round(split.reduce((s, p) => s + p.total, 0) * 100) / 100;
              const paymentAmounts =
                mode === "single"
                  ? singleId
                    ? { [singleId]: grandTotal }
                    : {}
                  : mode === "own"
                    ? Object.fromEntries(split.map((p) => [p.id, p.total]))
                    : mode === "custom"
                      ? customAmounts
                      : {};
              const txns = simplifyDebts(split, paymentAmounts);
              const allSettled = txns.length > 0 && Object.values(settledMap).filter(Boolean).length === txns.length;
              return (
                <SplitView
                  bill={bill}
                  people={people}
                  split={split}
                  loading={isLoading}
                  insight={insight}
                  insightLoading={insightLoading}
                  locked={allSettled}
                />
              );
            })()}
          {view === "settle" && (
            <SettleView
              split={split}
              bill={bill}
              people={people}
              currentUser={currentUser}
              loading={sessionLoading}
              onShareOpen={(data) => {
                setShareData(data);
                setShareModalOpen(true);
              }}
            />
          )}
          {view === "people" && <PeopleView people={people} currentUser={currentUser} />}
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

function Dashboard({ bill, people, split, setView, currentUser, loading }) {
  const settled = split.filter((p) => p.total > 0);
  const hasBill = bill.items.length > 0;
  const firstName = currentUser?.name?.split(" ")[0] || "";

  if (loading) {
    return (
      <section className="dashboard-grid">
        <div className="hero-panel">
          <div className="hero-copy">
            <div className="skel" style={{ height: 14, width: 120, marginBottom: 10 }} />
            <div className="skel" style={{ height: 36, width: "70%", marginBottom: 8 }} />
            <div className="skel" style={{ height: 14, width: "50%" }} />
          </div>
          <div className="hero-stats" style={{ width: "100%", overflow: "hidden" }}>
            {["Bill total", "Items", "People", "Settling"].map((label) => (
              <div key={label} className="hstat" style={{ flex: 1, minWidth: 0, padding: "12px 8px" }}>
                <div className="skel" style={{ height: 22, width: "100%", maxWidth: 64, marginBottom: 6 }} />
                <span className="hstat-label">{label}</span>
              </div>
            ))}
          </div>
          <div className="skel" style={{ height: 44, width: 160, borderRadius: 10 }} />
        </div>
        <div className="panel wide">
          <div className="section-head">
            <h3>Split preview</h3>
          </div>
          <div className="settlement-list">
            {[1, 2].map((i) => (
              <div key={i} className="settlement-row">
                <span className="name-cell">
                  <div className="skel" style={{ width: 32, height: 32, borderRadius: "50%" }} />
                  <div className="skel" style={{ height: 14, width: 120 }} />
                </span>
                <div className="skel" style={{ flex: 1, height: 8, margin: "0 12px" }} />
                <div className="skel" style={{ height: 14, width: 80 }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-grid">
      <div className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">{firstName ? `Hi, ${firstName} 👋` : "Active session"}</p>
          <h2>{bill.merchant || "Ready to split?"}</h2>
          <p>
            {hasBill
              ? "Review item assignments, adjust splits, and settle up."
              : "Upload a receipt and AI will extract every line item in seconds."}
          </p>
        </div>

        {/* stat row — always visible */}
        <div className="hero-stats">
          <div className="hstat">
            <span className="hstat-val">{formatMoney(bill.total, bill.currency)}</span>
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
                  <div className="settlement-bar" style={{ width: `${pct}%` }} />
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
      const fresh = Array.from(incoming).filter((f) => !existing.has(f.name + f.size));
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
              <span className="uzv2-pill-icon">{f.type.startsWith("image/") ? "🖼️" : "📄"}</span>
              <span className="uzv2-pill-name" title={f.name}>
                {f.name}
              </span>
              <span className="uzv2-pill-size">{(f.size / 1024).toFixed(0)} KB</span>
              <button className="uzv2-pill-remove" onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`}>
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
          <input type="file" accept="image/*,.txt,.csv,.json" multiple onChange={(e) => addFiles(e.target.files)} />
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
          <FilePlus2 size={13} /> Add more files to merge multiple bills into one session
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
            <div className="skel skel-name" style={{ animationDelay: `${i * 80}ms` }} />
            <div className="skel skel-num" style={{ animationDelay: `${i * 80 + 40}ms` }} />
            <div className="skel skel-num" style={{ animationDelay: `${i * 80 + 80}ms` }} />
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

function SplitView({ bill, people, split, loading, insight, insightLoading, locked = false }) {
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
        dispatch(splitwiserActions.toggleAssignee({ itemId: item.id, personId }));
      });
    });
  }

  const unassignedCount = bill.items.filter((i) => i.assignedTo.length === 0).length;

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
            {!locked && (
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
            )}
          </div>
          <div className="form-grid">
            <Field
              label="Merchant"
              value={bill.merchant}
              readOnly={locked}
              onChange={(v) => dispatch(splitwiserActions.updateBill({ merchant: v }))}
            />
            <Field
              label="Date"
              type="date"
              value={bill.date}
              readOnly={locked}
              onChange={(v) => dispatch(splitwiserActions.updateBill({ date: v }))}
            />
            <Field
              label="Currency"
              value={bill.currency}
              readOnly={locked}
              onChange={(v) => dispatch(splitwiserActions.updateBill({ currency: v.toUpperCase() }))}
            />
            <Field
              label="Tax"
              type="number"
              value={bill.tax}
              readOnly={locked}
              onChange={(v) => dispatch(splitwiserActions.updateBill({ tax: normalizeNumber(v) }))}
            />
            <Field
              label="Service charge"
              type="number"
              value={bill.serviceCharge}
              readOnly={locked}
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
              readOnly={locked}
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

          {people.length > 0 && bill.items.length > 0 && !locked && (
            <div className="auto-assign-bar">
              <div className="auto-assign-info">
                {unassignedCount > 0 ? (
                  <>
                    <span className="badge-warn">{unassignedCount} unassigned</span>
                    <span className="muted"> — split unassigned equally among all</span>
                  </>
                ) : (
                  <span className="badge-ok">All items assigned</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-auto" onClick={autoAssignAll}>
                  <Zap size={14} /> Split equally
                </button>
                {/* {people.length >= 2 && (
                  <button
                    className="btn-auto btn-smart"
                    onClick={handleSmartSplit}
                    disabled={smartState?.loading}
                    title="AI assigns items based on names & food type"
                  >
                    <Wand2 size={14} />
                    {smartState?.loading ? "Thinking…" : "Smart assign"}
                  </button>
                )} */}
                <button className="btn-auto ghost-sm" onClick={clearAllAssignees}>
                  <RotateCcw size={13} /> Clear
                </button>
              </div>
            </div>
          )}

          <div className="items">
            {bill.items.length > 1 && <DuplicateWarning items={bill.items} />}
            {smartState?.error && (
              <div className="anomaly-item anomaly-error" style={{ marginBottom: 8 }}>
                <AlertTriangle size={13} />
                <span>Smart assign failed: {smartState.error}</span>
              </div>
            )}
            {bill.items.length === 0 && (
              <EmptyState icon={ReceiptText} title="No items" message="Upload a bill or add line items manually." />
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
                    readOnly={locked}
                    onChange={(e) =>
                      !locked &&
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
                    readOnly={locked}
                    onChange={(e) =>
                      !locked &&
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
                    readOnly={locked}
                    onChange={(e) =>
                      !locked &&
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
                    onClick={() => dispatch(splitwiserActions.removeItem(item.id))}
                    aria-label="Remove"
                    style={locked ? { visibility: "hidden" } : undefined}
                    disabled={locked}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="item-assignees">
                  <span className="item-tag-pill">{getItemTag(item.name)}</span>
                  {people.length === 0 && <span className="muted">Add people to assign.</span>}
                  {people.map((person) => (
                    <label key={person.id} className={item.assignedTo.includes(person.id) ? "chip selected" : "chip"}>
                      <input
                        type="checkbox"
                        checked={item.assignedTo.includes(person.id)}
                        disabled={locked}
                        onChange={() =>
                          !locked &&
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
              const pct = bill.total > 0 ? (person.total / bill.total) * 100 : 0;
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
              item.assignedTo.forEach((pid) => dispatch(splitwiserActions.toggleAssignee({ itemId, personId: pid })));
              personIds.forEach((pid) => dispatch(splitwiserActions.toggleAssignee({ itemId, personId: pid })));
            });
            setSmartState(null);
          }}
          onClose={() => setSmartState(null)}
        />
      )}
    </div>
  );
}

function SettleView({ split, bill, people, onShareOpen, currentUser, loading }) {
  const dispatch = useDispatch();
  const { mode, singleId, customAmounts, settled } = useSelector((s) => s.splitwiser.settle);
  const { activeSession } = useSelector((s) => s.splitwiser);
  const [qrTransaction, setQrTransaction] = useState(null);
  const [noUpiName, setNoUpiName] = useState(null);
  const [saveState, setSaveState] = useState(null); // null | "saving" | { id } | { error }

  const grandTotal = Math.round(split.reduce((s, p) => s + p.total, 0) * 100) / 100;

  const paymentAmounts = useMemo(() => {
    if (mode === "single") return singleId ? { [singleId]: grandTotal } : {};
    if (mode === "own") return Object.fromEntries(split.map((p) => [p.id, p.total]));
    if (mode === "custom") return customAmounts;
    return {};
  }, [mode, singleId, grandTotal, split, customAmounts]);

  const transactions = useMemo(() => simplifyDebts(split, paymentAmounts), [split, paymentAmounts]);
  const totalPaid = Object.values(paymentAmounts).reduce((s, v) => s + normalizeNumber(v), 0);
  const paidDiff = totalPaid - grandTotal;
  const hasEnteredAny = mode === "custom" && Object.values(customAmounts).some((v) => normalizeNumber(v) > 0);
  const hasPayments = mode === "single" ? !!singleId : mode === "own" ? true : hasEnteredAny;
  const settledCount = Object.values(settled).filter(Boolean).length;

  if (loading) {
    return (
      <div className="settle-view">
        <div className="settle-hc">
          <div className="settle-hc-left">
            <div className="skel" style={{ height: 14, width: 160, marginBottom: 10 }} />
            <div className="skel" style={{ height: 28, width: 220, marginBottom: 8 }} />
            <div className="skel" style={{ height: 13, width: 180 }} />
          </div>
        </div>
        <div className="scenario-cards">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skel" style={{ height: 72, borderRadius: 12 }} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {[1, 2].map((i) => (
            <div key={i} className="skel" style={{ height: 64, borderRadius: 12 }} />
          ))}
        </div>
      </div>
    );
  }

  async function handleSaveExpense() {
    setSaveState("saving");
    try {
      const expense = await saveFullExpense({
        bill,
        people,
        split,
        paymentAmounts,
        currentUser,
        expenseId: activeSession?.expenseId,
        groupId: activeSession?.groupId,
      });
      setSaveState({ id: expense.id });
    } catch (e) {
      setSaveState({ error: e.message || "Save failed" });
    }
  }

  function switchMode(next) {
    dispatch(splitwiserActions.setSettleMode(next));
  }

  function setPersonPaid(id, raw) {
    dispatch(
      splitwiserActions.setSettleCustomAmount({
        id,
        value: normalizeNumber(raw),
      }),
    );
  }

  function fillExactShare(id) {
    const share = split.find((p) => p.id === id)?.total ?? 0;
    dispatch(
      splitwiserActions.setSettleCustomAmount({
        id,
        value: Number(share.toFixed(2)),
      }),
    );
  }

  function fillAllExact() {
    dispatch(
      splitwiserActions.setSettleCustomAmounts(
        Object.fromEntries(split.map((p) => [p.id, Number(p.total.toFixed(2))])),
      ),
    );
  }

  function fillAllEqual() {
    const each = people.length ? grandTotal / people.length : 0;
    dispatch(
      splitwiserActions.setSettleCustomAmounts(Object.fromEntries(people.map((p) => [p.id, Number(each.toFixed(2))]))),
    );
  }

  function toggleSettled(key) {
    dispatch(splitwiserActions.toggleSettleTransaction(key));
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

  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isMobile = isAndroid || isIOS;

  function buildGpayLink(upiId, name, amount, currency) {
    const params = `pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name)}&am=${amount.toFixed(2)}&cu=${currency || "INR"}`;
    if (isAndroid)
      return `intent://upi/pay?${params}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`;
    if (isIOS) return `gpay://upi/pay?${params}`;
    return `upi://pay?${params}`;
  }

  function buildUpiLink(upiId, name, amount, currency) {
    const params = `pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name)}&am=${amount.toFixed(2)}&cu=${currency || "INR"}`;
    return `upi://pay?${params}`;
  }

  // Try GPay first; if it doesn't open (app not installed), fall back to generic upi://
  function openUpiWithGpayFallback(gpayLink, upiLink) {
    let fallbackTimer;
    function onVisibilityChange() {
      if (document.hidden) {
        // App launched — cancel fallback
        clearTimeout(fallbackTimer);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    fallbackTimer = setTimeout(() => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.location.href = upiLink;
    }, 1500);
    window.location.href = gpayLink;
  }

  const allSettled = transactions.length > 0 && settledCount === transactions.length;
  const settledAmount = transactions
    .filter((tx) => !!settled[`${tx.from.id}-${tx.to.id}`])
    .reduce((s, tx) => s + tx.amount, 0);
  const remainingAmount = Math.max(0, grandTotal - settledAmount);

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
              {allSettled ? formatMoney(0, bill.currency) : formatMoney(remainingAmount, bill.currency)}
            </div>
            <div className="settle-hc-sub">
              {allSettled
                ? "Nothing to settle — all done!"
                : hasPayments
                  ? `${transactions.length} transfer${transactions.length !== 1 ? "s" : ""} needed · ${settledCount}/${transactions.length} done`
                  : "Pick a scenario below to get started"}
            </div>
          </div>
        </div>
        {!allSettled && (
          <div className="settle-hc-right">
            <div className="settle-progress-wrap">
              <div className="settle-progress-bar">
                <div
                  className="settle-progress-fill"
                  style={{
                    width: hasPayments && transactions.length ? `${(settledCount / transactions.length) * 100}%` : "0%",
                  }}
                />
              </div>
            </div>
            <div className="settle-hc-actions">
              {hasPayments && !(transactions.length > 0 && settledCount === transactions.length) && (
                <button
                  className={`ghost settle-save-btn${saveState?.id ? " saved" : ""}`}
                  onClick={saveState?.error ? () => setSaveState(null) : handleSaveExpense}
                  disabled={saveState === "saving" || !!saveState?.id}
                  title={saveState?.error || undefined}
                >
                  {saveState === "saving" ? (
                    <>
                      <span className="mini-spinner" /> Saving…
                    </>
                  ) : saveState?.id ? (
                    <>
                      <CheckCircle2 size={14} /> Saved
                    </>
                  ) : saveState?.error ? (
                    <>
                      <AlertCircle size={14} /> Retry
                    </>
                  ) : (
                    <>
                      <Zap size={14} /> Save split
                    </>
                  )}
                </button>
              )}
              {!allSettled && (
                <button
                  className="ghost settle-share-btn"
                  onClick={() => onShareOpen({ transactions, paymentAmounts })}
                >
                  <MessageCircle size={15} /> Share
                </button>
              )}
            </div>
            {saveState?.error && <p className="settle-save-error">{saveState.error}</p>}
          </div>
        )}
      </div>

      {/* ── Scenario cards ── */}
      <div className="scenario-grid">
        {SCENARIOS.map(({ id, icon: Icon, title, desc }) => (
          <button
            key={id}
            className={`scenario-card${mode === id ? " active" : ""}${allSettled && mode !== id ? " disabled" : ""}`}
            onClick={() => !allSettled && switchMode(id)}
            disabled={allSettled && mode !== id}
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
            <span>Who paid the full {formatMoney(grandTotal, bill.currency)}?</span>
          </div>
          <div className="settle-single-grid">
            {people.length === 0 && (
              <EmptyState icon={Users} title="No participants" message="Add people in the People tab first." compact />
            )}
            {people.map((p) => {
              const allSettled = transactions.length > 0 && settledCount === transactions.length;
              return (
                <button
                  key={p.id}
                  className={`payer-person-btn${singleId === p.id ? " selected" : ""}${allSettled && singleId !== p.id ? " disabled" : ""}`}
                  onClick={() =>
                    !allSettled && dispatch(splitwiserActions.setSettleSingleId(singleId === p.id ? null : p.id))
                  }
                  disabled={allSettled && singleId !== p.id}
                >
                  <Avatar name={p.name} />
                  <div className="ppb-info">
                    <span className="ppb-name">{p.name}</span>
                    <span className="ppb-amount">{formatMoney(grandTotal, bill.currency)}</span>
                  </div>
                  {singleId === p.id && <Check size={14} className="ppb-check" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Own share: instant confirmation ── */}
      {mode === "own" && (
        <div className="own-share-card panel">
          <div className="own-share-rows">
            {people.length === 0 && (
              <EmptyState icon={Users} title="No participants" message="Add people in the People tab first." compact />
            )}
            {split.map((p) => (
              <div key={p.id} className="own-share-row">
                <Avatar name={p.name} />
                <span className="own-share-name">{p.name}</span>
                <span className="own-share-label">paid their share</span>
                <strong className="own-share-amount">{formatMoney(p.total, bill.currency)}</strong>
                <CheckCircle2 size={15} className="own-share-tick" />
              </div>
            ))}
          </div>
          {people.length > 0 && (
            <p className="own-share-note">
              If anyone actually paid more or less, switch to <strong>Custom amounts</strong> instead.
            </p>
          )}
        </div>
      )}

      {/* ── Custom / Multiple payers ── */}
      {mode === "custom" && (
        <div className="multi-payer-card panel">
          <div className="multi-payer-head">
            <p className="multi-payer-desc">
              For each person, enter how much they <strong>physically paid</strong> (the bill they paid at the counter).
              Leave at <strong>0</strong> if they paid nothing upfront.
            </p>
            <div className="multi-payer-presets">
              {!allSettled && (
                <>
                  <button className="preset-btn" onClick={fillAllExact}>
                    <Zap size={13} /> Everyone paid own share
                  </button>
                  <button className="preset-btn ghost" onClick={fillAllEqual}>
                    <RotateCcw size={13} /> Divide equally
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="payer-table">
            {people.length === 0 && (
              <EmptyState icon={Users} title="No participants" message="Add people in the People tab first." compact />
            )}
            {split.map((p) => {
              const paid = normalizeNumber(customAmounts[p.id] ?? 0);
              const hasPaid = customAmounts[p.id] !== undefined;
              const diff = hasPaid ? paid - p.total : null;
              const chipNone = hasPaid && paid === 0;
              const chipShare = hasPaid && Math.abs(paid - p.total) < 0.5;
              const chipAll = hasPaid && Math.abs(paid - grandTotal) < 0.5 && grandTotal !== p.total;
              return (
                <div key={p.id} className={`payer-row-v2${hasPaid ? " has-value" : ""}`}>
                  {/* top row: avatar + name + input */}
                  <div className="prv2-top">
                    <Avatar name={p.name} />
                    <div className="prv2-person">
                      <span className="prv2-name">{p.name}</span>
                      <span className="prv2-share">owes {formatMoney(p.total, bill.currency)}</span>
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
                        readOnly={allSettled}
                        onChange={allSettled ? undefined : (e) => setPersonPaid(p.id, e.target.value)}
                      />
                    </div>
                    {diff !== null && (
                      <span className={`payer-diff${diff > 0.5 ? " pos" : diff < -0.5 ? " neg" : " zero"}`}>
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
                      disabled={allSettled}
                      onClick={allSettled ? undefined : () => setPersonPaid(p.id, 0)}
                    >
                      Paid nothing
                    </button>
                    <button
                      className={`prv2-chip accent${chipShare ? " active" : ""}`}
                      disabled={allSettled}
                      onClick={allSettled ? undefined : () => fillExactShare(p.id)}
                    >
                      {formatMoney(p.total, bill.currency)} (their share)
                    </button>
                    {grandTotal !== p.total && (
                      <button
                        className={`prv2-chip${chipAll ? " active" : ""}`}
                        disabled={allSettled}
                        onClick={
                          allSettled
                            ? undefined
                            : () =>
                                dispatch(
                                  splitwiserActions.setSettleCustomAmount({
                                    id: p.id,
                                    value: Number(grandTotal.toFixed(2)),
                                  }),
                                )
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
            <div className={`payment-total-row${Math.abs(paidDiff) > 0.5 ? " mismatch" : " match"}`}>
              <span>Total entered</span>
              <span>
                <strong>{formatMoney(totalPaid, bill.currency)}</strong>
                {Math.abs(paidDiff) > 0.5 ? (
                  <span className="payment-diff-label">
                    {paidDiff > 0 ? ` — ₹${paidDiff.toFixed(0)} over` : ` — ₹${(-paidDiff).toFixed(0)} short`}
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
      {hasPayments && split.length > 0 && transactions.length === 0 && settledCount === 0 && (
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

      {/* ── Transaction cards — only unsettled ones ── */}
      {transactions
        .filter((tx) => !settled[`${tx.from.id}-${tx.to.id}`])
        .map((tx, i) => {
          const key = `${tx.from.id}-${tx.to.id}`;
          return (
            <div key={key} className="txn-card" style={{ animationDelay: `${i * 60}ms` }}>
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
                <div className="txn-amount">{formatMoney(tx.amount, bill.currency)}</div>
              </div>
              <div className="txn-actions">
                {(() => {
                  const recipient = people.find((p) => p.id === tx.to.id);
                  const upiId = recipient?.upiId;
                  const gpayLink = upiId ? buildGpayLink(upiId, tx.to.name, tx.amount, bill.currency) : null;
                  const upiLink = upiId ? buildUpiLink(upiId, tx.to.name, tx.amount, bill.currency) : null;
                  const handlePayNow = !upiId
                    ? () => setNoUpiName(tx.to.name)
                    : isMobile && gpayLink
                      ? () => openUpiWithGpayFallback(gpayLink, upiLink)
                      : () => setQrTransaction(tx);
                  return (
                    <button className="txn-pay-btn" onClick={handlePayNow} aria-label="Pay via UPI">
                      <QrCode size={13} /> Pay now
                    </button>
                  );
                })()}
                <button className="txn-settle-btn" onClick={() => toggleSettled(key)}>
                  Mark settled
                </button>
              </div>
            </div>
          );
        })}
      {qrTransaction && (
        <UpiQrModal transaction={qrTransaction} bill={bill} people={people} onClose={() => setQrTransaction(null)} />
      )}
      {noUpiName && (
        <div className="modal-overlay" onClick={() => setNoUpiName(null)}>
          <div className="modal no-upi-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <QrCode size={16} />
                <span>No UPI ID</span>
              </div>
              <button className="icon-btn" onClick={() => setNoUpiName(null)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <div className="no-upi-body">
              <p>
                <strong>{noUpiName}</strong> doesn't have a UPI ID saved yet.
              </p>
              <p className="no-upi-hint">
                Go to the <strong>People</strong> tab and add their UPI ID (e.g. <code>name@okaxis</code>) to enable
                direct payment.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── People ─────────────────── */

function UserSearch({ onAdd, existingSupabaseIds }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const idsKey = existingSupabaseIds.join(",");

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const users = await searchUsers(query);
        setResults(users.filter((u) => !existingSupabaseIds.includes(u.id)));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, idsKey]);

  return (
    <div className="user-search">
      <div className="user-search-input-wrap">
        <Search size={15} />
        <input placeholder="Search people by name to add…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {searching && <span className="user-search-spinner" />}
      </div>
      {results.length > 0 && (
        <div className="user-search-results">
          {results.map((u) => (
            <button
              key={u.id}
              className="user-search-result"
              onClick={() => {
                onAdd(u);
                setQuery("");
                setResults([]);
              }}
            >
              <Avatar name={u.name} />
              <div className="usr-info">
                <span className="usr-name">{u.name}</span>
                <span className="usr-phone">{u.phone_number}</span>
              </div>
              <Plus size={15} />
            </button>
          ))}
        </div>
      )}
      {query.length >= 2 && !searching && results.length === 0 && (
        <p className="user-search-empty">No users found for &ldquo;{query}&rdquo;</p>
      )}
    </div>
  );
}

function PeopleView({ people, currentUser }) {
  const dispatch = useDispatch();

  function handleAddUser(dbUser) {
    if (people.some((p) => p.supabaseId === dbUser.id)) return;
    dispatch(
      splitwiserActions.addPerson({
        name: dbUser.name,
        upiId: dbUser.upi_id || "",
        supabaseId: dbUser.id,
      }),
    );
  }

  return (
    <section className="panel">
      <div className="section-head">
        <h3>Participants</h3>
        {currentUser && !people.some((p) => p.supabaseId === currentUser.id) && (
          <button
            className="ghost"
            style={{ fontSize: 12, minHeight: 32, padding: "0 10px" }}
            onClick={() => handleAddUser(currentUser)}
          >
            <Plus size={13} /> Add me
          </button>
        )}
      </div>
      <UserSearch onAdd={handleAddUser} existingSupabaseIds={people.map((p) => p.supabaseId).filter(Boolean)} />
      <div className="people-grid">
        {people.length === 0 && (
          <EmptyState icon={Users} title="No people added" message="Search and add people who shared the bill." />
        )}
        {people.map((person) => (
          <div className="person-card" key={person.id}>
            <Avatar name={person.name} />
            <div className="person-inputs">
              <span className="person-name-text">{person.name}</span>
              {person.upiId && <span className="person-upi-text">{person.upiId}</span>}
            </div>
            <button
              className="icon-btn danger"
              onClick={() => dispatch(splitwiserActions.removePerson(person.id))}
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

function Field({ label, value, onChange, type = "text", readOnly = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} readOnly={readOnly} onChange={(e) => !readOnly && onChange(e.target.value)} />
    </label>
  );
}

function Avatar({ name, size }) {
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  return (
    <span className="avatar" style={size ? { width: size, height: size, fontSize: size * 0.38 } : undefined}>
      {initials}
    </span>
  );
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
            <textarea className="share-textarea" value={msg} onChange={(e) => setMsg(e.target.value)} rows={7} />
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

/* ─────────────────── UpiQrModal ─────────────────── */

function UpiQrModal({ transaction, bill, people, onClose }) {
  const recipient = people.find((p) => p.id === transaction.to.id);
  const upiId = recipient?.upiId;
  const upiLink = upiId
    ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(transaction.to.name)}&am=${transaction.amount.toFixed(2)}&cu=${bill.currency || "INR"}`
    : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <QrCode size={16} />
            <span>Pay via UPI</span>
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
          <div className="qr-amount-display">{formatMoney(transaction.amount, bill.currency)}</div>
          {upiLink ? (
            <>
              <QRCodeSVG value={upiLink} size={220} />
              <small className="qr-hint">Scan with any UPI app to pay</small>
            </>
          ) : (
            <div className="qr-placeholder" style={{ flexDirection: "column", gap: 8, padding: 16 }}>
              <QrCode size={32} style={{ opacity: 0.4 }} />
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                No UPI ID for <strong>{transaction.to.name}</strong>
              </span>
              <small style={{ color: "var(--text-tertiary)" }}>Add a UPI ID in the People tab</small>
            </div>
          )}
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
        .map((name) => people.find((p) => p.name.toLowerCase().trim() === name.toLowerCase().trim())?.id)
        .filter(Boolean);
      map[s.itemId] = new Set(personIds.length ? personIds : people.map((p) => p.id));
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
        <p className="smart-modal-hint">AI suggested these assignments. Adjust any chips then apply.</p>
        <div className="smart-item-list">
          {suggestions.map((s) => {
            const item = bill.items.find((i) => i.id === s.itemId);
            if (!item) return null;
            const selected = selections[s.itemId] || new Set();
            return (
              <div key={s.itemId} className="smart-item-row">
                <div className="smart-item-top">
                  <span className="smart-item-tag">{getItemTag(item.name)}</span>
                  <div className="smart-item-info">
                    <span className="smart-item-name">{item.name}</span>
                    <span className="smart-item-price">{formatMoney(item.price, bill.currency)}</span>
                  </div>
                  {s.shared && <span className="smart-shared-badge">shared</span>}
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

/* ─────────────────── Profile Bubble ─────────────────── */

function ProfileBubble({ user, onSignOut }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (!e.target.closest(".profile-bubble")) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div className="profile-bubble">
      <button
        className="profile-bubble-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Profile menu"
        aria-expanded={open}
      >
        <Avatar name={user.name} />
      </button>

      {open && (
        <div className="profile-bubble-dropdown">
          <div className="profile-bubble-info">
            <Avatar name={user.name} size={36} />
            <div>
              <p className="profile-bubble-name">{user.name}</p>
              {user.phone_number && <p className="profile-bubble-phone">{user.phone_number}</p>}
              {user.upi_id && <p className="profile-bubble-upi">{user.upi_id}</p>}
            </div>
          </div>
          <div className="profile-bubble-divider" />
          <button
            className="profile-bubble-signout"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Auth Page ─────────────────── */

function AuthPage({ onAuth }) {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function switchMode(m) {
    setMode(m);
    setError("");
    setPhone("");
    setName("");
    setUpiId("");
  }

  function handlePhoneChange(val) {
    // Allow only digits, max 10
    const digits = val.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
  }

  function fullPhone() {
    return phone.trim() ? `+91${phone.trim()}` : "";
  }

  async function handleSignIn(e) {
    e.preventDefault();
    if (phone.length !== 10) return setError("Enter a valid 10-digit phone number.");
    setLoading(true);
    setError("");
    try {
      const user = await signIn(fullPhone());
      if (!user) {
        setError("No account found with this number. Please sign up.");
        setMode("signup");
      } else {
        onAuth(user);
      }
    } catch (err) {
      setError(err.message || "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required.");
    if (phone.length !== 10) return setError("Enter a valid 10-digit phone number.");
    setLoading(true);
    setError("");
    try {
      const user = await signUp({ name: name.trim(), phone_number: fullPhone(), upi_id: upiId.trim() });
      onAuth(user);
    } catch (err) {
      setError(err.message || "Sign up failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        {/* Brand */}
        <div className="auth-brand">
          <div className="brand-mark">
            <ReceiptText size={22} />
          </div>
          <div className="brand-text">
            <strong>Split-IQ</strong>
            <span>Bill splitting AI</span>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab${mode === "signin" ? " active" : ""}`}
            onClick={() => switchMode("signin")}
          >
            <LogIn size={15} /> Sign In
          </button>
          <button
            type="button"
            className={`auth-tab${mode === "signup" ? " active" : ""}`}
            onClick={() => switchMode("signup")}
          >
            <UserPlus size={15} /> Sign Up
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="auth-error">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        {/* Sign In Form */}
        {mode === "signin" && (
          <form className="auth-form" onSubmit={handleSignIn}>
            <p className="auth-subtitle">Welcome back! Enter your phone number to continue.</p>
            <div className="auth-field">
              <label htmlFor="si-phone">Phone number</label>
              <div className="auth-input-wrap auth-phone-wrap">
                <span className="auth-phone-prefix">+91</span>
                <input
                  id="si-phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="98765 43210"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  autoFocus
                  autoComplete="tel"
                />
              </div>
              <span className="auth-field-hint">{phone.length}/10 digits</span>
            </div>
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? (
                <span className="auth-spinner" />
              ) : (
                <>
                  <LogIn size={16} /> Sign In
                </>
              )}
            </button>
            <p className="auth-switch">
              New here?{" "}
              <button type="button" className="auth-link" onClick={() => switchMode("signup")}>
                Create an account
              </button>
            </p>
          </form>
        )}

        {/* Sign Up Form */}
        {mode === "signup" && (
          <form className="auth-form" onSubmit={handleSignUp}>
            <p className="auth-subtitle">Create your account to start splitting bills with friends.</p>
            <div className="auth-field">
              <label htmlFor="su-name">Full name</label>
              <div className="auth-input-wrap">
                <Users size={16} className="auth-input-icon" />
                <input
                  id="su-name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  autoComplete="name"
                />
              </div>
            </div>
            <div className="auth-field">
              <label htmlFor="su-phone">Phone number</label>
              <div className="auth-input-wrap auth-phone-wrap">
                <span className="auth-phone-prefix">+91</span>
                <input
                  id="su-phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="98765 43210"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  autoComplete="tel"
                />
              </div>
              <span className="auth-field-hint">{phone.length}/10 digits</span>
            </div>
            <div className="auth-field">
              <label htmlFor="su-upi">
                UPI ID <span className="auth-optional">(optional)</span>
              </label>
              <div className="auth-input-wrap">
                <Banknote size={16} className="auth-input-icon" />
                <input
                  id="su-upi"
                  type="text"
                  placeholder="yourname@upi"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? (
                <span className="auth-spinner" />
              ) : (
                <>
                  <UserPlus size={16} /> Create Account
                </>
              )}
            </button>
            <p className="auth-switch">
              Already have an account?{" "}
              <button type="button" className="auth-link" onClick={() => switchMode("signin")}>
                Sign in
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default App;
