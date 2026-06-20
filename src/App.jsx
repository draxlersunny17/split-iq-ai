import React, { useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ChefHat,
  CircleDollarSign,
  FileSpreadsheet,
  Home,
  Loader2,
  Plus,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Split,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import * as XLSX from "xlsx";
import { emptyBill, splitwiserActions } from "./store";

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    date: String(parsed.date || ""),
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
  const personTotals = Object.fromEntries(
    people.map((person) => [person.id, 0]),
  );
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
      : people.map((person) => person.id);
    const baseShare = splitAmount(item.price, assignees);
    const itemRatio = subtotal > 0 ? normalizeNumber(item.price) / subtotal : 0;
    const extraShare = splitAmount(extras * itemRatio, assignees);
    assignees.forEach((id) => {
      personTotals[id] =
        normalizeNumber(personTotals[id]) + baseShare + extraShare;
    });
  });

  return people.map((person) => ({
    ...person,
    total: personTotals[person.id] || 0,
    items: bill.items.filter(
      (item) => !item.assignedTo?.length || item.assignedTo.includes(person.id),
    ),
  }));
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function analyzeBillWithAi({ file }) {
  const fileData = await fileToDataUrl(file);

  const response = await fetch("/api/analyze-bill", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileData,
      fileType: file.type,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "{}";

  const jsonText = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return sanitizeParsedBill(JSON.parse(jsonText));
}

function App() {
  const dispatch = useDispatch();
  const { view, people, bill, status } = useSelector(
    (state) => state.splitwiser,
  );
  const split = useMemo(() => calculateSplit(bill, people), [bill, people]);

  function setView(nextView) {
    dispatch(splitwiserActions.setView(nextView));
  }

  async function handleAnalyze(file) {
    if (!file) return;
    dispatch(
      splitwiserActions.setStatus({
        kind: "loading",
        message: "Reading bill with AI...",
      }),
    );
    try {
      const parsed = await analyzeBillWithAi({ file });
      dispatch(
        splitwiserActions.setBill(
          parsed.items.length ? parsed : { ...parsed, items: emptyBill.items },
        ),
      );
      dispatch(splitwiserActions.setView("split"));
      dispatch(
        splitwiserActions.setStatus({
          kind: "success",
          message: "Bill parsed. Review items and assign who had what.",
        }),
      );
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
          message: "Add a real bill and at least one person before exporting.",
        }),
      );
      return;
    }

    const rows = split.map((person) => ({
      Person: person.name,
      Amount: Number(person.total.toFixed(2)),
      Items: person.items.map((item) => item.name).join(", "),
    }));
    const itemRows = bill.items.map((item) => ({
      Item: item.name,
      Quantity: item.quantity,
      Price: item.price,
      AssignedTo: item.assignedTo.length
        ? item.assignedTo
            .map((id) => people.find((person) => person.id === id)?.name)
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
    XLSX.writeFile(wb, `splitwiser-${bill.merchant || "bill"}.xlsx`);
  }

  const nav = [
    ["dashboard", Home, "Dashboard"],
    ["upload", Upload, "Upload"],
    ["split", Split, "Split"],
    ["people", Users, "People"],
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ReceiptText size={24} />
          </div>
          <div>
            <strong>Splitwiser AI</strong>
            <span>Smart bill splitting</span>
          </div>
        </div>
        <div className="side-note">
          <ShieldCheck size={16} />
          <span>Session-only workspace</span>
        </div>
        <nav>
          {nav.map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Professional expense settlement</p>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="actions">
            <button
              className="ghost"
              onClick={() => dispatch(splitwiserActions.resetCurrentSplit())}
            >
              <RotateCcw size={18} /> Reset
            </button>
            <button onClick={exportExcel}>
              <FileSpreadsheet size={18} /> Export Excel
            </button>
          </div>
        </header>

        {status.kind !== "idle" && (
          <div className={`status ${status.kind}`}>
            {status.kind === "loading" ? (
              <Loader2 className="spin" size={18} />
            ) : status.kind === "error" ? (
              <AlertCircle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
            <span>{status.message}</span>
          </div>
        )}

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
            loading={status.kind === "loading"}
          />
        )}
        {view === "split" && (
          <SplitView bill={bill} people={people} split={split} />
        )}
        {view === "people" && <PeopleView people={people} />}
      </main>
    </div>
  );
}

function viewTitle(view) {
  return {
    dashboard: "Control center",
    upload: "Upload bill",
    split: "Assign and split",
    people: "People",
  }[view];
}

function Dashboard({ bill, people, split, setView }) {
  const settled = split.filter((person) => person.total > 0);
  const hasBill = bill.items.length > 0;
  return (
    <section className="dashboard-grid">
      <div className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Current bill</p>
          <h2>{bill.merchant || "Ready for a real bill"}</h2>
          <p>
            {hasBill
              ? "Review assignments, export the split, and settle with confidence."
              : "Upload a receipt and add participants to begin a live split."}
          </p>
        </div>
        <div className="hero-total">
          <span>Total</span>
          <strong>{formatMoney(bill.total, bill.currency)}</strong>
          <small>
            {people.length} people · {bill.items.length} items
          </small>
        </div>
        <button onClick={() => setView("upload")}>
          Analyze a bill <ArrowRight size={18} />
        </button>
      </div>
      <Metric
        icon={ReceiptText}
        label="Bill total"
        value={formatMoney(bill.total, bill.currency)}
      />
      <Metric icon={ChefHat} label="Line items" value={bill.items.length} />
      <Metric icon={Users} label="People" value={people.length} />
      <Metric icon={BarChart3} label="Owing" value={settled.length} />
      <div className="panel wide">
        <div className="section-head">
          <h3>Live split preview</h3>
          <span>{bill.currency}</span>
        </div>
        <div className="settlement-list">
          {people.length === 0 && (
            <EmptyState
              icon={Users}
              title="No participants yet"
              message="Add people and upload a bill to calculate the split."
            />
          )}
          {split.map((person) => (
            <div key={person.id} className="settlement-row">
              <span>
                <Avatar name={person.name} /> {person.name}
              </span>
              <strong>{formatMoney(person.total, bill.currency)}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function UploadView({ onAnalyze, loading }) {
  return (
    <section className="panel upload-zone">
      <div className="upload-icon">
        <Bot size={34} />
      </div>
      <div>
        <h2>Upload receipt, invoice, or bill text</h2>
        <p>
          Upload a receipt and let Splitwiser AI extract items, totals, taxes,
          and charges for review.
        </p>
      </div>
      <label className="file-picker">
        <Upload size={20} />
        <span>{loading ? "Analyzing..." : "Choose bill file"}</span>
        <input
          disabled={loading}
          type="file"
          accept="image/*,.txt,.csv,.json"
          onChange={(event) => onAnalyze(event.target.files?.[0])}
        />
      </label>
      <div className="upload-meta">
        <span>PNG/JPG</span>
        <span>TXT</span>
        <span>CSV/JSON</span>
      </div>
    </section>
  );
}

function SplitView({ bill, people, split }) {
  const dispatch = useDispatch();

  return (
    <div className="split-layout">
      <section className="panel">
        <div className="section-head">
          <h3>Bill details</h3>
          <button
            className="icon-btn"
            onClick={() => dispatch(splitwiserActions.addItem())}
            aria-label="Add item"
            title="Add item"
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="form-grid">
          <Field
            label="Merchant"
            value={bill.merchant}
            onChange={(value) =>
              dispatch(splitwiserActions.updateBill({ merchant: value }))
            }
          />
          <Field
            label="Date"
            type="date"
            value={bill.date}
            onChange={(value) =>
              dispatch(splitwiserActions.updateBill({ date: value }))
            }
          />
          <Field
            label="Currency"
            value={bill.currency}
            onChange={(value) =>
              dispatch(
                splitwiserActions.updateBill({ currency: value.toUpperCase() }),
              )
            }
          />
          <Field
            label="Tax"
            type="number"
            value={bill.tax}
            onChange={(value) =>
              dispatch(
                splitwiserActions.updateBill({ tax: normalizeNumber(value) }),
              )
            }
          />
          <Field
            label="Service"
            type="number"
            value={bill.serviceCharge}
            onChange={(value) =>
              dispatch(
                splitwiserActions.updateBill({
                  serviceCharge: normalizeNumber(value),
                }),
              )
            }
          />
          <Field
            label="Discount"
            type="number"
            value={bill.discount}
            onChange={(value) =>
              dispatch(
                splitwiserActions.updateBill({
                  discount: normalizeNumber(value),
                }),
              )
            }
          />
        </div>
        <div className="items">
          {bill.items.length === 0 && (
            <EmptyState
              icon={ReceiptText}
              title="No bill items yet"
              message="Upload a bill or add line items manually."
            />
          )}
          {bill.items.length > 0 && (
            <div className="item-header">
              <span>Item</span>
              <span>Qty</span>
              <span>Amount</span>
              <span></span>
            </div>
          )}
          {bill.items.map((item) => (
            <div key={item.id} className="item-row">
              <input
                placeholder="Item name"
                value={item.name}
                onChange={(event) =>
                  dispatch(
                    splitwiserActions.updateItem({
                      id: item.id,
                      patch: { name: event.target.value },
                    }),
                  )
                }
              />
              <input
                type="number"
                value={item.quantity}
                onChange={(event) =>
                  dispatch(
                    splitwiserActions.updateItem({
                      id: item.id,
                      patch: { quantity: normalizeNumber(event.target.value) },
                    }),
                  )
                }
              />
              <input
                type="number"
                value={item.price}
                onChange={(event) =>
                  dispatch(
                    splitwiserActions.updateItem({
                      id: item.id,
                      patch: { price: normalizeNumber(event.target.value) },
                    }),
                  )
                }
              />
              <button
                className="icon-btn danger"
                onClick={() => dispatch(splitwiserActions.removeItem(item.id))}
                aria-label="Remove item"
                title="Remove item"
              >
                <Trash2 size={16} />
              </button>
              <div className="assignees">
                {people.length === 0 && (
                  <span className="muted">Add people to assign this item.</span>
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
      <section className="panel">
        <div className="section-head">
          <h3>Who pays what</h3>
          <span>{formatMoney(bill.total, bill.currency)}</span>
        </div>
        <div className="settlement-list">
          {people.length === 0 && (
            <EmptyState
              icon={CircleDollarSign}
              title="Nothing to settle"
              message="Add participants to see individual balances."
              compact
            />
          )}
          {split.map((person) => (
            <div key={person.id} className="pay-card">
              <div>
                <span>
                  <Avatar name={person.name} /> {person.name}
                </span>
                <small>{person.items.length} assigned items</small>
              </div>
              <strong>{formatMoney(person.total, bill.currency)}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PeopleView({ people }) {
  const dispatch = useDispatch();
  const [newName, setNewName] = useState("");

  function addPerson(event) {
    event.preventDefault();
    dispatch(splitwiserActions.addPerson(newName));
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
            onChange={(event) => setNewName(event.target.value)}
          />
          <button type="submit">
            <Plus size={18} /> Add
          </button>
        </form>
      </div>
      <div className="people-grid">
        {people.length === 0 && (
          <EmptyState
            icon={Users}
            title="No people added"
            message="Add the people who shared this bill."
          />
        )}
        {people.map((person) => (
          <div className="person-card" key={person.id}>
            <Users size={20} />
            <input
              value={person.name}
              onChange={(event) =>
                dispatch(
                  splitwiserActions.updatePerson({
                    id: person.id,
                    name: event.target.value,
                  }),
                )
              }
            />
            <button
              className="icon-btn danger"
              onClick={() =>
                dispatch(splitwiserActions.removePerson(person.id))
              }
              aria-label="Remove person"
              title="Remove person"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Avatar({ name }) {
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";

  return <span className="avatar">{initials}</span>;
}

function EmptyState({ icon: Icon, title, message, compact = false }) {
  return (
    <div className={compact ? "empty-state compact" : "empty-state"}>
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

export default App;
