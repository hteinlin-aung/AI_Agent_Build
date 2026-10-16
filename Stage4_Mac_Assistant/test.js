// Self-checking runner for tools.js and agent.js
// Run with:  node test.js   — works with Ollama off.

import {
  bytesToGB, parseSwapUsage, parseFreePercent, pressureLevel, parseTopProcesses, TOOLS,
} from "./tools.js";
import { TOOL_DEFINITIONS, MODEL, SYSTEM_PROMPT, runTool, askAgent, runAgent } from "./agent.js";


// --- Runner ----
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


// --- A scripted fake model ------

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
function fakeModelStatus(status) {
  globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ error: "boom" }) });
}
const core = (r) => ({ answer: r.answer, toolsUsed: r.toolsUsed, steps: r.steps, stoppedEarly: r.stoppedEarly });
const callTool = (name, args = {}) => ({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] });
const say = (text) => ({ role: "assistant", content: text });

// A fake toolbox, so the agent tests don't depend on your Mac
const fakeTools = {
  getDiskSpace: () => ({ totalGB: 494.4, freeGB: 203, usedGB: 291.4, usedPercent: 59 }),
  getMemoryStatus: () => ({ freePercent: 12, pressure: "critical", swapUsedGB: 4.2, swapTotalGB: 5 }),
  brokenTool: () => { throw new Error("disk not found"); },
  echo: (args) => ({ got: args }),
  slow: async () => ({ ok: true }),
};

// ========== tools.js — pure helpers ============
await check("1. bytesToGB", "8 GiB -> 8", () => bytesToGB(8589934592), 8);
await check("1. bytesToGB", "1.5 GiB -> 1.5", () => bytesToGB(1610612736), 1.5);
await check("1. bytesToGB", "rounds to one decimal", () => bytesToGB(530000000000), 493.6);
await check("1. bytesToGB", "0 -> 0", () => bytesToGB(0), 0);

const SWAP = "total = 4096.00M  used = 3141.25M  free = 954.75M  (encrypted)";
await check("2. parseSwapUsage", "real macOS line", () => parseSwapUsage(SWAP), { totalGB: 4, usedGB: 3.1 });
await check("2. parseSwapUsage", "no swap in use", () => parseSwapUsage("total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)"), { totalGB: 0, usedGB: 0 });
await check("2. parseSwapUsage", "other text -> null", () => parseSwapUsage("sysctl: unknown oid"), null);

const PRESSURE = `The system has 8589934592 (2097152 pages with a page size of 4096).
Stats:
Pages free: 12000
Swapins: 1203
System-wide memory free percentage: 23%`;
await check("3. parseFreePercent", "finds the percentage line", () => parseFreePercent(PRESSURE), 23);
await check("3. parseFreePercent", "single digit", () => parseFreePercent("System-wide memory free percentage: 7%"), 7);
await check("3. parseFreePercent", "no line -> null", () => parseFreePercent("nothing here"), null);

await check("4. pressureLevel", "62 -> normal", () => pressureLevel(62), "normal");
await check("4. pressureLevel", "30 -> normal (edge)", () => pressureLevel(30), "normal");
await check("4. pressureLevel", "23 -> elevated", () => pressureLevel(23), "elevated");
await check("4. pressureLevel", "15 -> elevated (edge)", () => pressureLevel(15), "elevated");
await check("4. pressureLevel", "7 -> critical", () => pressureLevel(7), "critical");
await check("4. pressureLevel", "null -> unknown", () => pressureLevel(null), "unknown");

const PS = `  2048 /usr/libexec/logd
  512000 /Applications/Spotify.app/Contents/MacOS/Spotify

 1536000 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper (Renderer)
garbage line
  4194304 /usr/local/bin/ollama
   10240 kernel_task`;
await check("5. parseTopProcesses", "top 2, biggest first", () => parseTopProcesses(PS, 2),
  [{ name: "ollama", memoryMB: 4096 }, { name: "Cursor Helper (Renderer)", memoryMB: 1500 }]);
await check("5. parseTopProcesses", "names with spaces survive; no-slash name kept", () => parseTopProcesses(PS, 10).map((p) => p.name),
  ["ollama", "Cursor Helper (Renderer)", "Spotify", "kernel_task", "logd"]);
await check("5. parseTopProcesses", "kilobytes -> MB, rounded", () => parseTopProcesses(PS, 10).map((p) => p.memoryMB),
  [4096, 1500, 500, 10, 2]);
await check("5. parseTopProcesses", "empty text -> []", () => parseTopProcesses("", 5), []);

// ===================== the toolbox and the definitions agree =====================
await check("Toolbox", "TOOLS has 5 functions",
  () => Object.values(TOOLS).filter((f) => typeof f === "function").length, 5);
await check("Toolbox", "every TOOL_DEFINITION name exists in TOOLS",
  () => TOOL_DEFINITIONS.every((d) => typeof TOOLS[d.function.name] === "function"), true);

// ===================== agent.js — runTool =====================
await check("6. runTool", "returns a JSON string of the result", () => runTool("getDiskSpace", {}, fakeTools),
  JSON.stringify({ totalGB: 494.4, freeGB: 203, usedGB: 291.4, usedPercent: 59 }));
await check("6. runTool", "passes the arguments to the tool", () => runTool("echo", { name: "thesis" }, fakeTools),
  JSON.stringify({ got: { name: "thesis" } }));
