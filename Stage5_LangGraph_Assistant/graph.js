// Stage 5 — PARTS B + C: your Mac assistant, rebuilt as a LangGraph graph.
//
// In Stage 4 runAgent() was a for-loop. Here the SAME logic becomes a drawing:
//
//                 ┌──────────── no tool calls ───────────► END
//   START ──► [agent] ── read-only tools ──► [tools] ──┐
//                 ▲   └─ any ACTION ──► [approve] ─ y ─┘  │
//                 │                         └─ n ──┐      │
//                 └────────────────────────────────┴──────┘


import { StateGraph, MessagesAnnotation, START, END, interrupt, MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SystemMessage, ToolMessage, HumanMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { ACTION_TOOLS } from "./lc-tools.js";

// --- Settings (given) ----------------------------------------------------------------------
export const OLLAMA_BASE_URL = "http://localhost:11434";
export const MODEL = "qwen3:4b-instruct";

// Stage 4 had MAX_STEPS = 5 (five MODEL calls). LangGraph counts every NODE that runs instead
// (agent, tools, approve…), and calls its limit the "recursion limit". One round with an action is
// agent → approve → tools = 3 steps, so 5 rounds + a final answer ≈ 16. Over the limit, LangGraph
// throws a GraphRecursionError — loop's "safety-limit exit", built in.
export const RECURSION_LIMIT = 16;

// Stage 4b prompt, word for word.
export const SYSTEM_PROMPT = `You are a helpful assistant for the user's Mac.
Use the tools to get real information. Never guess numbers — if a question needs data, call a tool.
When a question needs data, call the tools in that same reply. Never answer with a plan like "Let me check" — just call the tool.
Only state numbers that came from a tool result in this conversation. If you have none, call a tool first.
You can read information, and you have two ACTIONS: quitApp and moveDuplicatesToTrash.
Only use an action when the user has asked for it. Never use one on your own.
When you use an action, just call the tool — the program itself asks the user for permission, so don't ask in chat.
If a result says the user declined, accept it, say nothing was changed, and don't try again.
"Don't try again" only applies within the same question. If the user asks for an action again in a new message, call the tool again — the program will ask them again.
moveDuplicatesToTrash works on any list of 1–20 file names, including just one. If you no longer have the findDuplicates results, call findDuplicates again first.
To clean duplicate files: call findDuplicates first, then moveDuplicatesToTrash with ONLY the names listed under "extras". Never include a "keep" file.
When you list duplicates, say how many you are showing out of totalExtras, and never call them "safe to remove" — only the user knows that.
After you have the data, answer in 1–3 short, friendly sentences with the key numbers.
Note: "llama-server" or "ollama" in the app list is the AI model running this assistant (you, yourself).
Never give commands that delete or overwrite files (like rm or rm -rf). If the user wants to remove something, suggest Finder and moving it to the Trash, so it can be undone.
If you are not sure an app, menu or feature exists, say you are not sure. Never invent menu paths or app features.`;

// the model, with tools "bound" to it. bindTools() sends the tool list with every
// request — exactly did by hand with  tools: TOOL_DEFINITIONS  in askAgent.
export function createModel(tools) {
  return new ChatOllama({
    model: MODEL,
    baseUrl: OLLAMA_BASE_URL,
    temperature: 0,
    numCtx: 4096,
    numPredict: 400,
    think: false,
  }).bindTools(tools);
}

// Stage 3 unloadModel — frees the model's memory when quit.
export async function unloadModel(model = MODEL) {
  try {
    await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
    });
  } catch (err) {
    // Ollama is off — nothing is loaded.
  }
}

// Stage 4b describeAction, unchanged.
export function describeAction(name, args = {}) {
  if (name === "quitApp") return `Quit the app "${args.name}"`;
  if (name === "moveDuplicatesToTrash") {
    const files = Array.isArray(args.files) ? args.files : [];
    return [`Move ${files.length} file(s) from Downloads to the Trash:`, ...files.map((f) => `  - ${f}`)].join("\n");
  }
  return `Run the tool "${name}"`;
}


// PART B — SMALL PURE HELPERS. No LangGraph magic here: plain arrays and objects.
// ============================================================================================

// 1. describeActions(toolCalls)
// IN:   the tool_calls array of one AI message, e.g.
//         [{ name: "getDiskSpace", args: {} }, { name: "quitApp", args: { name: "Spotify" } }]
// OUT:  ONE string: describeAction(name, args) for each call that is an ACTION (in ACTION_TOOLS),
//       joined with "\n". Read-only calls are left out.
//         -> 'Quit the app "Spotify"'
export function describeActions(toolCalls) {

  return toolCalls
    .filter(call => ACTION_TOOLS.includes(call.name))
    .map(call => describeAction(call.name, call.args))
    .join("\n");

}


