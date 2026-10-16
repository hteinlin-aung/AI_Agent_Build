// Stage 4 — PART 2: the agent loop (the agent's "brain + control").
// The model DECIDES which tool it wants, code RUNS it and reports back. Repeat until done.

import { TOOLS } from "./tools.js";

// ---Settings (given) ---
export const OLLAMA_URL = "http://localhost:11434/api/chat";

// "qwen3:4b" is the THINKING-only version 
// The "instruct" version answers directly and supports tool calling.
export const MODEL = "qwen3:4b-instruct";
export const MAX_STEPS = 5;

export const SYSTEM_PROMPT = `You are a helpful assistant for the user's Mac.
Use the tools to get real information. Never guess numbers — if a question needs data, call a tool.
You can only read information; you cannot change anything on the Mac.
After you have the data, answer in 1–3 short, friendly sentences with the key numbers.
Note: "llama-server" or "ollama" in the app list is the AI model running this assistant (you, yourself).
Never give commands that delete or overwrite files (like rm or rm -rf). If the user wants to remove something, suggest Finder and moving it to the Trash, so it can be undone.
If you are not sure an app, menu or feature exists, say you are not sure. Never invent menu paths or app features.`;

// What the model is told about each tool. The model reads the DESCRIPTIONS to decide what to call,
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "getSystemInfo",
      description: "Get the Mac's chip, number of CPU cores, total memory (RAM) in GB and macOS version.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "getDiskSpace",
      description: "Get total, used and free storage space on the Mac's disk, in GB.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "getMemoryStatus",
      description: "Check memory pressure and swap usage. Use this when the user asks why the Mac is slow or laggy.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "getTopApps",
      description: "List the apps/processes using the most memory (RAM), biggest first.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", description: "How many apps to list, 1 to 10. Default 5." } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "findFiles",
      description: "Find files whose name contains a word, searching the user's Desktop, Documents and Downloads folders.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Part of the file name to search for, e.g. 'thesis'." } },
        required: ["name"],
      },
    },
  },
];

// --- the model leaves memory when you quit ---------
export async function unloadModel(model) {
  try {
    await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
    });
  } catch (err) {
    // Ollama is off.
  }
}


export async function runTool(name, args, toolbox = TOOLS) {

  if(typeof toolbox[name] !== "function"){
    return JSON.stringify({ error: `Unknown tool: ${name}` })
  }

  try{
    const result = await toolbox[name](args);
    return JSON.stringify(result)
  }catch(err){
    return JSON.stringify({error: err.message})
  }

}


export async function askAgent(messages) {

  const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: {
           "Content-Type" : "application/json"
        },
        body: JSON.stringify(
          {
            model: MODEL,
            messages,
            tools: TOOL_DEFINITIONS,
            stream: false,
            think: false,
            options: { temperature: 0, num_ctx: 4096, num_predict: 400 }
          }
        )
  })

  if(!response.ok) throw new Error(`Ollama returned ${response.status}`)

  const data = await response.json();
  
  if (data.done_reason === "length" && !data.message.tool_calls) {
    throw new Error("The model's reply was cut off (num_predict limit).");
  }
  return data.message

}


export function addToHistory(history, question, answer, maxMessages = 6){

  const updated = [
    ...history,
    { role: "user", content: question },
    { role: "assistant", content: answer }
  ]
  return updated.slice(-maxMessages);

}


export async function runAgent(question, { maxSteps = MAX_STEPS, toolbox = TOOLS, history = [] } = {}) {

  const messages = [                         
    {role: "system", content: SYSTEM_PROMPT},
    ...history,
    {role: "user", content: question}
  ]

  const toolsUsed = [];                    

  for(let step = 1; step <= maxSteps; step++){       
    
    const message = await askAgent(messages)          // The loop counts model requests, not individual tool calls

    messages.push(message);

    const calls = message.tool_calls || [];         

    const answer = message.content.split("</think>").pop().trim()       // hide any leaked thinking

    if(calls.length === 0){                           // If Ollama answers directly, there's no needed for tool_calls
      return {
        answer,
        toolsUsed,
        steps: step,
        stoppedEarly: false,
        history: addToHistory(history, question, answer)
      }
    }

    for(const call of calls){                         // Ollama might request two tools in a single response if there's a tool_call
      const name = call.function.name;
      const args = call.function.arguments || {};     // extracting tool names and arguemtns

      const result = await runTool(name, args, toolbox);        

      toolsUsed.push(name);                            

      messages.push({
        role: "tool",
        tool_name: name,
        content: result                                 
      });                                               
    }
  }
    const answer = `I stopped after ${maxSteps} steps without finishing.`
    
    return{                                             
      answer,
      toolsUsed, 
      steps: maxSteps, 
      stoppedEarly: true,
      history: addToHistory(history, question, answer)
    }

}
