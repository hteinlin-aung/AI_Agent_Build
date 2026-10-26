// Checks for THE NUDGE in agent.js (looksLikePlan + the once-only reminder in runAgent).
// Run with:  node test-nudge.js   — fake model, fake tools, works with Ollama off.

import { looksLikePlan, runAgent, NUDGE } from "./agent.js";

const show = (v) => (v === undefined ? "undefined" : JSON.stringify(v));
let pass = 0;
let fail = 0;
let currentGroup = "";
async function check(group, label, getActual, expected) {
  if (group !== currentGroup) { console.log(`\n${group}`); currentGroup = group; }
  try {
    const actual = await getActual();
    if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}\n        expected ${show(expected)}\n        got      ${show(actual)}`); }
  } catch (err) { fail++; console.log(`  ERROR ${label}\n        ${err.message}`); }
}

let sent = [];
function fakeModel(replies) {
  sent = [];
  let i = 0;
  globalThis.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    const message = replies[Math.min(i, replies.length - 1)];
    i++;
    return { ok: true, status: 200, json: async () => ({ message, done_reason: "stop" }) };
  };
}
const callTool = (name, args = {}) => ({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] });
const say = (text) => ({ role: "assistant", content: text });
const box = { getMemoryStatus: () => ({ freePercent: 50, pressure: "normal" }) };

// The real reply from the 2026-10-25 chat test
const REAL_PLAN = "Let me check your system and memory usage to find out why your Mac might be slow.\n\nLet me check now! 😊";

await check("looksLikePlan", "the real 'Let me check now!' reply -> true", () => looksLikePlan(REAL_PLAN), true);
await check("looksLikePlan", "\"I'll look at your memory\" -> true", () => looksLikePlan("I'll look at your memory first."), true);
await check("looksLikePlan", "\"I'm going to scan Downloads\" -> true", () => looksLikePlan("I'm going to scan Downloads."), true);
await check("looksLikePlan", "a real answer -> false", () => looksLikePlan("You have 204.3 GB free out of 494.4 GB."), false);
await check("looksLikePlan", "\"Let me know if...\" is NOT a plan -> false", () => looksLikePlan("Done! Let me know if you'd like anything else."), false);
await check("looksLikePlan", "a greeting -> false", () => looksLikePlan("Hi! I'm an AI assistant running on your Mac."), false);

await check("runAgent nudge", "plan -> nudge -> tool -> real answer", async () => {
  fakeModel([say(REAL_PLAN), callTool("getMemoryStatus"), say("Memory is 50% free, so memory isn't the problem.")]);
  const r = await runAgent("Why is my Mac slow?", { toolbox: box });
  return [r.answer, r.toolsUsed, r.steps];
}, ["Memory is 50% free, so memory isn't the problem.", ["getMemoryStatus"], 3]);
await check("runAgent nudge", "the model really received the NUDGE message", async () => {
  fakeModel([say(REAL_PLAN), callTool("getMemoryStatus"), say("done")]);
  await runAgent("Why is my Mac slow?", { toolbox: box });
  return sent[1].messages.at(-1);
}, { role: "user", content: NUDGE });
await check("runAgent nudge", "only ONCE: a second plan is returned as it is (no loop)", async () => {
  fakeModel([say("Let me check now!"), say("Let me check again!")]);
  const r = await runAgent("Why is my Mac slow?", { toolbox: box });
  return [r.answer, r.steps];
}, ["Let me check again!", 2]);
await check("runAgent nudge", "no nudge after a tool already ran", async () => {
  fakeModel([callTool("getMemoryStatus"), say("I'll look into it more if you want.")]);
  const r = await runAgent("Why is my Mac slow?", { toolbox: box });
  return [r.answer, r.steps];
}, ["I'll look into it more if you want.", 2]);
await check("runAgent nudge", "a normal answer -> no nudge", async () => {
  fakeModel([say("Hello! How can I help?")]);
  const r = await runAgent("Hi", { toolbox: box });
  return [r.answer, r.steps, sent.length];
}, ["Hello! How can I help?", 1, 1]);
await check("runAgent nudge", "no room left (maxSteps 1) -> no nudge", async () => {
  fakeModel([say("Let me check now!")]);
  const r = await runAgent("Why is my Mac slow?", { toolbox: box, maxSteps: 1 });
  return [r.answer, r.steps, r.stoppedEarly];
}, ["Let me check now!", 1, false]);
await check("runAgent nudge", "history keeps only the question + REAL answer (no plan, no nudge)", async () => {
  fakeModel([say(REAL_PLAN), callTool("getMemoryStatus"), say("Memory is fine.")]);
  const r = await runAgent("Why is my Mac slow?", { toolbox: box });
  return r.history;
}, [{ role: "user", content: "Why is my Mac slow?" }, { role: "assistant", content: "Memory is fine." }]);

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
