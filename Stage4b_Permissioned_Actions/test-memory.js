// Checks for Change 4 — memory between questions.   Run with:  node test-memory.js
// Fake model + fake tools, works with Ollama off. 

import * as agent from "./agent.js";

const show = (v) => (v === undefined ? "undefined" : JSON.stringify(v));
let pass = 0;
let fail = 0;
async function check(label, getActual, expected) {
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
const say = (text) => ({ role: "assistant", content: text });
const callTool = (name) => ({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: {} } }] });
const fakeTools = { getDiskSpace: () => ({ freeGB: 204.3 }) };
const U = (content) => ({ role: "user", content });
const A = (content) => ({ role: "assistant", content });
const addToHistory = (...args) => {
  if (typeof agent.addToHistory !== "function") throw new Error("addToHistory is not exported from agent.js yet");
  return agent.addToHistory(...args);
};

console.log("\n1. addToHistory");
await check("adds the question and the answer", () => addToHistory([], "How much storage?", "204 GB free."),
  [U("How much storage?"), A("204 GB free.")]);
await check("keeps what was already there", () => addToHistory([U("hi"), A("Hello!")], "q", "a"),
  [U("hi"), A("Hello!"), U("q"), A("a")]);
await check("does NOT change the array you pass in", () => {
  const old = [U("hi"), A("Hello!")];
  addToHistory(old, "q", "a");
  return old.length;
}, 2);
await check("keeps only the last 6 messages by default", () => {
  const six = [U("1"), A("1"), U("2"), A("2"), U("3"), A("3")];
  return addToHistory(six, "4", "4");
}, [U("2"), A("2"), U("3"), A("3"), U("4"), A("4")]);
await check("maxMessages can be changed", () => addToHistory([U("1"), A("1")], "2", "2", 2), [U("2"), A("2")]);

console.log("\n2. runAgent with history");
await check("no history -> first request is [system, user] as before", async () => {
  fakeModel([say("ok")]);
  await agent.runAgent("hi", { toolbox: fakeTools });
  return sent[0].messages.map((m) => m.role);
}, ["system", "user"]);
await check("history goes BETWEEN the system prompt and the new question", async () => {
  fakeModel([say("Here it is.")]);
  await agent.runAgent("yes", { toolbox: fakeTools, history: [U("Delete Downloads"), A("I can't. Want help finding it?")] });
  return sent[0].messages.map((m) => `${m.role}: ${m.content}`).slice(1);
}, ["user: Delete Downloads", "assistant: I can't. Want help finding it?", "user: yes"]);
await check("returns the updated history", async () => {
  fakeModel([say("Hello!")]);
  const r = await agent.runAgent("hi", { toolbox: fakeTools, history: [U("q0"), A("a0")] });
  return r.history;
}, [U("q0"), A("a0"), U("hi"), A("Hello!")]);
await check("history keeps ONLY questions + final answers (no tool messages)", async () => {
  fakeModel([callTool("getDiskSpace"), say("204.3 GB free.")]);
  const r = await agent.runAgent("storage?", { toolbox: fakeTools });
  return r.history;
}, [U("storage?"), A("204.3 GB free.")]);
await check("still answers + toolsUsed as before", async () => {
  fakeModel([callTool("getDiskSpace"), say("204.3 GB free.")]);
  const r = await agent.runAgent("storage?", { toolbox: fakeTools });
  return [r.answer, r.toolsUsed, r.steps, r.stoppedEarly];
}, ["204.3 GB free.", ["getDiskSpace"], 2, false]);
await check("stopped early -> history still records the question and the stop message", async () => {
  fakeModel([callTool("getDiskSpace")]);
  const r = await agent.runAgent("loop", { toolbox: fakeTools, maxSteps: 2 });
  return r.history;
}, [U("loop"), A("I stopped after 2 steps without finishing.")]);
await check("does NOT change the history array you pass in", async () => {
  fakeModel([say("ok")]);
  const old = [U("q0"), A("a0")];
  await agent.runAgent("hi", { toolbox: fakeTools, history: old });
  return old.length;
}, 2);

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
