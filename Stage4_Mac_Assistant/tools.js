// Stage 4 — PART 1: the tools (the agent's "hands").
// Every tool is READ-ONLY: it looks, it never changes anything.
// model never runs these itself. It only ASKS; agent.js runs them.

import os from "os";
import fs from "fs";
import { execFileSync } from "child_process";

// --- Given helper --------
export function run(command, args = []) {
  return execFileSync(command, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
}

const HOME = os.homedir();
export const SEARCH_FOLDERS = ["Desktop", "Documents", "Downloads"].map((f) => `${HOME}/${f}`);


// A. PURE HELPERS — text in, value out. No system calls. `node test.js` checks them.
// ============================================================================
export function bytesToGB(bytes) {

  return Math.round(bytes/ 1024 ** 3 * 10) / 10

}


export function parseSwapUsage(text) {

  const result = text.match( /total = ([\d.]+)M\s+used = ([\d.]+)M/)

  if(!result) return null;

  const total = Number(result[1])
  const used = Number(result[2])

  const totalGB = Math.round((total/1024) * 10)/ 10
  const usedGB = Math.round((used/1024) * 10) / 10

  return {totalGB, usedGB}

}


export function parseFreePercent(text) {

  const result = text.match(/System-wide memory free percentage: (\d+)%/);

  if(!result) return null;

  const number = Number(result[1]);

  return number;

}


export function pressureLevel(freePercent) {

  if(freePercent === null) return "unknown"

  if(freePercent >= 30 ) return "normal"
  if(freePercent >= 15 ) return "elevated"
  return "critical"

}


export function parseTopProcesses(text, limit) {

  const processed = [];
  const strings = text.split("\n");
//After splittin u have an array to loop through

  for(const string of strings){
    const cleaned = string.trim();
    if(cleaned === "") continue

    const result = cleaned.match(/^(\d+)\s+(.+)$/)
    if(!result) continue

    const kilobytes = Number(result[1])

    const memoryMB = Math.round(kilobytes / 1024);

    const name = result[2].split("/").at(-1);

    const process = {name: name, memoryMB: memoryMB};

    processed.push(process);

  }

  processed.sort((a, b) => b.memoryMB - a.memoryMB);

  return processed.splice(0, limit)

}


// B. THE TOOLS — each returns a small plain object. `node check-tools.js` runs them 
//   Small results matter: everything a tool returns is sent back into the model's memory.
// ============================================================================

export function getSystemInfo() {

  const chip = os.cpus()[0].model;
  const cores = os.cpus().length;
  const memoryGB = bytesToGB(os.totalmem());
  const macOSVersion = run("sw_vers", ["-productVersion"]).trim()

  return {
    chip, cores, memoryGB, macOSVersion
  }

}


export function getDiskSpace() {

  const s = fs.statfsSync("/")
  const totalBytes = s.blocks * s.bsize;
  const freeBytes = s.bavail * s.bsize;

  // Disk space uses decimal GB (1000³) — the same unit macOS System Settings shows.
  const totalGB = Math.round((totalBytes / 1000 ** 3) * 10) / 10;
  const freeGB = Math.round((freeBytes / 1000 ** 3) * 10) / 10;

  const usedGB = Math.round((totalGB - freeGB) * 10)/ 10

  const usedPercent = Math.round((usedGB / totalGB) *100)

  return {
    totalGB, freeGB, usedGB, usedPercent
  }
}


export function getMemoryStatus() {

  const freePercent = parseFreePercent(run("memory_pressure"));
  const pressure = pressureLevel(freePercent);
  const swap = parseSwapUsage(run("sysctl", ["-n", "vm.swapusage"]))

  let swapUsedGB;
  let swapTotalGB;

  if(swap === null){
    swapUsedGB = 0;
    swapTotalGB = 0;
  }else{
    swapUsedGB = swap.usedGB;
    swapTotalGB = swap.totalGB
  }

  return{
    freePercent, pressure, swapUsedGB, swapTotalGB
  }
}


export function getTopApps({ limit } = {}) {

  let safeLimit = limit;

  if(!Number.isFinite(safeLimit)){
     safeLimit = 5
  }

  safeLimit = Math.floor(safeLimit);
  safeLimit = Math.min(safeLimit, 10);
  safeLimit = Math.max(safeLimit, 1);

  const text = run("ps", ["-axo", "rss=,comm="]);

  const apps = parseTopProcesses(text, safeLimit)

  return {apps}

}


export function findFiles({ name } = {}) {

  if(typeof name !== "string") return {error: "File name is not a string."}

  const cleanText = name.trim();

  if(cleanText.length === 0 || cleanText.length > 50){
    return {error: "Give a file name between 1 and 50 characters."}
  }

  const files = [];

  for (const folder of SEARCH_FOLDERS){
    const text = run("mdfind", ["-onlyin", folder, "-name", cleanText])
    const results = text.split("\n")

    for(const result of results){
      const cleaned = result.trim();
      if(cleaned !== ""){
        files.push(result);
      }
    }
  }
  const count = files.length;

  return {
    count,
    files: files.slice(0, 10),
    searchedIn : SEARCH_FOLDERS
  }
}


// --- Given: the toolbox — tool name -> function. agent.js looks tools up here. ---------
export const TOOLS = { getSystemInfo, getDiskSpace, getMemoryStatus, getTopApps, findFiles };
