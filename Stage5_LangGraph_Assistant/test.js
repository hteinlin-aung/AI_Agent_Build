// Self-checking runner for Stage 5 (lc-tools.js + graph.js).
// Run with:  node test.js   — a FAKE model and FAKE tools: no Ollama, nothing on your Mac is touched.
// don't need to edit this file.

import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";
import { MemorySaver, Command, END, GraphRecursionError } from "@langchain/langgraph";
import { makeTools, ACTION_TOOLS } from "./lc-tools.js";
import {
  describeActions, routeAfterModel, routeAfterApproval, toolsUsedThisTurn, selectContext,
  createAgentNode, buildGraph, SYSTEM_PROMPT,
} from "./graph.js";

// --- Runner -----------------------------------------------------------------------------------
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
  } catch (err) { fail++; console.log(`  ERROR ${label}\n        ${err.message.split("\n")[0]}`); }
}
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

// --- Helpers to build messages --------------------------------------------------------------------
let idCounter = 0;
const ask = (text) => new HumanMessage(text);
const say = (text, meta = {}) => new AIMessage({ content: text, response_metadata: meta });
const call = (...calls) => new AIMessage({ content: "", tool_calls: calls.map(([name, args = {}]) => ({ name, args, id: `c${++idCounter}`, type: "tool_call" })) });
const result = (name, content = "{}") => new ToolMessage({ content, tool_call_id: `r${++idCounter}`, name });
const short = (messages) => messages?.map((m) => `${m.getType()}:${m.content || (m.tool_calls ?? []).map((c) => c.name).join("+")}`);

// A fake toolbox (plain functions, like your tools.js) that records what ran
let ran = [];
const fakeToolbox = {
  getSystemInfo: () => ({ chip: "Apple M3", memoryGB: 8 }),
  getDiskSpace: () => { ran.push("getDiskSpace"); return { freeGB: 204.3 }; },
  getMemoryStatus: () => ({ freePercent: 50 }),
  findDuplicates: () => ({ groups: [], totalExtras: 0 }),
  getTopApps: (args) => ({ got: args }),
  findFiles: (args) => ({ got: args }),
  quitApp: (args) => { ran.push("quitApp"); return { quit: args.name }; },
  moveDuplicatesToTrash: (args) => { ran.push("moveDuplicatesToTrash"); return { moved: args.files }; },
  broken: () => { throw new Error("disk not found"); },
};
const TOOLS = makeTools(fakeToolbox);
const byName = (name) => TOOLS.find((t) => t.name === name);

// A fake MODEL: replies with the next message from a script, and records what it was sent
let sentToModel = [];
function fakeModel(script) {
  sentToModel = [];
  let i = 0;
  return { invoke: async (messages) => {
    sentToModel.push(messages);
    const item = script[Math.min(i++, script.length - 1)];
    return typeof item === "function" ? item() : item;   // a function = make a FRESH message each time
  } };
}

// ===================== PART A — lc-tools.js =====================
await check("A. makeTools", "8 tools with the right names", () => TOOLS.map((t) => t.name).sort(),
  ["findDuplicates", "findFiles", "getDiskSpace", "getMemoryStatus", "getSystemInfo", "getTopApps", "moveDuplicatesToTrash", "quitApp"]);
await check("A. makeTools", "every tool has a description", () => TOOLS.every((t) => typeof t.description === "string" && t.description.length > 20), true);
await check("A. makeTools", "the two ACTION descriptions start with \"ACTION\"", () => ACTION_TOOLS.map((n) => byName(n).description.startsWith("ACTION")), [true, true]);
await check("A. makeTools", "getTopApps passes { limit } to your function", () => byName("getTopApps").invoke({ limit: 3 }), JSON.stringify({ got: { limit: 3 } }));
await check("A. makeTools", "getTopApps: limit is OPTIONAL", () => byName("getTopApps").invoke({}), JSON.stringify({ got: {} }));
await check("A. makeTools", "getTopApps: limit \"five\" is rejected by the schema", () => throws(() => byName("getTopApps").invoke({ limit: "five" })), true);
await check("A. makeTools", "findFiles passes { name }", () => byName("findFiles").invoke({ name: "resume" }), JSON.stringify({ got: { name: "resume" } }));
await check("A. makeTools", "findFiles: name is REQUIRED (schema rejects {})", () => throws(() => byName("findFiles").invoke({})), true);
await check("A. makeTools", "quitApp passes { name } (fake ran)", async () => { ran = []; const r = await byName("quitApp").invoke({ name: "Spotify" }); return [r, ran]; },
  [JSON.stringify({ quit: "Spotify" }), ["quitApp"]]);