await check("6. runTool", "works with an async tool", () => runTool("slow", {}, fakeTools), JSON.stringify({ ok: true }));
await check("6. runTool", "unknown tool -> error JSON (no crash)", () => runTool("deleteEverything", {}, fakeTools),
  JSON.stringify({ error: "Unknown tool: deleteEverything" }));
await check("6. runTool", "tool throws -> error JSON (no crash)", () => runTool("brokenTool", {}, fakeTools),
  JSON.stringify({ error: "disk not found" }));

// ===================== agent.js — askAgent =====================
await check("7. askAgent", "returns the message object", async () => {
  fakeModel([say("hello")]);
  return await askAgent([{ role: "user", content: "hi" }]);
}, { role: "assistant", content: "hello" });
await check("7. askAgent", "sends model, messages, tools, stream:false, think:false", async () => {
  fakeModel([say("x")]);
  await askAgent([{ role: "user", content: "hi" }]);
  const b = sent[0];
  return [b.model, b.messages.length, b.tools.length, b.stream, b.think];
}, [MODEL, 1, 5, false, false]);
await check("7. askAgent", "options: temperature 0, num_ctx 4096, num_predict 400", async () => {
  fakeModel([say("x")]);
  await askAgent([]);
  return sent[0].options;
}, { temperature: 0, num_ctx: 4096, num_predict: 400 });
await check("7. askAgent", "throws when response.ok is false", async () => {
  fakeModelStatus(500);
  try { await askAgent([]); return "did not throw"; } catch (err) { return err.message.includes("500"); }
}, true);

// ===================== agent.js — runAgent (the loop) =====================
await check("8. runAgent", "no tool needed -> answers in 1 step", async () => {
  fakeModel([say("Hi! Ask me about your Mac.")]);
  return core(await runAgent("hello", { toolbox: fakeTools }));
}, { answer: "Hi! Ask me about your Mac.", toolsUsed: [], steps: 1, stoppedEarly: false });

await check("8. runAgent", "first request = system prompt + user question", async () => {
  fakeModel([say("ok")]);
  await runAgent("How much storage?", { toolbox: fakeTools });
  return sent[0].messages;
}, [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "How much storage?" }]);

await check("8. runAgent", "one tool, then the answer -> 2 steps", async () => {
  fakeModel([callTool("getDiskSpace"), say("You have 203 GB free.")]);
  return core(await runAgent("How much storage?", { toolbox: fakeTools }));
}, { answer: "You have 203 GB free.", toolsUsed: ["getDiskSpace"], steps: 2, stoppedEarly: false });

await check("8. runAgent", "2nd request contains the model's call AND the tool result", async () => {
  fakeModel([callTool("getDiskSpace"), say("done")]);
  await runAgent("How much storage?", { toolbox: fakeTools });
  const m = sent[1].messages;
  return [m.length, m[2].tool_calls[0].function.name, m[3].role, m[3].tool_name, JSON.parse(m[3].content).freeGB];
}, [4, "getDiskSpace", "tool", "getDiskSpace", 203]);

await check("8. runAgent", "passes the model's arguments to the tool", async () => {
  fakeModel([callTool("echo", { name: "thesis" }), say("done")]);
  await runAgent("find thesis", { toolbox: fakeTools });
  return JSON.parse(sent[1].messages[3].content);
}, { got: { name: "thesis" } });

await check("8. runAgent", "two tools in one reply -> both run, in order", async () => {
  fakeModel([
    { role: "assistant", content: "", tool_calls: [
      { function: { name: "getMemoryStatus", arguments: {} } },
      { function: { name: "getDiskSpace", arguments: {} } },
    ] },
    say("Your memory is under pressure."),
  ]);
  const r = await runAgent("Why is my Mac slow?", { toolbox: fakeTools });
  return [r.toolsUsed, sent[1].messages.filter((m) => m.role === "tool").map((m) => m.tool_name)];
}, [["getMemoryStatus", "getDiskSpace"], ["getMemoryStatus", "getDiskSpace"]]);

await check("8. runAgent", "unknown tool -> no crash, the model sees the error", async () => {
  fakeModel([callTool("deleteEverything"), say("I can't do that.")]);
  const r = await runAgent("delete stuff", { toolbox: fakeTools });
  return [r.answer, JSON.parse(sent[1].messages[3].content).error];
}, ["I can't do that.", "Unknown tool: deleteEverything"]);

await check("8. runAgent", "missing arguments -> tool gets {}", async () => {
  fakeModel([{ role: "assistant", content: "", tool_calls: [{ function: { name: "echo" } }] }, say("done")]);
  await runAgent("x", { toolbox: fakeTools });
  return JSON.parse(sent[1].messages[3].content);
}, { got: {} });

await check("8. runAgent", "never finishes -> stops at maxSteps (safety limit)", async () => {
  fakeModel([callTool("getDiskSpace")]); // always asks for a tool again
  const r = await runAgent("loop forever", { maxSteps: 3, toolbox: fakeTools });
  return [r.stoppedEarly, r.steps, r.toolsUsed.length, sent.length, r.answer];
}, [true, 3, 3, 3, "I stopped after 3 steps without finishing."]);

await check("8. runAgent", "default maxSteps is 5", async () => {
  fakeModel([callTool("getDiskSpace")]);
  const r = await runAgent("loop forever", { toolbox: fakeTools });
  return [r.steps, sent.length];
}, [5, 5]);

await check("8. runAgent", "Ollama error is NOT swallowed (index.js handles it)", async () => {
  fakeModelStatus(500);
  try { await runAgent("x", { toolbox: fakeTools }); return "did not throw"; } catch (err) { return "threw"; }
}, "threw");

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
