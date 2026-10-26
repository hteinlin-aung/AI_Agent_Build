// Stage 4b — the agent loop (the agent's "brain + control").
// The model DECIDES which tool it wants. code RUNS it and reports back. Repeat until done.

import { TOOLS } from "./tools.js";

// ------------------------ Settings (given) ---------------------------------------
export const OLLAMA_URL = "http://localhost:11434/api/chat";
// "qwen3:4b" is the THINKING-only version (same ID as qwen3:4b-thinking-2507) — think:false can't turn it off.
// The "instruct" version answers directly and supports tool calling. Same size (2.5 GB).
export const MODEL = "qwen3:4b-instruct";
export const MAX_STEPS = 5;

export const SYSTEM_PROMPT = `You are a helpful assistant for the user's Mac.
Use the tools to get real information. Never guess numbers — if a question needs data, call a tool.
When a question needs data, call the tools in that same reply. Never answer with a plan like "Let me check" — just call the tool.
Only state numbers that came from a tool result in this conversation. If you have none, call a tool first.
You can read information, and you have two ACTIONS: quitApp and moveDuplicatesToTrash.
Only use an action when the user has asked for it. Never use one on your own.
When you use an action, just call the tool — the program itself asks the user for permission, so don't ask in chat.
If a result says the user declined, accept it, say nothing was changed, and don't try again.
To clean duplicate files: call findDuplicates first, then moveDuplicatesToTrash with ONLY the names listed under "extras". Never include a "keep" file.
When you list duplicates, say how many you are showing out of totalExtras, and never call them "safe to remove" — only the user knows that.
After you have the data, answer in 1–3 short, friendly sentences with the key numbers.
Note: "llama-server" or "ollama" in the app list is the AI model running this assistant (you, yourself).
Never give commands that delete or overwrite files (like rm or rm -rf). If the user wants to remove something, suggest Finder and moving it to the Trash, so it can be undone.
If you are not sure an app, menu or feature exists, say you are not sure. Never invent menu paths or app features.`;

// What the model is told about each tool. The model reads the DESCRIPTIONS to decide what to call,
// so they are written for the model, like instructions. Names must match the keys in TOOLS.
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
  {
    type: "function",
    function: {
      name: "findDuplicates",
      description: "Find duplicate files (same content) in the user's Downloads folder. Read-only: it changes nothing. Returns groups, each with the file to keep and its extra copies.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "quitApp",
      description: "ACTION: quit (close) a running app by its name, like pressing Cmd+Q. The user is asked for permission first.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The app's name as shown in the Dock, e.g. 'Spotify'." } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "moveDuplicatesToTrash",
      description: "ACTION: move extra duplicate copies from Downloads to the Trash (they can be put back from the Trash). Use only file names listed under 'extras' by findDuplicates. The user is asked for permission first.",
      parameters: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" }, description: "File names from findDuplicates 'extras', e.g. ['report (1).pdf']." },
        },
        required: ["files"],
      },
    },
  },
];

// ---  Stage 3 unloadModel, so the model leaves memory when quit ---------
export async function unloadModel(model) {
  try {
    await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
    });
  } catch (err) {
    // Ollama is off, so nothing is loaded. Nothing to do.
  }
}



// STAGE 4b — THE PERMISSION GATE.
// ============================================================================

//  tools that takes action. Only these need y/n.
export const ACTION_TOOLS = ["quitApp", "moveDuplicatesToTrash"];

// Given: the DEFAULT "confirm" — it always says no. If nobody passes a real confirm function
// (a test, a script, a bug), actions are blocked. This is called "fail closed": when unsure, do nothing.
export const denyAll = async () => false;


// 4. describeAction(name, args)
// IN:   an action tool's name and the arguments the model sent
// OUT:  ONE string, shown to u before u answer y/n — exactly:
export function describeAction(name, args = {}) {

  if(name === "quitApp"){
    return `Quit the app "${args.name}"`
  }

  if(name === "moveDuplicatesToTrash"){         // If args.files is array, assign that array to files Otherwise, assign an empty array [] to files.
    const files = Array.isArray(args.files) ? args.files : []
    return `Move ${files.length} file(s) from Downloads to the Trash:\n${files.map(file => `  - ${file}`).join("\n")}`  
    // ["a (1).pdf", "b copy.jpg"]; -->   - a (1).pdf
    //                                    - b copy.jpg
  }

  return `Run the tool "${name}"`
}


// 1. runTool(name, args, toolbox = TOOLS)          <- async
// >>> STAGE 4b CHANGE: add a 4th parameter  confirm = denyAll
//   runTool(name, args, toolbox = TOOLS, confirm = denyAll)
//   After the unknown-tool check, INSIDE the try (so a broken confirm can't crash anything):
//     if ACTION_TOOLS includes name:
//        allowed = await confirm(describeAction(name, args))
//        if allowed is not EXACTLY true  (=== true — "yes", 1 or undefined are NOT permission)
//          -> return JSON.stringify({ declined: true, message: "The user said no. Nothing was changed." })
//             and DON'T run the tool.

