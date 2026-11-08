// Stage 5 — PART A: 8 tools, wrapped so LangGraph can use them.
//
// Stage 4b functions in tools.js are UNCHANGED. Here put a "LangChain tool" jacket on
// each one. A jacket = the function + its name + a description + a SCHEMA (what arguments it takes).
// In Stage 4 TOOL_DEFINITIONS r written by hand. Now the `tool()` helper builds it
// from a zod schema, AND checks the model's arguments against that schema before
// function runs.

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { TOOLS } from "./tools.js";

// Given: tools that CHANGE things. The graph sends these to the "approve" node.
// important to seperate read-only and action tool. Because action tools require user permission before executing.
export const ACTION_TOOLS = ["quitApp", "moveDuplicatesToTrash"];

// Given: run one of plain tools and ALWAYS give back a JSON string
// A tool that throws becomes {"error": "..."} the model can read, instead of a crash.
export async function asText(fn, args) {
  try {
    return JSON.stringify(await fn(args));
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}


// makeTools(toolbox = TOOLS) -> an array of 8 LangChain tools
// The toolbox parameter lets the tests pass FAKE functions (same trick as Stage 4).
//
// ZOD in 30 seconds — a way to describe what data must look like:
//   z.object({})                                         no arguments
//   z.object({ name: z.string() })                       one REQUIRED text argument
//   z.number().int().optional()                          a whole number that may be missing
//   z.array(z.string())                                  a list of texts
//   .describe("...")                                     a hint the MODEL reads (like Stage 4's "description")
export function makeTools(toolbox = TOOLS) {
  return [
    tool((args) => asText(toolbox.getSystemInfo, args), {
      name: "getSystemInfo",
      description: "Get the Mac's chip, number of CPU cores, total memory (RAM) in GB and macOS version.",
      schema: z.object({}),
    }),
    tool((args) => asText(toolbox.getDiskSpace, args), {
      name: "getDiskSpace",
      description: "Get total, used and free storage space on the Mac's disk, in GB.",
      schema: z.object({}),
    }),
    tool((args) => asText(toolbox.getMemoryStatus, args), {
      name: "getMemoryStatus",
      description: "Check memory pressure and swap usage. Use this when the user asks why the Mac is slow or laggy.",
      schema: z.object({}),
    }),
    tool((args) => asText(toolbox.findDuplicates, args), {
      name: "findDuplicates",
      description: "Find duplicate files (same content) in the user's Downloads folder. Read-only: it changes nothing. Returns groups, each with the file to keep and its extra copies.",
      schema: z.object({}),
    }),
    tool((args) => asText(toolbox.getTopApps, args), {
      name: "getTopApps",
      description: "List the apps/processes using the most memory (RAM), biggest first.",
      schema: z.object({
        limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe( "How many apps to list, 1 to 10. Default 5."),
      }),
    }),
    tool((args) => asText(toolbox.findFiles, args), {
      name: "findFiles",
      description: "Find files whose name contains a word, searching the user's Desktop, Documents and Downloads folders.",
      schema: z.object({
        name: z
        .string()
        .min(1)
        .describe("Part of the file name to search for, e.g. 'thesis'."),
      }),
    }),
    tool((args) => asText(toolbox.quitApp, args), {
      name: "quitApp",
      description: "ACTION: quit (close) a running app by its name, like pressing Cmd+Q. The user is asked for permission first.",
      schema: z.object({
        name: z
        .string()
        .min(1)
        .describe("The app's name as shown in the Dock, e.g. 'Spotify'."),
      }),
    }),
    tool((args) => asText(toolbox.moveDuplicatesToTrash, args), {
      name: "moveDuplicatesToTrash",
      description: "ACTION: move extra duplicate copies from Downloads to the Trash (they can be put back from the Trash). Use only file names listed under 'extras' by findDuplicates. It can move just one file or several. The user is asked for permission first.",
      schema: z.object({
        files: z
        .array(z.string().min(1))
        .min(1)
        .describe("File names from findDuplicates 'extras', e.g. ['report (1).pdf']."),
      }),
    })
  ];
}

