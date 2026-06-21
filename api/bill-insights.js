export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bill, people } = req.body;

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = "gpt-5.4";
    const apiVersion = "2025-03-01-preview";

    const url =
      endpoint.replace(/\/$/, "") +
      `/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const itemList = bill.items
      .map((i) => `${i.name}: ${bill.currency}${Number(i.price).toFixed(2)}`)
      .join(", ");

    const prompt = `Analyze this dining bill and return fun, friendly insights.

Merchant: ${bill.merchant || "a restaurant"}
Date: ${bill.date || "today"}
Total: ${bill.currency} ${bill.total}
Items: ${itemList}
Tax: ${bill.tax || 0}, Service Charge: ${bill.serviceCharge || 0}
${people?.length ? `People: ${people.map((p) => p.name).join(", ")}` : ""}

Return ONLY valid JSON (no markdown, no explanation):
{
 "summary": "A friendly, conversational 2-sentence insight. Mention the most expensive item, its % of the subtotal, and a warm observation. Be casual and fun.",
 "cuisine": "Cuisine type or meal category (e.g. North Indian, Italian, Cafe Brunch, Bar Night, Fast Food, Pan-Asian)",
 "vibe": "One-word occasion (e.g. Dinner, Lunch, Party, Brunch, Date Night, Work Lunch, Night Out, Celebration)"
}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "You are a witty, friendly dining bill analyst. Generate insightful, casual observations about restaurant bills.",
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
