// Self-checking runner for model.js
// Run with:  node test.js   — works with Ollama off.

import { buildPrompt, cleanCategory, askModel, classifyWithModel } from "./model.js";
import { scoreResults, pickWinner } from "./evaluate.js";

const T004 = {
  id: "T-004",
  subject: "Question about invoice",
  body: "Can you explain the line items on my latest invoice?",
  customerTier: "Standard",
  expectedCategory: "Billing",
};

// --- Fake fetch -------------------------------------------------------------
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
    return { ok: false, status, json: async () => ({ error: "model not found" }) };
  };
}
function fakeOllamaOff() {
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
}
const sentModel = () => JSON.parse(lastRequest.options.body).model;

// --- Runner -------------------------------------------------------------------
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

// Change #1 — buildPrompt
const p = () => buildPrompt(T004);
await check("#1 buildPrompt (tidy)", "still includes subject and body",
  () => p().includes(T004.subject) && p().includes(T004.body), true);
await check("#1 buildPrompt (tidy)", "still names all three categories",
  () => ["Billing", "Technical", "General"].every((c) => p().includes(c)), true);
await check("#1 buildPrompt (tidy)", "still asks for one word", () => p().toLowerCase().includes("one word"), true);
await check("#1 buildPrompt (tidy)", "still explains Billing (mentions invoices)", () => p().toLowerCase().includes("invoice"), true);
await check("#1 buildPrompt (tidy)", "starts with text, not a newline or space", () => /^\S/.test(p()), true);
await check("#1 buildPrompt (tidy)", "no line starts with a space",
  () => p().split("\n").filter((line) => line.startsWith(" ")).length, 0);

// cleanCategory — unchanged from Stage 2, just making sure it survived the copy
await check("cleanCategory (unchanged)", "'Technical.' -> Technical", () => cleanCategory("Technical."), "Technical");
await check("cleanCategory (unchanged)", "two categories -> null", () => cleanCategory("Billing or General"), null);

// Change #2 — askModel(prompt, model)
await check("#2 askModel(prompt, model)", "sends the model it was given", async () => {
  fakeOllamaAnswer("x");
  await askModel("hello", "some-model:1b");
  return sentModel();
}, "some-model:1b");
await check("#2 askModel(prompt, model)", "a different model name goes through too", async () => {
  fakeOllamaAnswer("x");
  await askModel("hello", "qwen3.5:4b");
  return sentModel();
}, "qwen3.5:4b");
await check("#2 askModel(prompt, model)", "still returns the answer text", async () => {
  fakeOllamaAnswer("Billing");
  return await askModel("hello", "m");
}, "Billing");
await check("#2 askModel(prompt, model)", "still throws on a 404 (e.g. model not pulled)", async () => {
  fakeOllamaStatus(404);
  try { await askModel("hello", "m"); return "did not throw"; } catch (err) { return err.message.includes("404"); }
}, true);

// Change #3 — classifyWithModel(ticket, model)
await check("#3 classifyWithModel(ticket, model)", "passes the model name on to askModel", async () => {
  fakeOllamaAnswer("Billing");
  await classifyWithModel(T004, "qwen3.5:4b");
  return sentModel();
}, "qwen3.5:4b");
await check("#3 classifyWithModel(ticket, model)", "clean answer -> model", async () => {
  fakeOllamaAnswer("Billing.");
  return await classifyWithModel(T004, "m");
}, { category: "Billing", source: "model" });
await check("#3 classifyWithModel(ticket, model)", "Ollama off -> rules fallback", async () => {
  fakeOllamaOff();
  return await classifyWithModel(T004, "m");
}, { category: "Billing", source: "rules: model error" });

// evaluate.js — scoreResults
const r = (id, expected, predicted, source, ms) => ({ id, expected, predicted, source, ms });
const sample = [
  r("T-001", "Billing", "Billing", "model", 500),
  r("T-002", "Technical", "Technical", "model", 700),
  r("T-003", "Technical", "General", "rules: unclear answer", 650),
  r("T-004", "Billing", "General", "model", 601),
];
await check("scoreResults", "empty list (no NaN)", () => scoreResults([]),
  { total: 0, correct: 0, accuracy: 0, fallbacks: 0, avgMs: 0, mistakes: [] });
await check("scoreResults", "total and correct", () => [scoreResults(sample).total, scoreResults(sample).correct], [4, 2]);
await check("scoreResults", "accuracy is a whole percent", () => scoreResults(sample).accuracy, 50);
await check("scoreResults", "accuracy rounds (2 of 3 -> 67)",
  () => scoreResults(sample.slice(0, 3)).accuracy, 67);
await check("scoreResults", "fallbacks = sources starting with 'rules:'", () => scoreResults(sample).fallbacks, 1);
await check("scoreResults", "the rules contender ('rules') is NOT a fallback",
  () => scoreResults([r("T-001", "Billing", "Billing", "rules", 0)]).fallbacks, 0);
await check("scoreResults", "avgMs is a rounded average", () => scoreResults(sample).avgMs, 613);
await check("scoreResults", "mistakes list, in order", () => scoreResults(sample).mistakes, [
  { id: "T-003", expected: "Technical", predicted: "General" },
  { id: "T-004", expected: "Billing", predicted: "General" },
]);

// evaluate.js — pickWinner
const s = (accuracy, avgMs) => ({ total: 20, correct: 0, accuracy, fallbacks: 0, avgMs, mistakes: [] });
await check("pickWinner", "empty -> null", () => pickWinner([]), null);
await check("pickWinner", "highest accuracy wins", () => pickWinner([
  { name: "rules", score: s(55, 0) },
  { name: "llama", score: s(85, 700) },
  { name: "qwen", score: s(90, 2500) },
]), "qwen");
await check("pickWinner", "same accuracy -> faster wins", () => pickWinner([
  { name: "slow", score: s(90, 2500) },
  { name: "fast", score: s(90, 700) },
]), "fast");
await check("pickWinner", "full tie -> first one wins", () => pickWinner([
  { name: "first", score: s(80, 500) },
  { name: "second", score: s(80, 500) },
]), "first");

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