//                                                       function: callback function
export async function runTool(name, args, toolbox = TOOLS, confirm = denyAll) {   //fail-closed security: when authorization is missing, 
//                                                                                the system denies the action rather than allowing it.
  if(typeof toolbox[name] !== "function"){
    return JSON.stringify({ error: `Unknown tool: ${name}` })
  }

  try{
    if(ACTION_TOOLS.includes(name)){
      const allowed = await confirm(describeAction(name, args))

      if(allowed !== true){
        return JSON.stringify({
          declined: true, 
          message: "The user said no. Nothing was changed."
        })
      }
    }
    const result = await toolbox[name](args);
    return JSON.stringify(result)
  }catch(err){
    return JSON.stringify({error: err.message})
  }
}


// 2. askAgent(messages)                             <- async
// IN:   the whole conversation so far (an array of messages)
// OUT:  data.message  — the model's reply OBJECT (not just the text). It may contain:
//         content     — text (the final answer, or "" while it is calling tools)
//         tool_calls  — [{ function: { name: "getDiskSpace", arguments: {} } }, ...]  (sometimes)
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


// ----------------- THE NUDGE (added after the 4b chat test) ---------------------------------------------
// asked "Why is my Mac slow?", the model replied "Let me check now!" with NO tool
// call. The loop saw "no tool calls" = finished, and returned the plan as the answer. Then it
// invented numbers on the next question.
export const NUDGE = "You haven't called any tools yet. Don't describe what you will do — call the tools now.";

// looksLikePlan(text) -> true if the text promises to check something instead of answering
// e.g. "Let me check now!" -> true      "You have 204 GB free." -> false
export function looksLikePlan(text) {
  return /\b(let me|i'll|i will|i'm going to|i am going to)\s+(check|look|find|see|run|search|get|scan)\b|\bchecking now\b/i.test(text);
}


// 3. runAgent(question, { maxSteps, toolbox } = {})  <- async       THE AGENT LOOP 
// IN:   the user's question (string), and options:
//         maxSteps — default MAX_STEPS (5)
//         toolbox  — default TOOLS
//       (Write the parameter as:  { maxSteps = MAX_STEPS, toolbox = TOOLS } = {}  )
// OUT:  { answer, toolsUsed, steps, stoppedEarly }

// >>> STAGE 4b CHANGE: one more option,  confirm = denyAll
//   { maxSteps = MAX_STEPS, toolbox = TOOLS, history = [], confirm = denyAll } = {}
//   and pass it on:  runTool(name, args, toolbox, confirm)
//   (index.js passes a real confirm that asks u y/n in the Terminal.)

export async function runAgent(question, { maxSteps = MAX_STEPS, toolbox = TOOLS, history = [], confirm = denyAll } = {}) {

  const messages = [                          // stores the conversation history,Everytime model responds or tool executes, add to this array.
    {role: "system", content: SYSTEM_PROMPT},
    ...history,
    {role: "user", content: question}
  ]

  const toolsUsed = [];                       //  an empty array that record which tools the agent executes.
  let nudged = false;                         //  the nudge may only happen once per question

  for(let step = 1; step <= maxSteps; step++){        //repeat the process until model produces a final answer or maximum number of steps is reached.
    
    const message = await askAgent(messages)          // important detail: The loop counts model requests, not individual tool calls

    messages.push(message);

    const calls = message.tool_calls || [];           // message might return a normal response, or return a response requesting a tool

    const answer = message.content.split("</think>").pop().trim()   // hide any leaked thinking

    if(calls.length === 0){                           // If Ollama answers directly, there's no needed for tool_calls

      // THE NUDGE: a plan with no tools used yet is not an answer. Remind once, go round again.
      if(!nudged && toolsUsed.length === 0 && step < maxSteps && looksLikePlan(answer)){
        nudged = true;
        messages.push({ role: "user", content: NUDGE });
        continue;
      }

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

      const result = await runTool(name, args, toolbox, confirm);        // it connects the agent’s decision to the actual tool execution.

      toolsUsed.push(name);                              // record which tool was used.

      messages.push({
        role: "tool",
        tool_name: name,
        content: result                                 //When yr code execute a tool,Ollama doesn’t know what happened.u must add the result to 
      });                                                // messages so that the next call to askAgent(messages)can send result back to model.
    }
  }
    const answer = `I stopped after ${maxSteps} steps without finishing.`
    
    return{                                               //If all five steps finish without a final answer, execution reaches the safety-limit return.
      answer,
      toolsUsed, 
      steps: maxSteps, 
      stoppedEarly: true,
      history: addToHistory(history, question, answer)
    }

}