// 2. routeAfterModel(state)            ★ this is a CONDITIONAL EDGE — it picks the next node ★
// IN:   the state: { messages: [...] }. The LAST message is the model's reply.
// OUT:  the NAME of the next node, as a string:
//         reply has no tool calls (tool_calls missing or empty)  -> END      (the model answered: done)
//         any tool call is an ACTION                             -> "approve"
//         otherwise (only read-only tools)                       -> "tools"
// This replaces the  if (calls.length === 0) return …  in your Stage 4 loop.
export function routeAfterModel(state) {
  
  const lastMessage = state.messages.at(-1);
  const toolCall = lastMessage.tool_calls ?? [];

  if(toolCall.length===0){
    if(needsVerify(state)) return "verify";     // (verify) data with no tool behind it -> check once
    if(isParroting(state)) return "parrot";     // (parrot) copied an old answer instead of acting -> once
    return END;
  }

  if(toolCall.some(call => ACTION_TOOLS.includes(call.name))){
    return "approve";
  }

  return "tools";
}


// 3. routeAfterApproval(state)          ★ another conditional edge ★
// After the approve node, the LAST message tells you what you decided:
//   last message is a ToolMessage (getType() === "tool") -> you said NO; the approve node added
//                                                           "declined" results -> go to "agent"
//   anything else (the AI message is still last)         -> you said YES -> go to "tools"
export function routeAfterApproval(state) {
  const message = state.messages.at(-1);

  if(message.getType() === "tool"){
    return "agent";
  }
  return "tools";
}


// 4. toolsUsedThisTurn(messages)
// IN:   all messages of the conversation
// OUT:  the names of every tool the model asked for AFTER the last human message, in order.
//         [Human "Q1", AI(calls a), Tool, AI "answer", Human "Q2", AI(calls b, c), Tool, Tool, AI "answer"]
//           -> ["b", "c"]
//       No human message at all -> look at all messages. Nothing found -> [].
export function toolsUsedThisTurn(messages) {
  const humanIndex = messages.findLastIndex(message => isQuestion(message));   // (verify) a real question, not the reminder  //findLastIndex() searches backwards

  return messages
    .slice(humanIndex + 1)    // want messages AFTER human message, not human message itself.
    .flatMap(message => (message.tool_calls ?? []).map(call => call.name));
        //gets the tool calls, or empty array if none exist. Then extract the tool's name
}


// 5. selectContext(messages, maxPastTurns = 3)      ★ context engineering ★
// THE PROBLEM: LangGraph's checkpointer (Part C) remembers EVERYTHING — every tool result of every
// question. Sending all of that to a 4096-token model would overflow it after a few questions.
// Stage 4's answer: past questions only keep the question + the final answer. Same here:
//
// A "turn" starts at a human message. For example:
//   turn 1: Human "How much storage?", AI(calls getDiskSpace), Tool {...}, AI "204 GB free."
//   turn 2: Human "And memory?",       AI(calls getMemoryStatus), Tool {...}
//                                      ← the current turn, still in progress
// OUT:  a NEW array:
//   - the CURRENT turn (the last one): EVERY message, untouched (the model needs its tool results)
//   - each PAST turn: only its human message, plus its final answer = its LAST message, but only if
//     that is an AI message with NO tool calls (a turn that crashed may have none — then skip it)
//   - only the last maxPastTurns past turns (older ones are dropped)
//   - messages before the first human message (if any) are dropped
// Must NOT change the input array.
// Hint: first split into turns — an array of arrays — by starting a new turn at every human message.
export function selectContext(messages, maxPastTurns = 3) {

  const turns = [];
  for(const message of messages){
    if(isQuestion(message)){                     // (verify) the reminder does NOT start a new turn
      turns.push([message]);
    }else if(turns.length > 0){
      turns[turns.length - 1].push(message)       //Messages before the first HumanMessage are ignored
    }
  }
  if(turns.length === 0) return [];

  const pastTurns = turns.slice(0, -1);          // gets every turn except last one
  const currentTurns = turns.at(-1);             // gets the last turn.

  // keep only the most recent past turns
  const recentPastTurns = maxPastTurns > 0
    ? pastTurns.slice(-maxPastTurns)       //If maxPastTurns = 3, keep only latest three past turns
    : [];
          //older turns are discarded to prevent model from receiving too much history.

  const pastContext = recentPastTurns.flatMap(turn => {
    const humanMessage = turn[0];         // gets the original human question.
    const lastMessage = turn.at(-1);      // gets the last message.

    // (declined) If an action was DECLINED in that question, forget the model's answer and keep
    // only the question. The old answer ("You declined…") is exactly what the model copied when
    // asked again — no example in memory = nothing to copy, so it has to decide afresh.
    if(wasDeclined(turn)) return [humanMessage];

    //  Was the last message AI response?   Did AI finish answering without requesting another tool?
    if(lastMessage.getType() === "ai" && (lastMessage.tool_calls ?? []).length === 0){
      return [humanMessage, lastMessage];
    }
    return [humanMessage];
  })

  return [...pastContext, ...currentTurns];
}


