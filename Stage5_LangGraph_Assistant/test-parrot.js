// Checks for THE PARROT CHECK in graph.js. Run with:  node test-parrot.js
// Fake model + fake tools: no Ollama needed, nothing on your Mac is touched.

import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { END, Command } from "@langchain/langgraph";
import { makeTools } from "./lc-tools.js";
import {
  sameText, pastTurns, isParroting, wasDeclined, remindersThisTurn, isQuestion, routeAfterModel, toolsUsedThisTurn, selectContext,
  buildGraph, PARROT_MESSAGE, PARROT_NAME,
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
const call = (name, args = {}) => new AIMessage({ content: "", tool_calls: [{ name, args, id: `p${++id}`, type: "tool_call" }] });
const declined = () => new ToolMessage({ content: JSON.stringify({ declined: true }), tool_call_id: `p${id}`, name: "quitApp" });
const reminder = () => new HumanMessage({ content: PARROT_MESSAGE, name: PARROT_NAME });
const short = (ms) => ms?.map((m) => `${m.getType()}${m.name === PARROT_NAME ? "(parrot)" : ""}:${m.content.slice(0, 22) || (m.tool_calls ?? []).map((c) => c.name).join("+")}`);

// The REAL conversation from the 2026-11-08 re-test
const OLD = "You declined to quit Spotify. Nothing was changed.";
const FIRST_TIME = () => [ask("Quit Spotify"), call("quitApp", { name: "Spotify" }), declined(), say(OLD)];

let ran = [];
const TOOLS = makeTools({
  getSystemInfo: () => ({}), getDiskSpace: () => ({}), getMemoryStatus: () => ({}), findDuplicates: () => ({}),
  findFiles: () => ({}), getTopApps: () => ({}), moveDuplicatesToTrash: () => ({}),
  quitApp: ({ name }) => { ran.push("quitApp"); return { quit: name }; },
});
let sent = [];
const fakeModel = (script) => { sent = []; let i = 0; return { invoke: async (m) => { sent.push(m); const x = script[Math.min(i++, script.length - 1)]; return typeof x === "function" ? x() : x; } }; };
const cfg = (t) => ({ configurable: { thread_id: t }, recursionLimit: 16 });

await check("sameText", "identical -> true", () => sameText(OLD, OLD), true);
await check("sameText", "different case / extra spaces -> still true", () => sameText("  you declined to quit  Spotify. Nothing was changed.", OLD), true);
await check("sameText", "different text -> false", () => sameText("Spotify is closed.", OLD), false);
await check("sameText", "two empty texts -> false", () => sameText("", ""), false);

await check("pastTurns", "one earlier question that used a tool", () => pastTurns([...FIRST_TIME(), ask("Quit Spotify")]), [{ answer: OLD, usedTools: true }]);
await check("pastTurns", "the current question is left out", () => pastTurns([ask("hi")]), []);

await check("isParroting", "THE REAL CASE: same old answer, no tool -> true", () =>
  isParroting({ messages: [...FIRST_TIME(), ask("Quit Spotify"), say(OLD)] }), true);
await check("isParroting", "a repeated greeting (earlier turn used NO tool) -> false", () =>
  isParroting({ messages: [ask("Hi"), say("Hi! How can I help you today?"), ask("Hi"), say("Hi! How can I help you today?")] }), false);
await check("isParroting", "a NEW answer -> false", () =>
  isParroting({ messages: [...FIRST_TIME(), ask("Quit Spotify"), say("Okay, I'll leave it open.")] }), false);
await check("isParroting", "a tool was used this time -> false", () =>
  isParroting({ messages: [...FIRST_TIME(), ask("Quit Spotify"), call("quitApp", { name: "Spotify" }), declined(), say(OLD)] }), false);
await check("isParroting", "already reminded this question -> false (only once)", () =>
  isParroting({ messages: [...FIRST_TIME(), ask("Quit Spotify"), say(OLD), reminder(), say(OLD)] }), false);
await check("routeAfterModel", "the parroted answer -> \"parrot\"", () => routeAfterModel({ messages: [...FIRST_TIME(), ask("Quit Spotify"), say(OLD)] }), "parrot");
await check("routeAfterModel", "a repeated greeting -> still END", () =>
  routeAfterModel({ messages: [ask("Hi"), say("Hi!"), ask("Hi"), say("Hi!")] }), END);

await check("Turns ignore the reminder", "isQuestion(reminder) -> false", () => isQuestion(reminder()), false);
await check("Turns ignore the reminder", "toolsUsedThisTurn counts from the REAL question", () =>
  toolsUsedThisTurn([...FIRST_TIME(), ask("Quit Spotify"), say(OLD), reminder(), call("quitApp", { name: "Spotify" })]), ["quitApp"]);

await check("In the graph", "THE REAL CASE: parrots -> reminded -> calls quitApp -> you're asked y/n AGAIN", async () => {
  const g = buildGraph({ model: fakeModel([call("quitApp", { name: "Spotify" }), say(OLD), say(OLD), call("quitApp", { name: "Spotify" }), say("Spotify is closed.")]), tools: TOOLS });
  await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("p1"));
  await g.invoke(new Command({ resume: "n" }), cfg("p1"));                         // 1st time: you said no
  const r = await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("p1"));         // asked again
  return r.__interrupt__?.[0]?.value?.description;
}, 'Quit the app "Spotify"');
await check("In the graph", "...and this time y -> Spotify really quits", async () => {
  ran = [];
  const g = buildGraph({ model: fakeModel([call("quitApp", { name: "Spotify" }), say(OLD), say(OLD), call("quitApp", { name: "Spotify" }), say("Spotify is closed.")]), tools: TOOLS });
  await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("p2"));
  await g.invoke(new Command({ resume: "n" }), cfg("p2"));
  await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("p2"));
  const r = await g.invoke(new Command({ resume: "y" }), cfg("p2"));
  return [r.messages.at(-1).content, ran];
}, ["Spotify is closed.", ["quitApp"]]);
await check("In the graph", "the model really received the parrot reminder", async () => {
  const g = buildGraph({ model: fakeModel([call("quitApp", { name: "Spotify" }), say(OLD), say(OLD), call("quitApp", { name: "Spotify" })]), tools: TOOLS });
  await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("p3"));
  await g.invoke(new Command({ resume: "n" }), cfg("p3"));
  await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("p3"));
  return sent.at(-1).at(-1).content;
}, PARROT_MESSAGE);
await check("In the graph", "only ONCE: parrots twice -> returned, no loop", async () => {
  const g = buildGraph({ model: fakeModel([call("quitApp", { name: "Spotify" }), say(OLD), () => say(OLD)]), tools: TOOLS });
  await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("p4"));
  await g.invoke(new Command({ resume: "n" }), cfg("p4"));
  const before = sent.length;
  const r = await g.invoke({ messages: [ask("Quit Spotify")] }, cfg("p4"));
  return [sent.length - before, r.messages.at(-1).content];
}, [2, OLD]);
await check("In the graph", "a repeated \"Hi\" -> no reminder, one model call", async () => {
  const g = buildGraph({ model: fakeModel([() => say("Hi! How can I help?")]), tools: TOOLS });
  await g.invoke({ messages: [ask("Hi")] }, cfg("p5"));
  const before = sent.length;
  await g.invoke({ messages: [ask("Hi")] }, cfg("p5"));
  return sent.length - before;
}, 1);
await check("Memory", "the parroted answer is NOT kept; the real one is (and the declined answer is forgotten)", () =>
  short(selectContext([...FIRST_TIME(), ask("Quit Spotify"), say(OLD), reminder(), call("quitApp", { name: "Spotify" }),
    new ToolMessage({ content: "{}", tool_call_id: `p${id}`, name: "quitApp" }), say("Spotify is closed."), ask("next")])),
  ["human:Quit Spotify", "human:Quit Spotify", "ai:Spotify is closed.", "human:next"]);

