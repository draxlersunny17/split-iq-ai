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
  const subtotal = nextBill.items.reduce(
    (sum, item) => sum + normalizeNumber(item.price),
    0,
  );
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
      settled: {}
    }
  },
  reducers: {
    setView(state, action) {
      state.view = action.payload;
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
        items: state.bill.items.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
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
      const name = action.payload.trim();
      if (name) {
        state.people.push({ id: crypto.randomUUID(), name });
      }
    },
    updatePerson(state, action) {
      const { id, name } = action.payload;
      state.people = state.people.map((person) =>
        person.id === id ? { ...person, name } : person,
      );
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
        settled: {}
      }
    },
    setInsight(state, action) {
      state.insight = action.payload;
    },
    setInsightLoading(state, action) {
      state.insightLoading = action.payload;
    },
    setSettleMode(state, action) {
      state.settle = {mode: action.payload, singleId: null, customAmounts: {}, settled: {}};
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
    }
  },
});

export const splitwiserActions = appSlice.actions;

export const store = configureStore({
  reducer: {
    splitwiser: appSlice.reducer,
  },
});
