
export default async function handler(req, res) {
  const { question, lang } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  const systemPrompt = lang === "fr"
    ? "Tu es un expert HACCP. Réponds clairement selon les normes françaises d'hygiène alimentaire."
    : "You are a HACCP expert. Answer clearly following international food hygiene and safety standards.";

  const payload = {
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question }
    ],
    temperature: 0.5,
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    res.status(200).json({ answer: data.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur IA" });
  }
}
