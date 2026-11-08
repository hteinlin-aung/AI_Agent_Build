// Stage 5 — STEP 1: talking to Ollama through LangChain. Run with:  node step1-hello-model.js
// Given. (Ollama must be running, with qwen3:4b-instruct pulled.)
//
// In Stage 2–4  Ollama with fetch() and built the JSON by hand. LangChain's ChatOllama
// does that now. This script shows the THREE things used in graph.js:
//   1. messages are objects (SystemMessage, HumanMessage, AIMessage…)
//   2. model.invoke(messages) returns an AIMessage
//   3. model.bindTools(tools) — the model can now ASK for tools (it never runs them itself!)

import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeTools } from "./lc-tools.js";
import { unloadModel } from "./graph.js";

const model = new ChatOllama({ model: "qwen3:4b-instruct", temperature: 0, numCtx: 4096, numPredict: 200, think: false });

// --- 1. A plain question ------------------------------------------------------------------------
console.log("1. A plain question — no tools\n");
const reply = await model.invoke([
  new SystemMessage("You answer in one short sentence."),
  new HumanMessage("What is an AI agent?"),
]);
console.log("   reply.content  :", reply.content);
console.log("   reply.getType():", reply.getType());
console.log("   done_reason    :", reply.response_metadata.done_reason, " ← 'length' would mean it was cut off");


// --- 2. The same model, with your tools bound ------------------------------------------------------
console.log("\n2. With tools bound — watch it ASK for a tool instead of answering\n");
const withTools = model.bindTools(makeTools());
const toolReply = await withTools.invoke([new HumanMessage("How much free storage does my Mac have?")]);
console.log("   reply.content   :", JSON.stringify(toolReply.content), " ← empty: it isn't answering yet");
console.log("   reply.tool_calls:", toolReply.tool_calls);
console.log("\n   Nothing ran! The model only WROTE a request. In Stage 4 your loop ran it;");
console.log("   in graph.js, LangGraph's ToolNode will.");

await unloadModel();
