// Stage 4 — the chat window. Run with:  node index.js
// (it's only input, output plumbing) thinking happens in agent.js.

import readline from "readline";
import { runAgent, unloadModel, MODEL } from "./agent.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log(`Mac assistant (${MODEL}, read-only). Ask a question, or type "exit".`);
console.log(`Try: "How much storage do I have?"  "Why is my Mac slow?"  "Find my thesis files"`);
rl.setPrompt("\nYou: ");
rl.prompt();

let history = [];

for await (const line of rl) {
  const question = line.trim();
  if (question.toLowerCase() === "exit") break;

  if (question.toLowerCase() === "reset") {
    history = [];
    console.log("Memory cleared.");
    rl.prompt();
    continue;
  }

  if (question !== "") {
    const start = Date.now();
    try {
      const result = await runAgent(question, {history});
      history = result.history;
      const seconds = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`\nAssistant: ${result.answer}`);
      console.log(`  (tools: ${result.toolsUsed.join(", ") || "none"} · steps: ${result.steps} · ${seconds}s)`);
    } catch (err) {
      console.log(`\nError: ${err.message}`);
      console.log("Is Ollama running? Check with: ollama list");
    }
  }
  rl.prompt();
}

rl.close();
await unloadModel(MODEL);
console.log("\nBye — model unloaded from memory.");
