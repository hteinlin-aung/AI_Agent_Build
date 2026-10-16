// Stage 2 — Ticket Triage with a real language model (Ollama)
//  (Ollama must be running — check with `ollama list`)

import { readFileSync } from "fs";
import { classifyCategory, determinePriority, assignTicket } from "./rules.js";
import { classifyWithModel } from "./model.js";

const tickets = JSON.parse(readFileSync("./data/tickets.json", "utf-8"));


async function run() {

   const startTime = Date.now();
   let changedCount = 0;
   let fallback = 0;

  for(const ticket of tickets){

    const rulesCategory = classifyCategory(ticket)

    const {category, source} = await classifyWithModel(ticket);

    const priority = determinePriority(ticket)
    const assignee = assignTicket(category, priority);

    if(category !== rulesCategory) changedCount ++;
    if(source !== "model") fallback ++;


    console.log(
      `${ticket.id} rules:${rulesCategory} model:${category} (${source}) -> ${assignee} ${category !== rulesCategory ? "<-- changed" : ""}`
    ) 
  }

  const time = ((Date.now()- startTime) / 1000).toFixed(1);
  console.log("\n ----- Summary -----")
  console.log(`Tickets: ${tickets.length}`)
  console.log(`Changed by model: ${changedCount}`);
  console.log(`Fell back to rules: ${fallback}`)
  console.log(`Time: ${time}s`)

}

run();
