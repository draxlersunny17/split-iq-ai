export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { fileData, fileType } = req.body;

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = "gpt-5.4";
    const apiVersion = "2025-03-01-preview";

    const url =
      endpoint.replace(/\/$/, "") +
      `/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const content = [
      {
        type: "text",
        text: `Extract this bill into strict JSON.
Return:
{
  merchant,
  date,
  currency,
  subtotal,
  tax,
  serviceCharge,
  discount,
  total,
  items:[]
}
For each item return:
{
  name,
  quantity,
  price
}

IMPORTANT:
- price MUST be the FINAL LINE TOTAL.
- If quantity is 2 and unit price is 250, return:
  quantity: 2,
  price: 500
- Never return unit price.
- quantity × unit price = price.
- Return ONLY valid JSON.`,
      },
    ];

    if (fileType.startsWith("image/")) {
      content.push({
        type: "image_url",
        image_url: { url: fileData },
      });
    } else {
      content.push({
        type: "text",
        text: fileData.slice(0, 18000),
      });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: "You are a precise bill parser.",
          },
          { role: "user", content },
        ],
      }),
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