await check("A. makeTools", "quitApp: name is REQUIRED", () => throws(() => byName("quitApp").invoke({})), true);
await check("A. makeTools", "moveDuplicatesToTrash passes { files }", () => byName("moveDuplicatesToTrash").invoke({ files: ["a (1).pdf"] }), JSON.stringify({ moved: ["a (1).pdf"] }));
await check("A. makeTools", "moveDuplicatesToTrash: files must be a LIST of texts", () => throws(() => byName("moveDuplicatesToTrash").invoke({ files: "a (1).pdf" })), true);
await check("A. makeTools", "a tool that throws -> error JSON (via asText)", () =>
  makeTools({ ...fakeToolbox, getDiskSpace: fakeToolbox.broken }).find((t) => t.name === "getDiskSpace").invoke({}), JSON.stringify({ error: "disk not found" }));

// ===================== PART B — pure helpers =====================
await check("1. describeActions", "one quitApp", () => describeActions([{ name: "quitApp", args: { name: "Spotify" } }]), 'Quit the app "Spotify"');
await check("1. describeActions", "leaves read-only calls out", () =>
  describeActions([{ name: "getDiskSpace", args: {} }, { name: "moveDuplicatesToTrash", args: { files: ["a (1).pdf"] } }]),
  "Move 1 file(s) from Downloads to the Trash:\n  - a (1).pdf");
await check("1. describeActions", "two actions -> joined with \\n", () =>
  describeActions([{ name: "quitApp", args: { name: "Spotify" } }, { name: "quitApp", args: { name: "Discord" } }]),
  'Quit the app "Spotify"\nQuit the app "Discord"');

await check("2. routeAfterModel", "plain answer -> END", () => routeAfterModel({ messages: [ask("hi"), say("Hello!")] }), END);
await check("2. routeAfterModel", "tool_calls = [] -> END", () => routeAfterModel({ messages: [new AIMessage({ content: "ok", tool_calls: [] })] }), END);
await check("2. routeAfterModel", "read-only tools -> \"tools\"", () => routeAfterModel({ messages: [ask("q"), call(["getDiskSpace"], ["getMemoryStatus"])] }), "tools");
await check("2. routeAfterModel", "an action -> \"approve\"", () => routeAfterModel({ messages: [ask("q"), call(["quitApp", { name: "Spotify" }])] }), "approve");
await check("2. routeAfterModel", "read-only + action together -> \"approve\"", () => routeAfterModel({ messages: [call(["getDiskSpace"], ["moveDuplicatesToTrash", { files: [] }])] }), "approve");

await check("3. routeAfterApproval", "last is a ToolMessage (you said no) -> \"agent\"", () => routeAfterApproval({ messages: [call(["quitApp"]), result("quitApp")] }), "agent");
await check("3. routeAfterApproval", "last is the AI message (you said yes) -> \"tools\"", () => routeAfterApproval({ messages: [ask("q"), call(["quitApp"])] }), "tools");

const CONVO = [
  ask("Q1"), call(["a"]), result("a"), say("answer 1"),
  ask("Q2"), call(["b"], ["c"]), result("b"), result("c"), say("answer 2"),
];
await check("4. toolsUsedThisTurn", "only tools after the LAST human message", () => toolsUsedThisTurn(CONVO), ["b", "c"]);
await check("4. toolsUsedThisTurn", "a turn with no tools -> []", () => toolsUsedThisTurn([...CONVO, ask("hi"), say("hello")]), []);
await check("4. toolsUsedThisTurn", "no human message -> looks at everything", () => toolsUsedThisTurn([call(["x"]), result("x"), call(["y"])]), ["x", "y"]);
await check("4. toolsUsedThisTurn", "empty -> []", () => toolsUsedThisTurn([]), []);

