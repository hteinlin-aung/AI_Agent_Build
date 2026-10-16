// Stage 2 — the part that talks to the model.

// (it uses a FAKE Ollama, so the tests work even when Ollama is off).

import { classifyCategory } from "./rules.js";

// --- Settings (given) ---

export const OLLAMA_URL = "http://localhost:11434/api/chat";
export const MODEL = "llama3.2:3b";
export const CATEGORIES = ["Billing", "Technical", "General"];


export function buildPrompt(ticket) {
  return `
   You are a support ticket classifier.
    Classify the ticket below into exactly one category: Billing, Technical or General.
    - Billing: payments, charges, refunds, invoices
    - Technical: something is broken, not working, crashing or showing errors
    - General: anything else (questions, feedback, account help)
    Answer with one word only: Billing, Technical or General.


    Subject: ${ticket.subject}
    Body: ${ticket.body}
  `
}


export function cleanCategory(rawAnswer) {

  if(typeof rawAnswer !== "string") return null;

  const text = rawAnswer.toLowerCase();

  const result = CATEGORIES.filter((cat) => text.includes(cat.toLowerCase()));

  if(result.length === 1) return result[0];
  return null;

}


export async function askModel(prompt) {

  const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: {
          "Content-Type" : "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: { temperature: 0 }
        }),
  });

  if(!response.ok){
    throw new Error(`Ollama returned ${response.status}`)
  }

  const data = await response.json();
  return data.message.content

}


export async function classifyWithModel(ticket) {

  try{
    const prompt  = buildPrompt(ticket);
    const rawAnswer = await askModel(prompt);
  
    const category = cleanCategory(rawAnswer);

    if(category === null){
      return { category: classifyCategory(ticket), source: "rules: unclear answer" }
    }
    return {category, source: "model"};

  }catch(err){
    return  { category: classifyCategory(ticket), source: "rules: model error" }
  }

}

