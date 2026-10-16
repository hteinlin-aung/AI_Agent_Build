// Self-checking runner for model.js.  Run with:  node test.js
// It replaces fetch with a FAKE Ollama, so it works even when Ollama is off
// and always gives the same answers. You don't need to edit this file.

import {
  buildPrompt, cleanCategory, askModel, classifyWithModel, MODEL,
} from "./model.js";

const T003 = {
  id: "T-003",
  subject: "URGENT: production down",
  body: "Our integration stopped working entirely. Need this fixed ASAP.",
  customerTier: "Enterprise",
};

// --- Fake fetch helpers ----------------------------------------------------
let lastRequest = null;

function fakeOllamaAnswer(content) {
  globalThis.fetch = async (url, options) => {
    lastRequest = { url, options };
    return { ok: true, status: 200, json: async () => ({ message: { role: "assistant", content } }) };
  };
}
function fakeOllamaStatus(status) {
  globalThis.fetch = async (url, options) => {
    lastRequest = { url, options };
    return { ok: false, status, json: async () => ({ error: "something went wrong" }) };
  };
}
function fakeOllamaOff() {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
}

// --- Runner ------------------------------------------------------------------
const show = (v) => (v === undefined ? "undefined" : JSON.stringify(v));
let pass = 0;
let fail = 0;
let currentGroup = "";

async function check(group, label, getActual, expected) {
  if (group !== currentGroup) {
    console.log(`\n${group}`);
    currentGroup = group;
  }
  try {
    const actual = await getActual();
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      pass++;
      console.log(`  PASS  ${label}`);
    } else {
      fail++;
      console.log(`  FAIL  ${label}\n        expected ${show(expected)}\n        got      ${show(actual)}`);
    }
  } catch (err) {
    fail++;
    console.log(`  ERROR ${label}\n        ${err.message}`);
  }
}

// 1. buildPrompt
const prompt = () => buildPrompt(T003);
await check("1. buildPrompt", "returns a string", () => typeof prompt(), "string");
await check("1. buildPrompt", "includes the subject", () => prompt().includes(T003.subject), true);
await check("1. buildPrompt", "includes the body", () => prompt().includes(T003.body), true);
await check("1. buildPrompt", "names all three categories",
  () => ["Billing", "Technical", "General"].every((c) => prompt().includes(c)), true);
await check("1. buildPrompt", "asks for one word", () => prompt().toLowerCase().includes("one word"), true);

// 2. cleanCategory
await check("2. cleanCategory", "'Technical.' (your real curl answer)", () => cleanCategory("Technical."), "Technical");
await check("2. cleanCategory", "spaces and lowercase", () => cleanCategory("  technical\n"), "Technical");
await check("2. cleanCategory", "'BILLING'", () => cleanCategory("BILLING"), "Billing");
await check("2. cleanCategory", "a short sentence", () => cleanCategory("The category is General."), "General");
await check("2. cleanCategory", "two categories -> null", () => cleanCategory("It is Billing or Technical"), null);
await check("2. cleanCategory", "your real `ollama run` answer -> null (mentions technical AND billing)",
  () => cleanCategory("I would classify this ticket as Technical. The language used (\"production down\" and \"stopped working\") indicates that the issue is related to the functioning of the system, rather than a payment or billing-related issue."),
  null);
await check("2. cleanCategory", "no category -> null", () => cleanCategory("banana"), null);
await check("2. cleanCategory", "empty string -> null", () => cleanCategory(""), null);
await check("2. cleanCategory", "undefined -> null", () => cleanCategory(undefined), null);

// 3. askModel
await check("3. askModel", "returns the answer text", async () => {
  fakeOllamaAnswer("Technical.");
  return await askModel("hello");
}, "Technical.");
await check("3. askModel", "sends a POST to /api/chat", async () => {
  fakeOllamaAnswer("x");
  await askModel("hello");
  return [lastRequest.url, lastRequest.options.method];
}, ["http://localhost:11434/api/chat", "POST"]);
await check("3. askModel", "sends model, messages, stream:false, temperature 0", async () => {
  fakeOllamaAnswer("x");
  await askModel("hello");
  const body = JSON.parse(lastRequest.options.body);
  return [body.model, body.messages, body.stream, body.options && body.options.temperature];
}, [MODEL, [{ role: "user", content: "hello" }], false, 0]);
await check("3. askModel", "throws when response.ok is false (status in message)", async () => {
  fakeOllamaStatus(404);
  try {
    await askModel("hello");
    return "did not throw";
  } catch (err) {
    return err.message.includes("404");
  }
}, true);
await check("3. askModel", "lets a network error through (Ollama off)", async () => {
  fakeOllamaOff();
  try {
    await askModel("hello");
    return "did not throw";
  } catch (err) {
    return "threw";
  }
}, "threw");

// 4. classifyWithModel
await check("4. classifyWithModel", "clean answer -> model's category", async () => {
  fakeOllamaAnswer("Technical");
  return await classifyWithModel(T003);
}, { category: "Technical", source: "model" });
await check("4. classifyWithModel", "messy but clear answer -> cleaned", async () => {
  fakeOllamaAnswer(" billing. ");
  return await classifyWithModel(T003);
}, { category: "Billing", source: "model" });
await check("4. classifyWithModel", "unclear answer -> rules fallback", async () => {
  fakeOllamaAnswer("banana");
  return await classifyWithModel(T003);
}, { category: "General", source: "rules: unclear answer" });
await check("4. classifyWithModel", "Ollama off -> rules fallback, no crash", async () => {
  fakeOllamaOff();
  return await classifyWithModel(T003);
}, { category: "General", source: "rules: model error" });
await check("4. classifyWithModel", "Ollama returns 500 -> rules fallback", async () => {
  fakeOllamaStatus(500);
  return await classifyWithModel(T003);
}, { category: "General", source: "rules: model error" });

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