const LONG = [
  ask("Q1"), say("A1"),
  ask("Q2"), call(["getDiskSpace"]), result("getDiskSpace", '{"freeGB":204}'), say("A2"),
  ask("Q3"), call(["getMemoryStatus"]), result("getMemoryStatus"), say("A3"),
  ask("Q4"), say("A4"),
  ask("Q5"), call(["getTopApps"]), result("getTopApps"),
];
await check("5. selectContext", "past turns -> question + final answer; current turn kept whole; oldest dropped", () => short(selectContext(LONG)),
  ["human:Q2", "ai:A2", "human:Q3", "ai:A3", "human:Q4", "ai:A4", "human:Q5", "ai:getTopApps", "tool:{}"]);
await check("5. selectContext", "maxPastTurns = 1", () => short(selectContext(LONG, 1)), ["human:Q4", "ai:A4", "human:Q5", "ai:getTopApps", "tool:{}"]);
await check("5. selectContext", "only one turn -> everything", () => short(selectContext([ask("Q"), call(["a"]), result("a")])), ["human:Q", "ai:a", "tool:{}"]);
await check("5. selectContext", "a past turn with no final answer keeps only its question", () =>
  short(selectContext([ask("Q1"), call(["a"]), result("a"), ask("Q2")])), ["human:Q1", "human:Q2"]);
await check("5. selectContext", "messages before the first question are dropped", () => short(selectContext([say("stray"), ask("Q")])), ["human:Q"]);
await check("5. selectContext", "doesn't change the input", () => { const copy = [...LONG]; selectContext(LONG); return LONG.length === copy.length && LONG.every((m, i) => m === copy[i]); }, true);

// ===================== PART C — the nodes and the graph =====================
await check("6. createAgentNode", "sends the system prompt FIRST, then the context", async () => {
  const node = createAgentNode(fakeModel([say("hi there")]));
  await node({ messages: [ask("hello")] });
  const sent = sentToModel[0];
  return [sent[0] instanceof SystemMessage, sent[0].content === SYSTEM_PROMPT, short(sent.slice(1))];
}, [true, true, ["human:hello"]]);
await check("6. createAgentNode", "returns an UPDATE: { messages: [reply] }", async () => {
  const reply = say("hi there");
  const update = await createAgentNode(fakeModel([reply]))({ messages: [ask("hello")] });
  return [Object.keys(update), update.messages.length, update.messages[0] === reply];
}, [["messages"], 1, true]);
await check("6. createAgentNode", "uses selectContext (old tool results are NOT sent)", async () => {
  await createAgentNode(fakeModel([say("ok")]))({ messages: LONG });
  return short(sentToModel[0].slice(1));
}, ["human:Q2", "ai:A2", "human:Q3", "ai:A3", "human:Q4", "ai:A4", "human:Q5", "ai:getTopApps", "tool:{}"]);
await check("6. createAgentNode", "cut-off reply (done_reason \"length\") -> throws", () =>
  throws(() => createAgentNode(fakeModel([say("Your Mac has", { done_reason: "length" })]))({ messages: [ask("q")] })), true);
await check("6. createAgentNode", "cut-off but WITH a tool call -> allowed", async () => {
  const reply = call(["getDiskSpace"]); reply.response_metadata = { done_reason: "length" };
  const update = await createAgentNode(fakeModel([reply]))({ messages: [ask("q")] });
  return update.messages.length;
}, 1);

const cfg = (id) => ({ configurable: { thread_id: id }, recursionLimit: 16 });

await check("8. buildGraph", "has the nodes agent, approve, tools", async () => {
  const g = buildGraph({ model: fakeModel([say("x")]), tools: TOOLS });
  const drawn = await g.getGraphAsync();
  return ["agent", "approve", "tools"].map((n) => n in drawn.nodes);
}, [true, true, true]);
await check("8. buildGraph", "read-only question: model -> tools -> model -> answer", async () => {
  ran = [];
  const g = buildGraph({ model: fakeModel([call(["getDiskSpace"]), say("You have 204.3 GB free.")]), tools: TOOLS });
  const r = await g.invoke({ messages: [ask("How much storage?")] }, cfg("t1"));
  return [r.messages.at(-1).content, ran, toolsUsedThisTurn(r.messages), r.__interrupt__ === undefined];
}, ["You have 204.3 GB free.", ["getDiskSpace"], ["getDiskSpace"], true]);
await check("8. buildGraph", "the model READ the tool result in its 2nd call", async () => {
  const g = buildGraph({ model: fakeModel([call(["getDiskSpace"]), say("ok")]), tools: TOOLS });
  await g.invoke({ messages: [ask("How much storage?")] }, cfg("t2"));
  return sentToModel[1].at(-1).content;
}, JSON.stringify({ freeGB: 204.3 }));

