// Stage 4b — the chat window. Run with:  node index.js
// Given (input/output plumbing). The thinking happens in agent.js; the safety gate is runTool.

import readline from "readline";
import { runAgent, unloadModel, MODEL } from "./agent.js";

// --- Reading lines -----------------------------------------------------------------
// now the program sometimes needs a line in the MIDDLE of an answer (your y/n). With for-await, your "y"
// would be swallowed as the next question. This small queue hands each line to whoever is
// waiting for it: the chat loop, or the permission question.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const queued = [];
const waiting = [];
let closed = false;
rl.on("line", (line) => (waiting.length ? waiting.shift()(line) : queued.push(line)));
rl.on("close", () => {
  closed = true;
  while (waiting.length) waiting.shift()(null);
});
function nextLine(prompt) {
  process.stdout.write(prompt);
  if (queued.length) return Promise.resolve(queued.shift());
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => waiting.push(resolve));
}

// --- The real "confirm": u decide -------------------------------------------------
// runTool calls this before any ACTION. Only a plain "y" counts as yes; anything else is no.
async function askPermission(description) {
  console.log(`\n⚠️  The assistant wants to:\n${description}`);
  const reply = await nextLine("Allow? (y/n) ");
  const allowed = (reply ?? "").trim().toLowerCase() === "y";
  console.log(allowed ? "  → allowed" : "  → not allowed — nothing was changed");
  return allowed;
}

console.log(`Mac assistant (${MODEL}). It can quit apps and tidy duplicate files in Downloads — only if you say y.`);
console.log(`Try: "Why is my Mac slow?"  "Quit Spotify"  "Find duplicate files in my Downloads"`);
console.log(`Type "reset" to clear its memory, "exit" (or "quit") to leave.`);

let history = [];

while (true) {
  const line = await nextLine("\nYou: ");
  if (line === null) break;                       // input closed (Ctrl+D)
  const question = line.trim();
  if (["exit", "quit"].includes(question.toLowerCase())) break;

  if (question.toLowerCase() === "reset") {
    history = [];
    console.log("Memory cleared.");
    continue;
  }
  if (question === "") continue;

  const start = Date.now();
  try {
    const result = await runAgent(question, { history, confirm: askPermission });
    history = result.history;
    const seconds = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nAssistant: ${result.answer}`);
    console.log(`  (tools: ${result.toolsUsed.join(", ") || "none"} · steps: ${result.steps} · ${seconds}s)`);
  } catch (err) {
    console.log(`\nError: ${err.message}`);
    console.log("Is Ollama running? Check with: ollama list");
  }
}

rl.close();
await unloadModel(MODEL);
console.log("\nBye — model unloaded from memory.");
