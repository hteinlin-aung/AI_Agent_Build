// Stage 5 — the chat window. Run with:  node index.js
// Given (input/output plumbing). The agent itself is the graph in graph.js.

import readline from "readline";
import { randomUUID } from "crypto";
import { HumanMessage } from "@langchain/core/messages";
import { Command, GraphRecursionError } from "@langchain/langgraph";
import { makeTools } from "./lc-tools.js";
import { buildGraph, createModel, unloadModel, toolsUsedThisTurn, hasData, remindersThisTurn, MODEL, RECURSION_LIMIT } from "./graph.js";

// --- Reading lines (same small queue as Stage 4b, so a y/n can be asked mid-answer) ----------
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

// --- Build the agent ----------------------------------------------------------------------------
const tools = makeTools();
const graph = buildGraph({ model: createModel(tools), tools });

// A THREAD is one conversation. The checkpointer saves each thread's state under its id.
// Same id = it remembers. New id = a fresh conversation ("reset").
let threadId = randomUUID();
const config = () => ({ configurable: { thread_id: threadId }, recursionLimit: RECURSION_LIMIT });

console.log(`Mac assistant — LangGraph edition (${MODEL}). Actions only happen if you say y.`);
console.log(`Try: "Why is my Mac slow?"  "Quit Spotify"  "Find duplicate files in my Downloads"`);
console.log(`Type "reset" for a new conversation, "exit" (or "quit") to leave.`);

while (true) {
  const line = await nextLine("\nYou: ");
  if (line === null) break;

  const question = line.trim();
  if (["exit", "quit"].includes(question.toLowerCase())) break;

  if (question.toLowerCase() === "reset") {
    threadId = randomUUID();
    console.log("New conversation — memory cleared.");
    continue;
  }
  if (question === "") continue;

  const start = Date.now();
  try {
    // Run the graph with ONE new message. The checkpointer adds the earlier ones by itself.
    let result = await graph.invoke({ messages: [new HumanMessage(question)] }, config());

    // Did the graph PAUSE at interrupt()? Then __interrupt__ holds what the approve node sent.
    while (result.__interrupt__?.length) {
      
      console.log(`\n⚠️  The assistant wants to:\n${result.__interrupt__[0].value.description}`);
      const reply = (await nextLine("Allow? (y/n) ")) ?? "n";       // closed input = no
      const answer = reply.trim().toLowerCase();
      console.log(answer === "y" ? "  → allowed" : "  → not allowed — nothing was changed");
      // RESUME: same thread, and Command({ resume }) becomes interrupt()'s return value.
      result = await graph.invoke(new Command({ resume: answer }), config());
    }

    const seconds = ((Date.now() - start) / 1000).toFixed(1);
    const used = toolsUsedThisTurn(result.messages);
    const answer = result.messages.at(-1).content;
    console.log(`\nAssistant: ${answer}`);
    // (verify) last line of defence: data in the answer, but no tool behind it -> warn YOU
    if (used.length === 0 && hasData(answer)) {
      console.log("  ⚠️  No tool was used for this answer — these numbers may be made up.");
    }
    const reminders = remindersThisTurn(result.messages);   // which checks fired (verify / parrot)
    const remindersText = reminders.length ? ` · reminders: ${reminders.join(", ")}` : "";
    console.log(`  (tools: ${used.join(", ") || "none"}${remindersText} · ${seconds}s)`);
  } catch (err) {
    if (err instanceof GraphRecursionError) {
      console.log(`\nI stopped after too many steps (recursion limit ${RECURSION_LIMIT}).`);
    } else {
      console.log(`\nError: ${err.message}`);
      console.log("Is Ollama running? Check with: ollama list");
    }
    // A thread that crashed mid-way can't be continued cleanly, so start a fresh one.
    threadId = randomUUID();
    console.log("(Started a new conversation.)");
  }
}

rl.close();
await unloadModel(MODEL);
console.log("\nBye — model unloaded from memory.");
