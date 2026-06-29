import { supabase } from "./supabaseClient";

// ─────────────────── AUTH ───────────────────

/**
 * Sign in with phone number.
 * Returns the user if found, null if not registered.
 */
export async function signIn(phone_number) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("phone_number", phone_number.trim())
    .maybeSingle();
  if (error) throw error;
  return data; // null if not found
}

/**
 * Sign up — creates a new user.
 * Throws if phone number already exists.
 */
export async function signUp({ name, phone_number, upi_id }) {
  const { data, error } = await supabase
    .from("users")
    .insert([{ name: name.trim(), phone_number: phone_number.trim(), upi_id: upi_id?.trim() || null }])
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Phone number already registered. Please sign in.");
    throw error;
  }
  return data;
}

// ─────────────────── USERS ───────────────────

export async function getUserByPhone(phone_number) {
  const { data, error } = await supabase.from("users").select("*").eq("phone_number", phone_number).single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function createUser({ name, phone_number, upi_id }) {
  const { data, error } = await supabase.from("users").insert([{ name, phone_number, upi_id }]).select().single();
  if (error) throw error;
  return data;
}

export async function upsertUser({ name, phone_number, upi_id }) {
  const { data, error } = await supabase
    .from("users")
    .upsert([{ name, phone_number, upi_id }], { onConflict: "phone_number" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateUser(id, fields) {
  const { data, error } = await supabase.from("users").update(fields).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

// ─────────────────── EXPENSE GROUPS ───────────────────

export async function createExpenseGroup({ title, description, created_by }) {
  const { data, error } = await supabase
    .from("expense_groups")
    .insert([{ title, description, created_by }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getExpenseGroups(user_id) {
  const { data, error } = await supabase.from("group_members").select("expense_groups(*)").eq("user_id", user_id);
  if (error) throw error;
  return data.map((row) => row.expense_groups);
}

export async function getExpenseGroupById(group_id) {
  const { data, error } = await supabase.from("expense_groups").select("*").eq("id", group_id).single();
  if (error) throw error;
  return data;
}

export async function deleteExpenseGroup(group_id) {
  const { error } = await supabase.from("expense_groups").delete().eq("id", group_id);
  if (error) throw error;
}

// ─────────────────── GROUP MEMBERS ───────────────────

export async function addGroupMember(group_id, user_id) {
  const { data, error } = await supabase.from("group_members").insert([{ group_id, user_id }]).select().single();
  if (error) throw error;
  return data;
}

export async function getGroupMembers(group_id) {
  const { data, error } = await supabase.from("group_members").select("users(*)").eq("group_id", group_id);
  if (error) throw error;
  return data.map((row) => row.users);
}

export async function removeGroupMember(group_id, user_id) {
  const { error } = await supabase.from("group_members").delete().eq("group_id", group_id).eq("user_id", user_id);
  if (error) throw error;
}

// ─────────────────── EXPENSES ───────────────────

export async function createExpense({ group_id, title, total_amount, notes, created_by, expense_date }) {
  const { data, error } = await supabase
    .from("expenses")
    .insert([{ group_id, title, total_amount, notes, created_by, expense_date }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getExpensesByGroup(group_id) {
  const { data, error } = await supabase
    .from("expenses")
    .select(
      `*, expense_payers(*, users(*)), expense_participants(*, users(*)), food_items(*, food_item_consumers(*, users(*)))`,
    )
    .eq("group_id", group_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getExpenseById(expense_id) {
  const { data, error } = await supabase
    .from("expenses")
    .select(
      `*, expense_payers(*, users(*)), expense_participants(*, users(*)), food_items(*, food_item_consumers(*, users(*)))`,
    )
    .eq("id", expense_id)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteExpense(expense_id) {
  const { error } = await supabase.from("expenses").delete().eq("id", expense_id);
  if (error) throw error;
}

// ─────────────────── EXPENSE PAYERS ───────────────────

export async function addExpensePayer(expense_id, user_id, paid_amount) {
  const { data, error } = await supabase
    .from("expense_payers")
    .insert([{ expense_id, user_id, paid_amount }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addExpensePayers(payers) {
  // payers: [{ expense_id, user_id, paid_amount }]
  const { data, error } = await supabase.from("expense_payers").insert(payers).select();
  if (error) throw error;
  return data;
}

// ─────────────────── EXPENSE PARTICIPANTS ───────────────────

export async function addExpenseParticipant(expense_id, user_id, owed_amount) {
  const { data, error } = await supabase
    .from("expense_participants")
    .insert([{ expense_id, user_id, owed_amount }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addExpenseParticipants(participants) {
  // participants: [{ expense_id, user_id, owed_amount }]
  const { data, error } = await supabase.from("expense_participants").insert(participants).select();
  if (error) throw error;
  return data;
}

// ─────────────────── FOOD ITEMS ───────────────────

export async function addFoodItem(expense_id, item_name, item_cost) {
  const { data, error } = await supabase
    .from("food_items")
    .insert([{ expense_id, item_name, item_cost }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addFoodItems(items) {
  // items: [{ expense_id, item_name, item_cost }]
  const { data, error } = await supabase.from("food_items").insert(items).select();
  if (error) throw error;
  return data;
}

// ─────────────────── FOOD ITEM CONSUMERS ───────────────────

export async function addFoodItemConsumer(food_item_id, user_id) {
  const { data, error } = await supabase
    .from("food_item_consumers")
    .insert([{ food_item_id, user_id }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addFoodItemConsumers(consumers) {
  // consumers: [{ food_item_id, user_id }]
  const { data, error } = await supabase.from("food_item_consumers").insert(consumers).select();
  if (error) throw error;
  return data;
}

// ─────────────────── SETTLEMENTS ───────────────────

export async function createSettlement({
  group_id,
  payer_id,
  receiver_id,
  amount,
  payment_method,
  transaction_reference,
}) {
  const { data, error } = await supabase
    .from("settlements")
    .insert([
      {
        group_id,
        payer_id,
        receiver_id,
        amount,
        payment_method,
        transaction_reference,
      },
    ])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getSettlementsByGroup(group_id) {
  const { data, error } = await supabase
    .from("settlements")
    .select(`*, payer:users!payer_id(*), receiver:users!receiver_id(*)`)
    .eq("group_id", group_id)
    .order("settled_at", { ascending: false });
  if (error) throw error;
  return data;
}

// ─────────────────── SAVE FULL SPLIT SESSION ───────────────────
/**
 * Saves an entire Split-IQ session to Supabase in one call.
 * Maps the local Redux state (people + bill) to the DB schema.
 *
 * @param {{ people: Array, bill: Object, groupId: string }} params
 * @returns {Promise<{ expense: Object }>}
 */
export async function saveSplitSession({ people, bill, groupId, createdBy }) {
  // 1. Create the expense record
  const expense = await createExpense({
    group_id: groupId,
    title: bill.merchant || "Untitled Expense",
    total_amount: bill.total,
    notes: bill.currency !== "INR" ? `Currency: ${bill.currency}` : null,
    created_by: createdBy,
    expense_date: bill.date || new Date().toISOString().split("T")[0],
  });

  // 2. Save food items and their consumers
  if (bill.items && bill.items.length > 0) {
    const foodItemRecords = await addFoodItems(
      bill.items.map((item) => ({
        expense_id: expense.id,
        item_name: item.name || "Item",
        item_cost: item.price,
      })),
    );

    const consumers = [];
    bill.items.forEach((item, idx) => {
      const foodItemId = foodItemRecords[idx]?.id;
      if (!foodItemId) return;
      (item.assignedTo || []).forEach((personId) => {
        const person = people.find((p) => p.id === personId);
        if (person?.supabaseId) {
          consumers.push({ food_item_id: foodItemId, user_id: person.supabaseId });
        }
      });
    });

    if (consumers.length > 0) {
      await addFoodItemConsumers(consumers);
    }
  }

  // 3. Save expense participants (who owes what)
  const participantMap = {};
  bill.items.forEach((item) => {
    if (!item.assignedTo || item.assignedTo.length === 0) return;
    const share = item.price / item.assignedTo.length;
    item.assignedTo.forEach((personId) => {
      participantMap[personId] = (participantMap[personId] || 0) + share;
    });
  });

  const participants = Object.entries(participantMap)
    .map(([personId, owed]) => {
      const person = people.find((p) => p.id === personId);
      return person?.supabaseId ? { expense_id: expense.id, user_id: person.supabaseId, owed_amount: owed } : null;
    })
    .filter(Boolean);

  if (participants.length > 0) {
    await addExpenseParticipants(participants);
  }

  return { expense };
}

// ─────────────────── SEARCH USERS ───────────────────

export async function searchUsers(query) {
  if (!query || query.length < 2) return [];
  const { data, error } = await supabase
    .from("users")
    .select("id, name, phone_number, upi_id")
    .ilike("name", `%${query}%`)
    .limit(10);
  if (error) throw error;
  return data || [];
}

// ─────────────────── SAVE FULL EXPENSE ───────────────────
/**
 * Saves a complete split session to Supabase:
 * expense → food_items → food_item_consumers → expense_participants → expense_payers
 *
 * @param {{ bill, people, split, paymentAmounts, currentUser }} params
 *   people  — Redux people array, each with { id, name, upiId, supabaseId }
 *   split   — Array of { id, name, total } (per-person owed totals from SettleView)
 *   paymentAmounts — { [localPersonId]: amount } (who paid how much)
 */
/**
 * Saves the final settled state of a split session to Supabase.
 * If expenseId is provided (active session), reuses that expense and overwrites
 * participants/payers. Otherwise creates a new standalone expense.
 *
 * Throws if any participant or payer is missing a supabaseId.
 */
export async function saveFullExpense({
  bill,
  people,
  split,
  paymentAmounts,
  currentUser,
  expenseId: existingExpenseId,
  groupId: existingGroupId,
}) {
  let expenseId = existingExpenseId;

  if (expenseId) {
    // Update metadata on the existing session expense
    await supabase
      .from("expenses")
      .update({
        title: bill.merchant || "Split expense",
        total_amount: bill.total,
        expense_date: bill.date || new Date().toISOString().split("T")[0],
      })
      .eq("id", expenseId);
  } else {
    // No active session – create a one-off expense (group_id nullable)
    const expense = await createExpense({
      group_id: existingGroupId || null,
      title: bill.merchant || "Split expense",
      total_amount: bill.total,
      notes: bill.currency && bill.currency !== "INR" ? `Currency: ${bill.currency}` : null,
      created_by: currentUser.id,
      expense_date: bill.date || new Date().toISOString().split("T")[0],
    });
    expenseId = expense.id;
  }

  // ── Participants (who owes what) ─────────────────────────────
  // split entries already spread supabaseId from people via calculateSplit
  const missingIds = split.filter((p) => p.total > 0.005 && !p.supabaseId).map((p) => p.name);
  if (missingIds.length > 0) {
    throw new Error(
      `Cannot save: missing Supabase user links for ${missingIds.join(", ")}. Re-add them from People tab.`,
    );
  }

  // Clear existing records first (safe to call even if none exist)
  const { error: delPErr } = await supabase.from("expense_participants").delete().eq("expense_id", expenseId);
  if (delPErr) throw new Error(`Failed to clear old participants: ${delPErr.message}`);
  const { error: delPayErr } = await supabase.from("expense_payers").delete().eq("expense_id", expenseId);
  if (delPayErr) throw new Error(`Failed to clear old payers: ${delPayErr.message}`);

  const participants = split
    .filter((p) => p.total > 0.005 && p.supabaseId)
    .map((p) => ({
      expense_id: expenseId,
      user_id: p.supabaseId,
      owed_amount: Number(p.total.toFixed(2)),
    }));

  if (participants.length > 0) await addExpenseParticipants(participants);

  // ── Payers (who paid how much) ───────────────────────────────
  const payers = Object.entries(paymentAmounts)
    .filter(([, amount]) => Number(amount) > 0.005)
    .map(([personId, paid_amount]) => {
      // Find in split first (has supabaseId spread), fallback to people
      const person = split.find((p) => p.id === personId) || people.find((p) => p.id === personId);
      if (!person?.supabaseId) return null;
      return {
        expense_id: expenseId,
        user_id: person.supabaseId,
        paid_amount: Number(Number(paid_amount).toFixed(2)),
      };
    })
    .filter(Boolean);

  if (payers.length > 0) await addExpensePayers(payers);

  return { id: expenseId };
}

// ─────────────────── SESSION PERSISTENCE ───────────────────

/**
 * Updates the description of an expense_group (used to store AI insight summary).
 */
export async function updateGroupDescription(groupId, description) {
  await supabase.from("expense_groups").update({ description }).eq("id", groupId);
}

/**
 * Creates a new expense_group + initial expense for a split session.
 * Returns { groupId, expenseId }.
 */
export async function createSession({ title, createdBy, date, notes }) {
  const { data: group, error: gErr } = await supabase
    .from("expense_groups")
    .insert([{ title: title || "Split session", created_by: createdBy }])
    .select()
    .single();
  if (gErr) throw gErr;

  // Add creator as first member
  await supabase.from("group_members").insert([{ group_id: group.id, user_id: createdBy }]);

  const { data: expense, error: eErr } = await supabase
    .from("expenses")
    .insert([
      {
        group_id: group.id,
        title: title || "Split session",
        total_amount: 0,
        created_by: createdBy,
        expense_date: date || new Date().toISOString().split("T")[0],
        notes: notes || null,
      },
    ])
    .select()
    .single();
  if (eErr) throw eErr;

  return { groupId: group.id, expenseId: expense.id };
}

/**
 * Upserts all session participants into group_members (idempotent).
 */
export async function syncSessionPeople(groupId, supabaseUserIds) {
  if (!supabaseUserIds.length) return;
  const rows = supabaseUserIds.map((userId) => ({ group_id: groupId, user_id: userId }));
  const { error } = await supabase
    .from("group_members")
    .upsert(rows, { onConflict: "group_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Replaces all food_items (and their consumers) for an expense, then updates
 * the expense metadata. Debounce this call to avoid excess writes.
 */
export async function syncSessionItems(expenseId, bill, people, settle = null) {
  // Build the settle payload (supabaseId-keyed) if provided
  let settlePayload = null;
  if (settle?.mode) {
    const localToSupabase = Object.fromEntries(people.filter((p) => p.supabaseId).map((p) => [p.id, p.supabaseId]));
    settlePayload = {
      mode: settle.mode,
      singleId: settle.singleId ? localToSupabase[settle.singleId] || null : null,
      customAmounts: Object.fromEntries(
        Object.entries(settle.customAmounts || {}).map(([lid, v]) => [localToSupabase[lid] || lid, v]),
      ),
    };
  }

  // 1. Update expense metadata (merge settle into notes)
  await supabase
    .from("expenses")
    .update({
      title: bill.merchant || "Split session",
      total_amount:
        (bill.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0) +
          (Number(bill.tax) || 0) +
          (Number(bill.serviceCharge) || 0) -
          (Number(bill.discount) || 0) ||
        bill.total ||
        0,
      expense_date: bill.date || new Date().toISOString().split("T")[0],
      notes: JSON.stringify({
        currency: bill.currency || "INR",
        tax: bill.tax || 0,
        serviceCharge: bill.serviceCharge || 0,
        discount: bill.discount || 0,
        ...(settlePayload ? { settle: settlePayload } : {}),
      }),
    })
    .eq("id", expenseId);

  // 2. Delete existing food items (cascades to food_item_consumers)
  await supabase.from("food_items").delete().eq("expense_id", expenseId);

  if (!bill.items || bill.items.length === 0) return;

  // 3. Re-insert food items
  const { data: foodItemRecords, error } = await supabase
    .from("food_items")
    .insert(
      bill.items.map((item) => ({
        expense_id: expenseId,
        item_name: item.name || "Item",
        item_cost: Number(item.price) || 0,
      })),
    )
    .select();
  if (error) throw error;

  // 4. Insert consumers (assignedTo local IDs → supabaseId)
  const consumers = [];
  bill.items.forEach((item, idx) => {
    const foodItemId = foodItemRecords[idx]?.id;
    if (!foodItemId) return;
    (item.assignedTo || []).forEach((personId) => {
      const person = people.find((p) => p.id === personId);
      if (person?.supabaseId) {
        consumers.push({ food_item_id: foodItemId, user_id: person.supabaseId });
      }
    });
  });
  if (consumers.length > 0) {
    await supabase.from("food_item_consumers").insert(consumers);
  }
}

/**
 * Persists the settle scenario into expenses.notes alongside bill metadata.
 * Does a read-then-merge so existing bill metadata is preserved.
 * Uses supabaseId as keys (local UUIDs regenerate on refresh).
 */
export async function syncSettleState(expenseId, settle, people, bill) {
  const localToSupabase = Object.fromEntries(people.filter((p) => p.supabaseId).map((p) => [p.id, p.supabaseId]));

  // Build notes from the bill we already have in Redux — no SELECT needed
  const existing = bill
    ? {
        currency: bill.currency || "INR",
        tax: bill.tax || 0,
        serviceCharge: bill.serviceCharge || 0,
        discount: bill.discount || 0,
      }
    : {};

  const settlePayload = settle?.mode
    ? {
        mode: settle.mode,
        singleId: settle.singleId ? localToSupabase[settle.singleId] || null : null,
        customAmounts: Object.fromEntries(
          Object.entries(settle.customAmounts || {}).map(([lid, v]) => [localToSupabase[lid] || lid, v]),
        ),
        // Convert settled keys "localId1-localId2" → "supabaseId1-supabaseId2"
        // UUIDs have 5 segments (4 hyphens each), so split at position 5
        settled: Object.fromEntries(
          Object.entries(settle.settled || {})
            .filter(([, v]) => v)
            .map(([key, v]) => {
              const parts = key.split("-");
              const a = parts.slice(0, 5).join("-");
              const b = parts.slice(5).join("-");
              const sa = localToSupabase[a] || a;
              const sb = localToSupabase[b] || b;
              return [`${sa}-${sb}`, v];
            }),
        ),
      }
    : null;

  await supabase
    .from("expenses")
    .update({ notes: JSON.stringify({ ...existing, settle: settlePayload }) })
    .eq("id", expenseId);
}

/**
 * Loads a saved session from Supabase and reconstructs the Redux bill + people shape.
 */
export async function loadSession(expenseId) {
  const { data: expense, error: eErr } = await supabase.from("expenses").select("*").eq("id", expenseId).single();
  if (eErr) throw eErr;

  // Parse stored bill metadata from notes (JSON)
  let meta = {};
  try {
    meta = JSON.parse(expense.notes || "{}");
  } catch {}

  // Food items + their consumers (no created_at on food_items — order by id instead)
  const { data: foodItems, error: fiErr } = await supabase
    .from("food_items")
    .select("id, item_name, item_cost, food_item_consumers(user_id)")
    .eq("expense_id", expenseId);
  if (fiErr) throw fiErr;

  // Group members (people who joined this split)
  const { data: members, error: mErr } = await supabase
    .from("group_members")
    .select("users(id, name, phone_number, upi_id)")
    .eq("group_id", expense.group_id);
  if (mErr) throw mErr;

  // Reconstruct people with stable local IDs
  const people = (members || [])
    .filter((m) => m.users)
    .map((m) => ({
      id: crypto.randomUUID(),
      name: m.users.name,
      upiId: m.users.upi_id || "",
      supabaseId: m.users.id,
    }));

  // Map supabaseId → local id for rebuilding assignedTo
  const supabaseToLocal = Object.fromEntries(people.map((p) => [p.supabaseId, p.id]));

  const bill = {
    merchant: expense.title === "Split session" ? "" : expense.title || "",
    date: expense.expense_date || "",
    currency: meta.currency || "INR",
    tax: meta.tax || 0,
    serviceCharge: meta.serviceCharge || 0,
    discount: meta.discount || 0,
    subtotal: 0,
    total: Number(expense.total_amount) || 0,
    items: (foodItems || []).map((fi) => ({
      id: crypto.randomUUID(),
      name: fi.item_name,
      quantity: 1,
      price: Number(fi.item_cost),
      assignedTo: (fi.food_item_consumers || []).map((c) => supabaseToLocal[c.user_id]).filter(Boolean),
    })),
  };

  // Restore settle scenario — prefer expense_payers table (written by "Save split"),
  // fall back to notes (written by debounced sync, may not exist yet).
  const { data: payerRows } = await supabase
    .from("expense_payers")
    .select("user_id, paid_amount")
    .eq("expense_id", expenseId);

  let settle = null;

  if (payerRows && payerRows.length > 0) {
    // Reconstruct from DB payers (most reliable source)
    const totalPaid = payerRows.reduce((s, r) => s + Number(r.paid_amount), 0);
    const billTotal = Number(expense.total_amount) || 0;

    if (payerRows.length === 1 && Math.abs(totalPaid - billTotal) < 0.5) {
      // Single person paid the full bill
      const localId = supabaseToLocal[payerRows[0].user_id];
      if (localId) {
        settle = { mode: "single", singleId: localId, customAmounts: {} };
      }
    } else {
      // Multiple payers or partial — restore as custom
      const customAmounts = Object.fromEntries(
        payerRows.map((r) => [supabaseToLocal[r.user_id], Number(r.paid_amount)]).filter(([localId]) => localId),
      );
      settle = { mode: "custom", singleId: null, customAmounts };
    }
  } else if (meta.settle?.mode) {
    // Fall back to notes if no payer rows yet (settle not saved yet)
    const s = meta.settle;
    settle = {
      mode: s.mode,
      singleId: s.singleId ? supabaseToLocal[s.singleId] || null : null,
      customAmounts: Object.fromEntries(
        Object.entries(s.customAmounts || {}).map(([sid, v]) => [supabaseToLocal[sid] || sid, v]),
      ),
      // Restore settled keys "supabaseId1-supabaseId2" → "localId1-localId2"
      settled: Object.fromEntries(
        Object.entries(s.settled || {})
          .filter(([, v]) => v)
          .map(([key, v]) => {
            const parts = key.split("-");
            const sa = parts.slice(0, 5).join("-");
            const sb = parts.slice(5).join("-");
            const la = supabaseToLocal[sa] || sa;
            const lb = supabaseToLocal[sb] || sb;
            return [`${la}-${lb}`, v];
          }),
      ),
    };
  }

  // Also restore settled from expense_payers-based settle
  if (settle && payerRows && payerRows.length > 0 && meta.settle?.settled) {
    const s = meta.settle;
    settle.settled = Object.fromEntries(
      Object.entries(s.settled || {})
        .filter(([, v]) => v)
        .map(([key, v]) => {
          const parts = key.split("-");
          const sa = parts.slice(0, 5).join("-");
          const sb = parts.slice(5).join("-");
          const la = supabaseToLocal[sa] || sa;
          const lb = supabaseToLocal[sb] || sb;
          return [`${la}-${lb}`, v];
        }),
    );
  }

  // Fetch group description (AI insight summary stored there)
  const { data: groupRow } = await supabase
    .from("expense_groups")
    .select("description")
    .eq("id", expense.group_id)
    .single();
  const description = groupRow?.description || null;

  return { bill, people, groupId: expense.group_id, settle, description };
}

/**
 * Deletes an expense_group (cascades to group_members, expenses, food_items, etc.).
 */
export async function deleteSession(groupId) {
  await supabase.from("expense_groups").delete().eq("id", groupId);
}
