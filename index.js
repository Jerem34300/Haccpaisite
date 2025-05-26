
import { useState } from "react";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [lang, setLang] = useState("fr");
  const [loading, setLoading] = useState(false);

  const askAI = async () => {
    setLoading(true);
    const res = await fetch("/api/haccp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, lang }),
    });
    const data = await res.json();
    setAnswer(data.answer);
    setLoading(false);
  };

  return (
    <main style={{ maxWidth: 600, margin: "auto", padding: 20 }}>
      <h1>{lang === "fr" ? "Assistant HACCP" : "HACCP Assistant"}</h1>
      <p>{lang === "fr"
        ? "Posez un cas pratique en hygiène ou sécurité alimentaire."
        : "Ask a practical food safety/hygiene case."}
      </p>
      <select value={lang} onChange={(e) => setLang(e.target.value)}>
        <option value="fr">Français</option>
        <option value="en">English</option>
      </select>
      <textarea rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} style={{ width: "100%", marginTop: 10 }} />
      <button onClick={askAI} disabled={loading}>
        {loading ? (lang === "fr" ? "Chargement..." : "Loading...") : (lang === "fr" ? "Envoyer" : "Send")}
      </button>
      {answer && <div style={{ marginTop: 20, background: "#eee", padding: 10 }}>{answer}</div>}
    </main>
  );
}
