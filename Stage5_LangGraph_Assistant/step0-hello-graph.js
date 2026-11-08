// Stage 5 — STEP 0: your first graph. NO AI, NO Ollama. Just to see how LangGraph works.
// Run with:  node step0-hello-graph.js
// Given — read it top to bottom, run it, then change things and run it again.
//
// The "agent" here is a tiny counter robot:
//   it adds 1, checks if it has reached the goal, and loops until it has.
// That's exactly the SHAPE of an agent: do something → decide → loop or stop.

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";

// 1. THE STATE — the shared "notebook" every node can read.
//    Each field has a REDUCER: the rule for MERGING a node's update into the notebook.
const CounterState = Annotation.Root({
  count: Annotation({ 
    reducer: (old, update) =>  old + update,                 // updates are ADDED
    default: () => 0 }),  
  goal: Annotation({
    reducer: (old, update) => update,                       // updates REPLACE
    default: () => 3 }),          
  log: Annotation({
    reducer: (old, update) => old.concat(update),           // updates are APPENDED
    default: () => [] }), 
});

// 2. THE NODES — plain functions: read the state, RETURN AN UPDATE (never change the state yourself).
function addOne(state) {
  return { count: 1, log: [`addOne: count was ${state.count}, adding 1`] };
}

function celebrate(state) {
  return { log: [`celebrate: reached ${state.count}! 🎉`] };
}

// function double(state) {
//   return {
//     count: state.count
//   };
// }

// 3. A CONDITIONAL EDGE — a function that looks at the state and returns the NAME of the next node.
function reachedGoal(state) {
  return state.count >= state.goal ? "celebrate" : "addOne";
}

// 4. BUILD THE GRAPH: add nodes, connect them with edges, compile.
const graph = new StateGraph(CounterState)
  .addNode("addOne", addOne)
  // .addNode("double", double)
  .addNode("celebrate", celebrate)
  .addEdge(START, "addOne")                                            // always start here, ENTRY POINT
  // .addEdge("addOne", "double")
  .addConditionalEdges("addOne", reachedGoal, ["addOne", "celebrate"]) // loop or move on
  // .addConditionalEdges("double", reachedGoal, ["addOne", "celebrate"])
  .addEdge("celebrate", END)                                           // then stop
  .compile();

// 5. RUN IT — and watch each step as it happens.
console.log("Running with goal 3, step by step:\n");
for await (const step of await graph.stream({ goal: 5 }, { streamMode: "updates" })) {
  console.log(step);   // { nodeName: <the update that node returned> }
}

const final = await graph.invoke({ goal: 5 });
console.log("\nThe final state:\n", final);

// 6. DRAW IT — LangGraph can draw your graph as a Mermaid diagram.
//    Paste the text into https://mermaid.live (or a ```mermaid block in Obsidian) to see it.
const drawing = await graph.getGraphAsync();
console.log("\nYour graph as a Mermaid diagram:\n");
console.log(drawing.drawMermaid());

// TRY THIS (one at a time, then re-run):
//   a) change { goal: 3 } to { goal: 5 } — more loops
//   b) change count's reducer to (old, update) => update  — what happens? why does it loop forever?
//      (LangGraph stops it after 25 steps with a GraphRecursionError — the safety limit.)
//   c) add a node "double" that returns { count: state.count } and put it between addOne and the check
