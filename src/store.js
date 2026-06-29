import { configureStore, createSlice } from "@reduxjs/toolkit";

export const emptyBill = {
  merchant: "",
  date: "",
  currency: "INR",
  subtotal: 0,
  tax: 0,
  serviceCharge: 0,
  discount: 0,
  total: 0,
  items: [],
};

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recalculateBill(nextBill) {
  const subtotal = nextBill.items.reduce((sum, item) => sum + normalizeNumber(item.price), 0);
  return {
    ...nextBill,
    subtotal,
    total:
      subtotal +
      normalizeNumber(nextBill.tax) +
      normalizeNumber(nextBill.serviceCharge) -
      normalizeNumber(nextBill.discount),
  };
}

const appSlice = createSlice({
  name: "splitwiser",
  initialState: {
    view: "dashboard",
    people: [],
    bill: emptyBill,
    insight: null,
    insightLoading: false,
    status: {
      kind: "idle",
      message: "",
    },
    settle: {
      mode: null,
      singleId: null,
      customAmounts: {},
      settled: {},
    },
    currentUser: (() => {
      try {
        const s = localStorage.getItem("splitiq_user");
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    })(),
    activeSession: (() => {
      try {
        const s = localStorage.getItem("splitiq_active_session");
        return s ? JSON.parse(s) : { expenseId: null, groupId: null };
      } catch {
        return { expenseId: null, groupId: null };
      }
    })(),
  },
  reducers: {
    setView(state, action) {
      state.view = action.payload;
    },
    setCurrentUser(state, action) {
      state.currentUser = action.payload;
      try {
        if (action.payload) {
          localStorage.setItem("splitiq_user", JSON.stringify(action.payload));
        } else {
          localStorage.removeItem("splitiq_user");
        }
      } catch {}
    },
    setActiveSession(state, action) {
      state.activeSession = action.payload || { expenseId: null, groupId: null };
      try {
        if (action.payload?.expenseId) {
          localStorage.setItem("splitiq_active_session", JSON.stringify(action.payload));
        } else {
          localStorage.removeItem("splitiq_active_session");
        }
      } catch {}
    },
    setStatus(state, action) {
      state.status = action.payload;
    },
    setBill(state, action) {
      state.bill = recalculateBill(action.payload);
    },
    updateBill(state, action) {
      state.bill = recalculateBill({ ...state.bill, ...action.payload });
    },
    addItem(state) {
      state.bill = recalculateBill({
        ...state.bill,
        items: [
          ...state.bill.items,
          {
            id: crypto.randomUUID(),
            name: "",
            quantity: 1,
            price: 0,
            assignedTo: [],
          },
        ],
      });
    },
    updateItem(state, action) {
      const { id, patch } = action.payload;
      state.bill = recalculateBill({
        ...state.bill,
        items: state.bill.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      });
    },
    removeItem(state, action) {
      state.bill = recalculateBill({
        ...state.bill,
        items: state.bill.items.filter((item) => item.id !== action.payload),
      });
    },
    toggleAssignee(state, action) {
      const { itemId, personId } = action.payload;
      state.bill.items = state.bill.items.map((item) => {
        if (item.id !== itemId) return item;
        const assignedTo = item.assignedTo.includes(personId)
          ? item.assignedTo.filter((id) => id !== personId)
          : [...item.assignedTo, personId];
        return { ...item, assignedTo };
      });
    },
    addPerson(state, action) {
      const payload = action.payload;
      const name = (typeof payload === "string" ? payload : payload.name || "")?.trim();
      const upiId = (typeof payload === "string" ? "" : payload.upiId || "")?.trim();
      const supabaseId = typeof payload === "object" ? payload.supabaseId || null : null;
      // Preserve id if provided (e.g. from loadSession) so settle singleId mapping stays valid
      const id = typeof payload === "object" && payload.id ? payload.id : crypto.randomUUID();
      if (!name) return;
      // Prevent duplicates: skip if a person with the same supabaseId already exists
      if (supabaseId && state.people.some((p) => p.supabaseId === supabaseId)) return;
      state.people.push({ id, name, upiId, supabaseId });
    },
    updatePerson(state, action) {
      const { id, ...fields } = action.payload;
      state.people = state.people.map((person) => (person.id === id ? { ...person, ...fields } : person));
    },
    removePerson(state, action) {
      const id = action.payload;
      state.people = state.people.filter((person) => person.id !== id);
      state.bill.items = state.bill.items.map((item) => ({
        ...item,
        assignedTo: item.assignedTo.filter((personId) => personId !== id),
      }));
    },
    resetCurrentSplit(state) {
      state.people = [];
      state.bill = emptyBill;
      state.insight = null;
      state.insightLoading = false;
      state.status = { kind: "idle", message: "" };
      state.settle = {
        mode: null,
        singleId: null,
        customAmounts: {},
        settled: {},
      };
      // Keep activeSession so a page reload still fetches data from API
    },
    setInsight(state, action) {
      state.insight = action.payload;
    },
    setInsightLoading(state, action) {
      state.insightLoading = action.payload;
    },
    setSettleMode(state, action) {
      state.settle = {
        mode: action.payload,
        singleId: null,
        customAmounts: {},
        settled: {},
      };
    },
    restoreSettle(state, action) {
      // Atomically restore settle state without wiping singleId/customAmounts
      const { mode, singleId, customAmounts, settled } = action.payload || {};
      state.settle = {
        mode: mode || null,
        singleId: singleId || null,
        customAmounts: customAmounts || {},
        settled: settled || {},
      };
    },
    setSettleSingleId(state, action) {
      state.settle.singleId = action.payload;
    },
    setSettleCustomAmount(state, action) {
      const { id, value } = action.payload;
      state.settle.customAmounts[id] = value;
    },
    setSettleCustomAmounts(state, action) {
      state.settle.customAmounts = action.payload;
    },
    toggleSettleTransaction(state, action) {
      const key = action.payload;
      state.settle.settled[key] = !state.settle.settled[key];
    },
  },
});

export const splitwiserActions = appSlice.actions;

export const store = configureStore({
  reducer: {
    splitwiser: appSlice.reducer,
  },
});