await check("7. approveNode (in the graph)", "an action PAUSES the graph; nothing has run yet", async () => {
  ran = [];
  const g = buildGraph({ model: fakeModel([call(["quitApp", { name: "Spotify" }]), say("Done.")]), tools: TOOLS });
  const r = await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("t3"));
  return [r.__interrupt__?.[0]?.value?.description, ran];
}, ['Quit the app "Spotify"', []]);
await check("7. approveNode (in the graph)", "resume with \"y\" -> the tool runs, then the answer", async () => {
  ran = [];
  const g = buildGraph({ model: fakeModel([call(["quitApp", { name: "Spotify" }]), say("Spotify is closed.")]), tools: TOOLS });
  await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("t4"));
  const r = await g.invoke(new Command({ resume: "y" }), cfg("t4"));
  return [r.messages.at(-1).content, ran];
}, ["Spotify is closed.", ["quitApp"]]);
await check("7. approveNode (in the graph)", "resume with \"n\" -> NOT run; the model is told it was declined", async () => {
  ran = [];
  const g = buildGraph({ model: fakeModel([call(["quitApp", { name: "Spotify" }]), say("Okay, I left it open.")]), tools: TOOLS });
  await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("t5"));
  const r = await g.invoke(new Command({ resume: "n" }), cfg("t5"));
  return [r.messages.at(-1).content, ran, JSON.parse(sentToModel[1].at(-1).content).declined];
}, ["Okay, I left it open.", [], true]);
await check("7. approveNode (in the graph)", "resume with \"yes\" (not exactly \"y\") -> declined (fail closed)", async () => {
  ran = [];
  const g = buildGraph({ model: fakeModel([call(["quitApp", { name: "Spotify" }]), say("ok")]), tools: TOOLS });
  await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("t6"));
  await g.invoke(new Command({ resume: "yes" }), cfg("t6"));
  return ran;
}, []);
await check("7. approveNode (in the graph)", "declined -> EVERY tool call in that reply gets an answer", async () => {
  const g = buildGraph({ model: fakeModel([call(["getDiskSpace"], ["quitApp", { name: "Spotify" }]), say("ok")]), tools: TOOLS });
  await g.invoke({ messages: [ask("q")] }, cfg("t7"));
  const r = await g.invoke(new Command({ resume: "n" }), cfg("t7"));
  return r.messages.filter((m) => m.getType() === "tool").length;
}, 2);

await check("Memory (checkpointer)", "same thread -> the model sees the earlier question + answer", async () => {
  const g = buildGraph({ model: fakeModel([say("You have plenty of space."), say("About half of it.")]), tools: TOOLS });
  await g.invoke({ messages: [ask("How much storage?")] }, cfg("mem1"));
  await g.invoke({ messages: [ask("And how much is used?")] }, cfg("mem1"));
  return short(sentToModel[1].slice(1));
}, ["human:How much storage?", "ai:You have plenty of space.", "human:And how much is used?"]);
await check("Memory (checkpointer)", "a NEW thread -> a fresh conversation (this is \"reset\")", async () => {
  const g = buildGraph({ model: fakeModel([say("You have plenty of space."), say("What do you mean?")]), tools: TOOLS });
  await g.invoke({ messages: [ask("How much storage?")] }, cfg("mem2"));
  await g.invoke({ messages: [ask("And how much is used?")] }, cfg("mem3"));
  return short(sentToModel[1].slice(1));
}, ["human:And how much is used?"]);
await check("Safety limit", "a model that never stops -> GraphRecursionError", async () => {
  const g = buildGraph({ model: fakeModel([() => call(["getDiskSpace"])]), tools: TOOLS });
  try { await g.invoke({ messages: [ask("loop")] }, { configurable: { thread_id: "loop" }, recursionLimit: 6 }); return "no error"; }
  catch (err) { return err instanceof GraphRecursionError; }
}, true);

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