// ---- (declined) forgetting the answer of a declined action ----
await check("Declined answers are forgotten", "wasDeclined: a turn with a declined tool result -> true", () => wasDeclined(FIRST_TIME()), true);
await check("Declined answers are forgotten", "wasDeclined: an approved action -> false", () =>
  wasDeclined([ask("Quit Spotify"), call("quitApp"), new ToolMessage({ content: '{"quit":"Spotify"}', tool_call_id: `p${id}` }), say("Closed.")]), false);
await check("Declined answers are forgotten", "wasDeclined: a tool result that isn't JSON -> false (no crash)", () =>
  wasDeclined([new ToolMessage({ content: "oops", tool_call_id: "x" })]), false);
await check("Declined answers are forgotten", "THE REAL CASE: the model never sees \"You declined…\" when asked again", () =>
  short(selectContext([...FIRST_TIME(), ask("Quit Spotify")])), ["human:Quit Spotify", "human:Quit Spotify"]);
await check("Declined answers are forgotten", "other past answers are still kept", () =>
  short(selectContext([ask("Hi"), say("Hello!"), ...FIRST_TIME(), ask("Quit Spotify")])), ["human:Hi", "ai:Hello!", "human:Quit Spotify", "human:Quit Spotify"]);

// ---- remindersThisTurn (for the "reminders:" line in index.js) ----
await check("remindersThisTurn", "a parrot reminder this question -> [\"parrot\"]", () =>
  remindersThisTurn([...FIRST_TIME(), ask("Quit Spotify"), say(OLD), reminder(), call("quitApp")]), ["parrot"]);
await check("remindersThisTurn", "reminders in an EARLIER question don't count", () =>
  remindersThisTurn([ask("Quit Spotify"), say(OLD), reminder(), say(OLD), ask("Hi"), say("Hello!")]), []);
await check("remindersThisTurn", "no reminders -> []", () => remindersThisTurn([ask("Hi"), say("Hello!")]), []);

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