// THE VERIFY NODE (added after the first Stage 5 chat test)
// ============================================================================================
// Problem seen: "which app should i close?" -> the model listed Final Cut Pro 3.2 GB, Safari 2.1 GB…
// with NO tool call. All invented. The prompt already says "only numbers from tools" — it ignored it.
// Fix, the LangGraph way: a new node + a new arrow.
//   agent answers with DATA (GB / MB / % …) but no tool ran this turn
//     -> "verify" adds one reminder message -> back to "agent", which should now call the tool.

export const VERIFY_NAME = "verify";
export const VERIFY_MESSAGE =
  "You stated data (numbers like GB, MB or %) but no tool was called for this question. " +
  "Don't guess: call the right tool now, then answer using only its result.";

// isQuestion(message) -> true for a REAL user question.
export function isQuestion(message) {
  return message.getType() === "human" && message.name !== VERIFY_NAME && message.name !== PARROT_NAME;   // (parrot) both reminders
}

// hasData(text) -> true if the text contains a number with a unit: "3.2 GB", "14%", "500MB", "2.4 GHz"
export function hasData(text) {
  return typeof text === "string" && /\d+(?:\.\d+)?\s?(?:TB|GB|MB|KB|GHz|%)/i.test(text);
}

// needsVerify(state) -> should routeAfterModel send this answer to "verify"?
//   yes only if ALL are true:
//     - the answer contains data (hasData)
//     - no tool was used for this question (toolsUsedThisTurn is empty)
//     - we haven't already reminded it during this question (once only)
export function needsVerify(state) {
  const messages = state.messages;
  const answer = messages.at(-1);
  if (!hasData(answer.content)) return false;
  if (toolsUsedThisTurn(messages).length > 0) return false;
  const start = messages.findLastIndex((m) => isQuestion(m));
  const alreadyReminded = messages.slice(start + 1).some((m) => m.getType() === "human" && m.name === VERIFY_NAME);
  return !alreadyReminded;
}

// The node: add the reminder as a human message named "verify". The edge verify -> agent does the rest.
export function verifyNode() {
  return { messages: [new HumanMessage({ content: VERIFY_MESSAGE, name: VERIFY_NAME })] };
}


// THE PARROT CHECK (added after the Stage 5 re-test)
// ============================================================================================
// Problem seen: "Quit Spotify" -> n. Then "Quit Spotify" again -> the model answered in 0.8 s, NO tool,
// with its old answer word for word: "You declined to quit Spotify. Nothing was changed."
// It COPIED itself (it found the same question + answer in memory). A prompt rule couldn't stop it,
// because an example in the conversation beats a rule in the prompt.

export const PARROT_NAME = "parrot";
export const PARROT_MESSAGE =
  "The user is asking again. Don't repeat your earlier answer — things may have changed since then. " +
  "If this needs a tool or an action, call the tool now. For actions, the program will ask the user again.";

// sameText(a, b) -> true if two texts are the same, ignoring upper/lower case and extra spaces
export function sameText(a, b) {
  const clean = (t) => String(t).toLowerCase().replace(/\s+/g, " ").trim();
  return clean(a) !== "" && clean(a) === clean(b);
}

// pastTurns(messages) -> the EARLIER questions, as [{ answer, usedTools }]
//   (the current question — the last one — is left out)
export function pastTurns(messages) {
  const turns = [];
  for (const m of messages) {
    if (isQuestion(m)) turns.push([]);
    else if (turns.length > 0) turns.at(-1).push(m);
  }
  return turns.slice(0, -1).map((turn) => {
    const last = turn.at(-1);
    const isFinal = last && last.getType() === "ai" && (last.tool_calls ?? []).length === 0;
    const usedTools = turn.some((m) => m.getType() === "ai" && (m.tool_calls ?? []).length > 0);
    return { answer: isFinal ? last.content : null, usedTools };
  });
}

// isParroting(state) -> true if the 4 conditions above are all true
export function isParroting(state) {
  const messages = state.messages;
  const answer = messages.at(-1);
  if (toolsUsedThisTurn(messages).length > 0) return false;
  const start = messages.findLastIndex((m) => isQuestion(m));
  const alreadyReminded = messages.slice(start + 1).some((m) => m.getType() === "human" && m.name === PARROT_NAME);
  if (alreadyReminded) return false;
  return pastTurns(messages).some((turn) => turn.usedTools && turn.answer !== null && sameText(turn.answer, answer.content));
}

