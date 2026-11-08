// Stage 5 — draw YOUR agent as a diagram. Run with:  node draw-graph.js
// Given. Works without Ollama (it only builds the graph, it never asks the model).
// Paste the output into https://mermaid.live or into a ```mermaid block in Obsidian.
// Solid arrows = normal edges (always). Dotted arrows = conditional edges (one of them is chosen).

import { makeTools } from "./lc-tools.js";
import { buildGraph, createModel } from "./graph.js";

const tools = makeTools();
const graph = buildGraph({ model: createModel(tools), tools });
console.log((await graph.getGraphAsync()).drawMermaid());

//One useful detail: draw-graph.js doesn’t need Ollama to generate a response,
//but createModel(tools) still creates the model configuration. It doesn’t invoke the model.