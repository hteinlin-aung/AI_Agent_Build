// Stage 3 — the part that talks to the model.
// This is Stage 2 code, copied across. It works — but it only knows ONE model.
// Stage 3 needs it to work for ANY model name, so there are 3 small changes to make.

import { classifyCategory } from "./rules.js";

// --- Settings(given) ---

export const OLLAMA_URL = "http://localhost:11434/api/chat";
// >>> STAGE 3 CHANGE (part of #2): MODEL is gone on purpose.

export const CATEGORIES = ["Billing", "Technical", "General"];

export async function unloadModel(model) {
  try {
    await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
    });
  } catch (err) {
    // Ollama is off, nothing is loaded.
  }
}


export function buildPrompt(ticket) {
  return `You are a support ticket classifier. Classify the ticket below into exactly one category: Billing, Technical or General.
- Billing: payments, charges, refunds, invoices
- Technical: something is broken, not working, crashing or showing errors
- General: anything else (questions, feedback, account help)
Answer with one word only: Billing, Technical or General.

Subject: ${ticket.subject}
Body: ${ticket.body}`
}


export function cleanCategory(rawAnswer) {

  if(typeof rawAnswer !== "string") return null;

  const text = rawAnswer.toLowerCase();

  const result = CATEGORIES.filter((cat) => text.includes(cat.toLowerCase()));

  if(result.length === 1) return result[0];
  return null;

}


export async function askModel(prompt, model) {

  const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: {
          "Content-Type" : "application/json"
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          think: false,
          format: {
            type: "object",
            properties: { category: { type: "string", enum: CATEGORIES } },
            required: ["category"],
          },
          options: { temperature: 0, num_ctx: 2048, num_predict: 30 }
        }),
  });

  if(!response.ok){
    throw new Error(`Ollama returned ${response.status}`)
  }

  const data = await response.json();
  if (data.done_reason === "length") {
    throw new Error("Answer was cut off by num_predict");
  }
  return data.message.content

}


export async function classifyWithModel(ticket, model) {

  try{
    const prompt  = buildPrompt(ticket);
    const rawAnswer = await askModel(prompt, model);

//console.log(ticket.id, JSON.stringify(rawAnswer));

    const category = cleanCategory(rawAnswer);

    if(category === null){
      return { category: classifyCategory(ticket), source: "rules: unclear answer" }
    }
    return {category, source: "model"};

  }catch(err){
    return  { category: classifyCategory(ticket), source: "rules: model error" }
  }

}