// wasDeclined(turn) -> true if any tool result in this turn says {"declined": true}
// (that's what approveNode writes when you answer anything but "y")
export function wasDeclined(turn) {
  return turn.some((m) => {
    if (m.getType() !== "tool") return false;
    try {
      return JSON.parse(m.content).declined === true;
    } catch {
      return false;      // not JSON -> not a decline
    }
  });
}

// remindersThisTurn(messages) -> which check nodes fired for the current question, e.g. ["parrot"]
// index.js prints it under the answer, so you can SEE the checks working instead of guessing.
export function remindersThisTurn(messages) {
  const start = messages.findLastIndex((m) => isQuestion(m));
  return messages
    .slice(start + 1)
    .filter((m) => m.getType() === "human" && (m.name === VERIFY_NAME || m.name === PARROT_NAME))
    .map((m) => m.name);
}

// The node: add the reminder, named "parrot". The edge parrot -> agent does the rest.
export function parrotNode() {
  return { messages: [new HumanMessage({ content: PARROT_MESSAGE, name: PARROT_NAME })] };
}


// PART C — THE NODES AND THE GRAPH. A node = a function that gets the state and returns an UPDATE.
// You never change the state yourself; you RETURN what to add, and LangGraph merges it in.
// For messages, "merge" means APPEND (that's the reducer MessagesAnnotation comes with).
// ============================================================================================

// 6. createAgentNode(model)  ->  returns the "agent" node function
// Why a function that RETURNS a function? So the graph can use the real ChatOllama, and the tests a
// fake one — the node "remembers" whichever model it was made with (a closure).

export function createAgentNode(model) {

  return async (state) => {
    //Send the conversation to the model
    const reply = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      ...selectContext(state.messages)              //  selects the useful conversation history.
    ])
    //Check whether the response was cut off
    if(
      reply.response_metadata?.done_reason === "length" &&          // model stopped because it reached output limit.
      (reply.tool_calls ?? []).length === 0                       // model wasn’t requesting a tool.
    ){
      throw new Error("The model's reply was cut off (numPredict limit).");
    }
    return { messages: [reply] };          //Return an update to LangGraph
  }
}


// 7. approveNode(state)                 ★ HUMAN-IN-THE-LOOP, the LangGraph way ★
// The LAST message is the model's reply, with at least one ACTION in its tool_calls.
export function approveNode(state) {
  
  //Step 1 — Get the model’s latest message
  const lastMessage = state.messages.at(-1);
  const toolCalls = lastMessage.tool_calls ?? [];

  //Step 2 — Ask the user for approval
  const answer = interrupt({
    description: describeActions(toolCalls)          //converts the tool calls into readable descriptions.
  })

  //Step 3 — Check whether the user approved
  if(answer === "y"){
    return {};                                      //Return an empty object, Nothing is added to the state.
  }

  //Step 4 — Handle rejection
  return{
    messages: toolCalls.map(call => new ToolMessage({      //bc every toolcall made by AI needs a corresponding response
      tool_call_id: call.id,
      name: call.name,
      content: JSON.stringify({
        declined: true,
        message: "The user said no. Nothing was changed."
      })
    }))
  }
}


// 8. buildGraph({ model, tools, checkpointer })  ★ THE WHOLE AGENT, AS A GRAPH ★
// IN:   model (with tools bound), the tools array, and a checkpointer (default: new MemorySaver())
// OUT:  the COMPILED graph (ready to .invoke())
// (The list at the end of addConditionalEdges = every place that edge may go. LangGraph uses it to
//  check your graph and to draw it.)
export function buildGraph({ model, tools, checkpointer = new MemorySaver() }) {
  
  return new StateGraph(MessagesAnnotation)
    .addNode("agent", createAgentNode(model))
    .addNode("approve", approveNode)
    .addNode("tools", new ToolNode(tools))
    .addNode("verify", verifyNode)                                   // (verify) the new node
    .addNode("parrot", parrotNode)                                   // (parrot) the new node

    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterModel, ["approve", "tools", "verify", "parrot", END])   // (verify) (parrot) more exits
    .addConditionalEdges("approve", routeAfterApproval, ["tools", "agent"])
    .addEdge("tools", "agent")
    .addEdge("verify", "agent")                                      // (verify) reminder -> ask again
    .addEdge("parrot", "agent")                                      // (parrot) reminder -> ask again
    .compile({checkpointer})

}
