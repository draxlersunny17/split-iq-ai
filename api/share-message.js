export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bill, people, split, transactions, paymentAmounts } = req.body;

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = "gpt-5.4";
    const apiVersion = "2025-03-01-preview";

    const url =
      endpoint.replace(/\/$/, "") +
      `/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const splitLines = (split || [])
      .filter((p) => p.total > 0)
      .map((p) => ` ${p.name}: ${bill.currency} ${Number(p.total).toFixed(2)}`)
      .join("\n");

    const payerLines = Object.entries(paymentAmounts || {})
      .filter(([, amt]) => Number(amt) > 0.005)
      .map(([id, amt]) => {
        const name = (split || []).find((p) => p.id === id)?.name || id;
        return ` ${name} paid ${bill.currency} ${Number(amt).toFixed(2)}`;
      })
      .join("\n");

    const settlementLines = (transactions || [])
      .map(
        (t) =>
          ` ${t.from.name} → ${t.to.name}: ${bill.currency} ${Number(t.amount).toFixed(2)}`,
      )
      .join("\n");

    const prompt = `Write a WhatsApp/Telegram group message for a bill split. Use a warm, casual tone with 1-2 emojis.

DATA (use ALL of this — do not skip any section):
Restaurant: ${bill.merchant || "the restaurant"}
Date: ${bill.date || "today"}
Total: ${bill.currency} ${bill.total}
${payerLines ? `\nWho paid upfront:\n${payerLines}` : ""}
\nEach person's share:\n${splitLines || " (split equally)"}
${settlementLines ? `\nWho needs to pay whom:\n${settlementLines}` : ""}

RULES — you MUST follow all of these:
1. Start with a friendly opener mentioning the restaurant and total.
2. List EVERY person's share exactly as given above.
${payerLines ? "3. Clearly state who paid the bill upfront." : ""}
${settlementLines ? `${payerLines ? "4" : "3"}. List EVERY settlement transfer exactly as given (who pays whom, exact amount). Do not skip any.` : ""}
- End with a short friendly closing line.
- Return ONLY the message text. No markdown, no quotes, no labels like "Message:".`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "You write bill-split messages for WhatsApp/Telegram. You always include every person's share and every settlement transfer exactly as provided. You never omit any data.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
