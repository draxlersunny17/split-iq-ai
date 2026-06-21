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

Return ONLY valid JSON in this format:

{
  "merchant": string,
  "date": "DD/MM/YYYY",
  "currency": string,
  "subtotal": number,
  "tax": number,
  "serviceCharge": number,
  "discount": number,
  "total": number,
  "items": [
    {
      "name": string,
      "quantity": number,
      "price": number
    }
  ]
}

STRICT RULES:
- date MUST always be in DD/MM/YYYY format only
- never use YYYY-MM-DD
- never use YY format
- always pad with 2 digits (01/02/2026)
- if day > 12, use it as day
- if month > 12, use it as day/month accordingly
- quantity × unit price MUST equal price
- price MUST be line total (not unit price)
- Translate ALL item names to English if they are not already in English (Hindi, Arabic, Tamil, Chinese, etc.) — preserve meaning, use English words
- return ONLY valid JSON, no markdown, no explanation`,
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
