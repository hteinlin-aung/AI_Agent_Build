// Stage 1 — Rule-Based Support Ticket Triage
import { readFileSync } from "fs";

// --- Loading the data ----

const tickets = JSON.parse(readFileSync("./data/tickets.json", "utf-8"));

function classifyCategory(ticket) {

  const text = (ticket.subject + " " + ticket.body).toLowerCase();

  if(
    text.includes("refund") || 
    text.includes("billing") || 
    text.includes("charge") || 
    text.includes("invoice")
  ){
      return "Billing";
    }

  if(
    text.includes("error") ||
    text.includes("bug") ||
    text.includes("crash") ||
    text.includes("not working") ||
    text.includes("technical")
  ){
    return "Technical";
  }

  return "General";
}


function determinePriority(ticket) {

  const text = (ticket.subject + " " + ticket.body).toLowerCase();

  if(ticket.customerTier === "Enterprise") return "High";

  if(text.includes("urgent") || text.includes("asap")){
    return "High";
  }
  return "Normal";
}


function assignTicket(category, priority) {
  
  if(category === "Technical" && priority === "High") return "Senior Support";
  if(category === "Billing" ) return "Billing Team";
  if(category === "Technical" && priority === "Normal") return "Support Queue";
  return "General Queue";
  
}


function processTicket(ticket) {

  const category = classifyCategory(ticket)
  const priority = determinePriority(ticket)
  const assignee = assignTicket(category, priority)

  return {
    id: ticket.id,
    category,
    priority,
    assignee
  }
}


// --- Run it over every ticket ----
function run() {

  const counts = { total: 0,
      byCategory: {},
      byPriority: {}
    };

  for(const ticket of tickets){
    const result = processTicket(ticket);
    console.log(`${result.id}: ${result.category} / ${result.priority} ---> ${result.assignee}`)
    counts.total ++;
    counts.byCategory[result.category] = (counts.byCategory[result.category] || 0) + 1;
    counts.byPriority[result.priority] = (counts.byPriority[result.priority] || 0) + 1;
  }
  console.log("\n---- Summary ----")
  console.log(`Total tickets: ${counts.total}`)
  console.log("By category:", counts.byCategory);
  console.log("By priority:", counts.byPriority);
}

run();
