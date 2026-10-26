# Local AI Agent — from simple rules to a Mac assistant

A learning project **step by step**, starting with plain rules and ending with an **agent** that can look up the Mac and answer questions about it.

Everything runs **locally and for free**. It uses [Ollama](https://ollama.com) to run small open-source models, with **no cloud, no API keys and no cost**.

> ⚠️ **This is just a prototype.** built it to learn how AI agents work under the hood, by hand, without frameworks. It's small, read-only and actionable  tested on Mac. Treat it as a demo and a learning reference.

---

## The 4 stages at a glance

| Stage | Folder | What it does | AI? | Key idea |
|---|---|---|---|---|
| 1 | `Stage1_Rule_Based_Workflow` | Sorts support tickets using keyword rules | ❌ No | The "before AI" baseline |
| 2 | `Stage2_Ollama_Classifier` | Same tickets, but a local model picks the category | ✅ llama3.2:3b | Calling a model from code |
| 3 | `Stage3_Model_Comparison` | Rules vs two models, scored on labelled tickets | ✅ llama + qwen | Measuring instead of guessing |
| 4 | `Stage4_Mac_Assistant` | A chat agent that **decides which tool to use** to answer questions about your Mac | ✅ qwen3:4b-instruct | The agent loop + tools + safety |
| 5 | `Stage4b_Permissioned_Actions` | An agent that do actions for you when you requested one | ✅ qwen3:4b-instruct | AgentLoop + tools & actionTools + permission gates + safety |

Each stage builds on the one before it.

---

## What each stage does

### Stage 1 — Rule-based ticket triage (no AI)
Uses keyword rules to classify 12 tickets into **Billing / Technical / General**, with **Normal / High** priority, Shows the limitations of fixed rules when tickets use unexpected wording.

### Stage 2 — The first real AI call
Uses (`llama3.2:3b`) to classify tickets. Validates the model’s answers, falls back to rules if needed, and uses 24 automated tests with a fake model.

### Stage 3 — Model comparison
Runs **rules vs `llama3.2:3b` vs `qwen3:4b`** on 20 tickets that have the correct answer attached, then prints a scoreboard with **accuracy and speed**.
Qwen achieves the highest accuracy at 95%. **Memory matters on 8 GB Mac.** Models must unloaded after use because two models loaded at once can froze the system.

### Stage 4 — The Mac Assistant (the actual agent)
A terminal-based assistant that understands natural language, selects the appropriate tool, executes it, and uses the real results to answer questions.

### Stage 4b — Actionable Assistant
Extends Stage 4 by allowing the agent to quit applications and move duplicate files from Downloads to the Trash, with a permission gate that requires user approval before any action is performed. Adds file validation, protected apps, and a code-level check to prevent the model from making up system information when it fails to call tools. All 66 action tests passed.

<!-- **5 read-only tools**

| Tool | Answers questions like | Reads from |
|---|---|---|
| `getSystemInfo` | "What chip and RAM do I have?" | Node `os` + `sw_vers` |
| `getDiskSpace` | "How much storage is free?" | `fs.statfsSync` |
| `getMemoryStatus` | "Why is my Mac slow?" | `memory_pressure` + `sysctl vm.swapusage` |
| `getTopApps` | "What's using the most memory?" | `ps` |
| `findFiles` | "Find my resume files" | Spotlight (`mdfind`), **only** in Desktop / Documents / Downloads | -->

---

## Try it yourself

### What you need
- **A Mac** (Apple Silicon recommended). Stage 4 needs macOS. Stages 1–3 should work anywhere.
- **8 GB of RAM or more**
- **Node.js 18.15 or newer** (20+ recommended) Check with `node -v`.
- **Ollama** from [ollama.com](https://ollama.com) (for Stages 2–4).
- **About 7 GB of free disk space** for the models.

There is **no `npm install`**. The project has zero dependencies and uses only Node's built-in features.

### 1. Get the code
```bash
git clone https://github.com/hteinlin-aung/AI_Agent_Build
cd AI_Agent_Build
```

### 2. Download the models (only the ones needed)
```bash
ollama pull llama3.2:3b         # ~2.0 GB — Stages 2 and 3
ollama pull qwen3:4b            # ~2.5 GB — Stage 3
ollama pull qwen3:4b-instruct   # ~2.5 GB — Stage 4
ollama list                     # check they're there
```
Make sure the Ollama app is running before Stages 2–4.

### 3. Run a stage
Always run commands **from inside that stage's folder**.

```bash
# Stage 1 — no AI, no Ollama needed
cd Stage1_Rule_Based_Workflow && node index.js

# Stage 2
cd Stage2_Ollama_Classifier
node test.js        # 24 tests, uses a fake model (Ollama can be off)
node index.js       # real run with llama3.2:3b

# Stage 3
cd Stage3_Model_Comparison
node test.js        # 27 tests
node index.js       # the scoreboard (takes a minute or two)

# Stage 4 — the agent
cd Stage4_Mac_Assistant
node test.js            # 42 tests (fake model + fake tools)
node test-memory.js     # 12 tests for conversation memory
node check-tools.js     # runs each tool on your Mac, no AI involved
node index.js           # chat! type "reset" to clear memory, "exit" to quit

# Stage 4b — Actionable agent
cd Stage4b_Permissioned_Actions
node test-actions.js   # 66 checks: temp folder + fake trash + fake quit.
node test.js           # 42 — Stage 4 still works
node test-memory.js    # 12 to test fake memory.
node check-actions.js  # the real macOS parts, no model
node index.js          # chat! the agent that can do some actions
```

**Questions to try in Stage 4b:** *"Why is my Mac slow?"* · *"What's using the most memory?"* · *"How much storage do I have?"* · *"Find duplicate files in my Downloads"* · *"Move the duplicates to the Trash"* · *"Quit Spodify"* (y/n) · *"Quit finder"* (should block) · *"Delete my Downloads folder"* (should refuse)

---

## ⚠️ Cautions — read before running

- **Not for low-memory machines.** Each model uses about 2.5–3 GB while loaded. **Under 8 GB it may freeze or become very slow**, and on 8 GB should **close heavy apps** (browsers, code editors…) first.
- **macOS only for Stage 4.** The tools use Mac-only commands. On Windows or Linux, Stage 4's tools will fail.
- **Big downloads.** Each model is about 2–2.5 GB, roughly **7 GB** for all three. Delete them later with `ollama rm <model>`.
- **Read-only, local and private.** Stage 4 can't change, move or delete anything. `findFiles` only searches file *names* in Desktop, Documents and Downloads.
- **Free up memory when you're done.** `exit` in Stage 4 unloads the model.

---

## Built with
JavaScript (Node.js, ES modules) · Ollama · llama3.2:3b · qwen3:4b · qwen3:4b-instruct

## What's next
- **Stage 5:** rebuild the agent with **LangGraph**.
- **Stage 6:** multiple agents working together.
