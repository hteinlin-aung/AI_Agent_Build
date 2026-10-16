//  copied from Stage1_Rule_Based_Workflow/index.js and exported.


export function classifyCategory(ticket) {
  const text = (ticket.subject + " " + ticket.body).toLowerCase();

  if (
    text.includes("refund") ||
    text.includes("billing") ||
    text.includes("charge") ||
    text.includes("invoice")
  ) {
    return "Billing";
  }

  if (
    text.includes("error") ||
    text.includes("bug") ||
    text.includes("crash") ||
    text.includes("not working") ||
    text.includes("technical")
  ) {
    return "Technical";
  }

  return "General";
}

export function determinePriority(ticket) {
  const text = (ticket.subject + " " + ticket.body).toLowerCase();

  if (ticket.customerTier === "Enterprise") return "High";
  if (text.includes("urgent") || text.includes("asap")) return "High";
  return "Normal";
}

export function assignTicket(category, priority) {
  if (category === "Technical" && priority === "High") return "Senior Support";
  if (category === "Billing") return "Billing Team";
  if (category === "Technical" && priority === "Normal") return "Support Queue";
  return "General Queue";
}
