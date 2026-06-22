export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items, people } = req.body;

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = "gpt-5.4";
    const apiVersion = "2025-03-01-preview";

    const url =
      endpoint.replace(/\/$/, "") +
      `/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const itemList = items
      .map(
        (i) =>
          `- id:"${i.id}" name:"${i.name}" price:${i.price} category:${i.tag}`,
      )
      .join("\n");
    const peopleList = people.map((p) => `"${p.name}"`).join(", ");

    const prompt = `You are splitting a restaurant bill among friends. Intelligently assign each item to the most likely person(s) based on their name and the item type.

People: ${peopleList}

Items:
${itemList}

Rules:
- Use name-based heuristics (e.g. "Rahul's Thali" → Rahul, "Dev's Beer" → Dev)
- Assign alcohol (🍺) and cocktails to people whose names suggest they might drink
- Assign desserts to 1-2 people unless it's clearly shared
- Assign coffee/tea to individuals
- If an item is clearly shared (e.g. "Bread Basket", "Nachos", "Starters"), assign ALL people
- For ambiguous items, assign all people (shared)
- Keep reasons short and casual (max 8 words)

Return ONLY valid JSON (no markdown):
{
 "assignments": [
 {
 "itemId": "<exact id from input>",
 "peopleNames": ["<name>"],
 "reason": "<short reason>",
 "shared": false
 }
 ]
}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are a smart bill-splitting assistant. Assign items to people based on names and item types.",
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
