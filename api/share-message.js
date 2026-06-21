export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bill, people, split } = req.body;

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = "gpt-5.4";
    const apiVersion = "2025-03-01-preview";

    const url =
      endpoint.replace(/\/$/, "") +
      `/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const splitLines = (split || [])
      .filter((p) => p.total > 0)
      .map((p) => `${p.name}: ${bill.currency} ${Number(p.total).toFixed(2)}`)
      .join("\n");

    const prompt = `Write a friendly WhatsApp/Telegram group message to share the bill split after a meal.

Restaurant: ${bill.merchant || "the restaurant"}
Date: ${bill.date || "today"}
Total: ${bill.currency} ${bill.total}
Who owes what:
${splitLines || "See individual amounts above."}

Write a casual, warm 3-5 line message that:
- Mentions the restaurant name
- Lists each person's amount clearly
- Uses a friendly tone with 1-2 relevant emojis
- Ends with a friendly note (e.g. "Thanks everyone! 🙏")

Return ONLY the message text, ready to copy-paste. No markdown formatting, no quotes, no extra explanation.`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content:
              "You write friendly, casual bill-split messages for WhatsApp and Telegram group chats.",
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
