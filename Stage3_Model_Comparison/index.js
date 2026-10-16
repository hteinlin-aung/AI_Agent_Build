// Stage 3 — Compare contenders on the same 20 tickets
// Run with:  node index.js     (Ollama must be running, and both models(llama & qwen) pulled)

import { readFileSync } from "fs";
import { classifyCategory } from "./rules.js";
import { classifyWithModel, unloadModel } from "./model.js";
import { scoreResults, pickWinner } from "./evaluate.js";

const tickets = JSON.parse(readFileSync("./data/tickets.json", "utf-8"));

const CONTENDERS = ["rules", "llama3.2:3b", "qwen3:4b"];

async function runOne(name) {

  const result = [];
  for(const ticket of tickets){
    const time = Date.now();

    let predicted;
    let source;

    if(name === "rules"){
      predicted = classifyCategory(ticket);
      source = "rules"
    }else{
      const result = await classifyWithModel(ticket, name);
      predicted = result.category
      source = result.source
    }

    const ms = Date.now() - time;

    result.push({
      id: ticket.id,
      expected: ticket.expectedCategory,
      predicted,
      source,
      ms
    })
  }
  return result;
}


async function run() {

  const scoreboard = [];
  for (const c of CONTENDERS){
    console.log(` === ${c} ===`);
    const results = await runOne(c)
    const score = scoreResults(results);

    console.log(`Accuracy: ${score.accuracy} (${score.correct}/${score.total}) Fallback: ${score.fallbacks} Avg: ${score.avgMs}`)

    for(const m of score.mistakes){
      console.log(`${m.id} expected ${m.expected}, got ${m.predicted}`);
    }

    scoreboard.push({name: c, score})

    if (c !== "rules") await unloadModel(c);

  }

  console.log(` ---- ScoreBoard ----`);
  for( const {name, score} of scoreboard){
    console.log(` ${name}: Accuracy ${score.accuracy} | Avg ${score.avgMs}ms | Fallbacks ${score.fallbacks}`);
  }
  console.log(`Winner: ${pickWinner(scoreboard)}`)
}

run();
