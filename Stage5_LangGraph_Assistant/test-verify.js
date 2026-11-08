// Checks for THE VERIFY NODE in graph.js. Run with:  node test-verify.js
// Fake model + fake tools: no Ollama needed, nothing on your Mac is touched.

import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import { makeTools } from "./lc-tools.js";
import {
  hasData, isQuestion, needsVerify, routeAfterModel, toolsUsedThisTurn, selectContext,
  buildGraph, VERIFY_MESSAGE, VERIFY_NAME,
} from "./graph.js";

const show = (v) => (v === undefined ? "undefined" : JSON.stringify(v));
let pass = 0, fail = 0, currentGroup = "";
async function check(group, label, getActual, expected) {
  if (group !== currentGroup) { console.log(`\n${group}`); currentGroup = group; }
  try {
    const actual = await getActual();
    if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}\n        expected ${show(expected)}\n        got      ${show(actual)}`); }
  } catch (err) { fail++; console.log(`  ERROR ${label}\n        ${err.message.split("\n")[0]}`); }
}

let id = 0;
const ask = (t) => new HumanMessage(t);
const say = (t) => new AIMessage(t);
const call = (name, args = {}) => new AIMessage({ content: "", tool_calls: [{ name, args, id: `v${++id}`, type: "tool_call" }] });
const reminder = () => new HumanMessage({ content: VERIFY_MESSAGE, name: VERIFY_NAME });
const short = (ms) => ms?.map((m) => `${m.getType()}${m.name === VERIFY_NAME ? "(verify)" : ""}:${m.content.slice(0, 25) || (m.tool_calls ?? []).map((c) => c.name).join("+")}`);

// The REAL made-up answer from the 2026-11-08 chat test
const FAKE_APPS = "Here are the top 5 memory-hungry apps:\n\n1. **Final Cut Pro** – 3.2 GB\n2. **Safari** – 2.1 GB";

let ran = [];
const TOOLS = makeTools({
  getSystemInfo: () => ({}), getDiskSpace: () => ({ freeGB: 193.2 }), getMemoryStatus: () => ({}),
  findDuplicates: () => ({}), findFiles: () => ({}), quitApp: () => ({}), moveDuplicatesToTrash: () => ({}),
  getTopApps: () => { ran.push("getTopApps"); return { apps: [{ name: "Google Chrome", memoryMB: 1500 }] }; },
});
let sent = [];
const fakeModel = (script) => { sent = []; let i = 0; return { invoke: async (m) => { sent.push(m); const x = script[Math.min(i++, script.length - 1)]; return typeof x === "function" ? x() : x; } }; };
const cfg = (t) => ({ configurable: { thread_id: t }, recursionLimit: 16 });

await check("hasData", "the real fake-apps answer -> true", () => hasData(FAKE_APPS), true);
await check("hasData", "\"14% of RAM free\" -> true", () => hasData("Only 14% of RAM is free."), true);
await check("hasData", "\"500MB\" (no space) -> true", () => hasData("about 500MB"), true);
await check("hasData", "a greeting -> false", () => hasData("Hello! How can I help?"), false);
await check("hasData", "\"Spotify was not closed\" -> false", () => hasData("Spotify was not closed. You declined."), false);
await check("hasData", "a plain number without a unit -> false", () => hasData("I found 8 groups."), false);

await check("isQuestion", "a real question -> true", () => isQuestion(ask("hi")), true);
await check("isQuestion", "the verify reminder -> false", () => isQuestion(reminder()), false);
await check("isQuestion", "an AI message -> false", () => isQuestion(say("hi")), false);

await check("needsVerify", "data + no tool this turn -> true", () => needsVerify({ messages: [ask("which app?"), say(FAKE_APPS)] }), true);
await check("needsVerify", "data + a tool ran this turn -> false", () =>
  needsVerify({ messages: [ask("q"), call("getTopApps"), new ToolMessage({ content: "{}", tool_call_id: `v${id}` }), say("Chrome uses 1.5 GB.")] }), false);
await check("needsVerify", "already reminded this turn -> false (only once)", () =>
  needsVerify({ messages: [ask("which app?"), say(FAKE_APPS), reminder(), say(FAKE_APPS)] }), false);
await check("needsVerify", "a tool in an EARLIER question doesn't count", () =>
  needsVerify({ messages: [ask("q1"), call("getTopApps"), new ToolMessage({ content: "{}", tool_call_id: `v${id}` }), say("ok"), ask("q2"), say(FAKE_APPS)] }), true);
await check("routeAfterModel", "made-up data -> \"verify\"", () => routeAfterModel({ messages: [ask("which app?"), say(FAKE_APPS)] }), "verify");
await check("routeAfterModel", "a normal answer -> still END", () => routeAfterModel({ messages: [ask("hi"), say("Hello!")] }), END);

await check("Turns ignore the reminder", "toolsUsedThisTurn still counts from the REAL question", () =>
  toolsUsedThisTurn([ask("which app?"), say(FAKE_APPS), reminder(), call("getTopApps")]), ["getTopApps"]);
await check("Turns ignore the reminder", "selectContext: the made-up answer is NOT kept in memory", () =>
  short(selectContext([ask("which app?"), say(FAKE_APPS), reminder(), call("getTopApps"), new ToolMessage({ content: "{}", tool_call_id: `v${id}` }), say("Chrome uses most."), ask("next")])),
  ["human:which app?", "ai:Chrome uses most.", "human:next"]);

await check("In the graph", "made-up answer -> verify -> tool -> real answer", async () => {
  ran = [];
  const g = buildGraph({ model: fakeModel([say(FAKE_APPS), call("getTopApps"), say("Google Chrome uses the most: 1.5 GB.")]), tools: TOOLS });
  const r = await g.invoke({ messages: [ask("which app should i close?")] }, cfg("v1"));
  return [r.messages.at(-1).content, ran, toolsUsedThisTurn(r.messages)];
}, ["Google Chrome uses the most: 1.5 GB.", ["getTopApps"], ["getTopApps"]]);
await check("In the graph", "the model really received the reminder", async () => {
  const g = buildGraph({ model: fakeModel([say(FAKE_APPS), call("getTopApps"), say("ok")]), tools: TOOLS });
  await g.invoke({ messages: [ask("which app?")] }, cfg("v2"));
  return sent[1].at(-1).content;
}, VERIFY_MESSAGE);
await check("In the graph", "only ONCE: made up twice -> returned (index.js then warns you)", async () => {
  const g = buildGraph({ model: fakeModel([() => say(FAKE_APPS)]), tools: TOOLS });
  const r = await g.invoke({ messages: [ask("which app?")] }, cfg("v3"));
  return [sent.length, hasData(r.messages.at(-1).content), toolsUsedThisTurn(r.messages)];
}, [2, true, []]);
await check("In the graph", "a greeting -> no verify, one model call", async () => {
  const g = buildGraph({ model: fakeModel([say("Hello!")]), tools: TOOLS });
  await g.invoke({ messages: [ask("hi")] }, cfg("v4"));
  return sent.length;
}, 1);
await check("In the graph", "next question: memory has the REAL answer, not the made-up one", async () => {
  const g = buildGraph({ model: fakeModel([say(FAKE_APPS), call("getTopApps"), say("Chrome uses the most."), say("Sure.")]), tools: TOOLS });
  await g.invoke({ messages: [ask("which app?")] }, cfg("v5"));
  await g.invoke({ messages: [ask("thanks")] }, cfg("v5"));
  return short(sent.at(-1).slice(1));
}, ["human:which app?", "ai:Chrome uses the most.", "human:thanks"]);

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
