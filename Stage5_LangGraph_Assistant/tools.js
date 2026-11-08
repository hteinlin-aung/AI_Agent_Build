// Stage 4b — the tools (the agent's "hands").
// The model never runs these itself. It only ASKS; agent.js runs them.

import os from "os";
import fs from "fs";
import { execFileSync } from "child_process";
import path from "path";
import crypto from "crypto";

// --- Given helper -------------------------
// run("sw_vers", ["-productVersion"])  ->  "15.7.4\n"
// Runs ONE program with a list of arguments and returns what it printed.
export function run(command, args = []) {
  return execFileSync(command, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
}

const HOME = os.homedir();
export const SEARCH_FOLDERS = ["Desktop", "Documents", "Downloads"].map((f) => `${HOME}/${f}`);


// A. PURE HELPERS — text in, value out. No system calls. `node test.js` checks them.
// ============================================================================

// 1. bytesToGB(bytes)
// IN:   a number of bytes
// OUT:  gigabytes as a number with ONE decimal: Math.round(bytes / 1024 ** 3 * 10) / 10
export function bytesToGB(bytes) {

  return Math.round(bytes/ 1024 ** 3 * 10) / 10

}


// 2. parseSwapUsage(text)
// IN:   the text macOS prints for  `sysctl -n vm.swapusage`, e.g.
//         "total = 4096.00M  used = 3141.25M  free = 954.75M  (encrypted)"
// OUT:  { totalGB, usedGB }  — numbers in GB with ONE decimal (MB / 1024)
//         -> { totalGB: 4, usedGB: 3.1 }
// NO MATCH (any other text) -> null
export function parseSwapUsage(text) {

  const result = text.match( /total = ([\d.]+)M\s+used = ([\d.]+)M/)

  if(!result) return null;

  const total = Number(result[1])
  const used = Number(result[2])

  const totalGB = Math.round((total/1024) * 10)/ 10
  const usedGB = Math.round((used/1024) * 10) / 10

  return {totalGB, usedGB}

}


// 3. parseFreePercent(text)
// IN:   the text printed by the macOS  `memory_pressure`  command. Somewhere in it is a line like
//         "System-wide memory free percentage: 23%"
// OUT:  that number, as a Number  ->  23
// NO MATCH -> null
export function parseFreePercent(text) {

  const result = text.match(/System-wide memory free percentage: (\d+)%/);

  if(!result) return null;

  const number = Number(result[1]);

  return number;

}


// 4. pressureLevel(freePercent)
// IN:   a number 0–100 (or null)
// OUT:  "normal"   if freePercent >= 30
//       "elevated" if freePercent >= 15
//       "critical" otherwise
//       "unknown"  if freePercent is null
export function pressureLevel(freePercent) {

  if(freePercent === null) return "unknown"

  if(freePercent >= 30 ) return "normal"
  if(freePercent >= 15 ) return "elevated"
  return "critical"

}


// 5. parseTopProcesses(text, limit)
// IN:   the text printed by  `ps -axo rss=,comm=`  — one process per line:
//         "  512000 /Applications/Spotify.app/Contents/MacOS/Spotify"
//         "    2048 /usr/libexec/logd"
//       first the memory in KILOBYTES, then the program's full path (paths can contain spaces!)
//       and a number `limit`
// OUT:  an array of the `limit` biggest processes, biggest first:
//         [{ name: "Spotify", memoryMB: 500 }, ...]
//       name     = the part of the path after the LAST "/"
//       memoryMB = Math.round(kilobytes / 1024)
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


// B. THE TOOLS — each returns a SMALL plain object. `node check-tools.js` runs them for real.
//    Small results matter: everything a tool returns is sent back into the model's memory.
// ============================================================================

// 6. getSystemInfo()
// OUT:  { chip, cores, memoryGB, macOSVersion }
//   chip         -> os.cpus()[0].model                      e.g. "Apple M3"
//   cores        -> os.cpus().length                        e.g. 8
//   memoryGB     -> bytesToGB(os.totalmem())                e.g. 8
//   macOSVersion -> run("sw_vers", ["-productVersion"]).trim()   e.g. "15.7.4"
export function getSystemInfo() {

  const chip = os.cpus()[0].model;
  const cores = os.cpus().length;
  const memoryGB = bytesToGB(os.totalmem());
  const macOSVersion = run("sw_vers", ["-productVersion"]).trim()

  return {
    chip, cores, memoryGB, macOSVersion
  }

}


// 7. getDiskSpace()
// OUT:  { totalGB, freeGB, usedGB, usedPercent }
//   const s = fs.statfsSync("/")
//   total bytes = s.blocks * s.bsize        free bytes = s.bavail * s.bsize
//   usedGB      = totalGB - freeGB, rounded to one decimal (Math.round(x * 10) / 10)
//   usedPercent = Math.round(used / total * 100)   (whole number)
export function getDiskSpace() {

  const s = fs.statfsSync("/")
  const totalBytes = s.blocks * s.bsize;
  const freeBytes = s.bavail * s.bsize;

  const totalGB = Math.round((totalBytes / 1000 ** 3) * 10) / 10;
  const freeGB = Math.round((freeBytes / 1000 ** 3) * 10) / 10;

  const usedGB = Math.round((totalGB - freeGB) * 10)/ 10

  const usedPercent = Math.round((usedGB / totalGB) *100)

  return {
    totalGB, freeGB, usedGB, usedPercent
  }

}


// 8. getMemoryStatus()
// OUT:  { freePercent, pressure, swapUsedGB, swapTotalGB }
//   freePercent  -> parseFreePercent(run("memory_pressure"))
//   pressure     -> pressureLevel(freePercent)
//   swap         -> parseSwapUsage(run("sysctl", ["-n", "vm.swapusage"]))
//                   if that is null, use 0 for both swap numbers
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


// 9. getTopApps({ limit })
// IN:   an object from the model, e.g. { limit: 5 }. limit may be MISSING or silly (0, 99, "five").
// OUT:  { apps: [...] }  — parseTopProcesses(run("ps", ["-axo", "rss=,comm="]), safeLimit)
// SAFE LIMIT: a whole number between 1 and 10. Missing / not a number -> 5. Too big -> 10. Too small -> 1.
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


// 10. findFiles({ name })
// IN:   { name: "thesis" }  — what the user is looking for
// OUT:  { count, files, searchedIn }
//   - search ONLY inside SEARCH_FOLDERS (Desktop, Documents, Downloads) — never the whole Mac
//   - for each folder: run("mdfind", ["-onlyin", folder, "-name", name])
//     (mdfind = Spotlight search; it prints one path per line)
//   - collect all non-empty lines from all folders
//   - count = how many were found in total;  files = only the FIRST 10 (keep the result small)
//   - searchedIn = SEARCH_FOLDERS
// BAD INPUT: if name is not a string, is empty after trim, or is longer than 50 characters
//   -> return { error: "Give a file name between 1 and 50 characters." }   (don't search)
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


// C. STAGE 4b — PURE HELPERS for the actions. No system calls. `node test-actions.js` checks them.
// ============================================================================

export const DOWNLOADS = `${HOME}/Downloads`;
// Apps the assistant may NEVER quit: the Mac's own core apps, and the things the assistant
// itself runs on (if it quits Terminal or Ollama, it kills itself mid-sentence).
export const PROTECTED_APPS = ["Finder", "Dock", "SystemUIServer", "loginwindow", "Ollama", "llama-server", "Terminal", "iTerm2", "Cursor"];
export const MAX_TRASH_FILES = 20;

// Given: bytes -> MB with one decimal. DECIMAL MB (1000²), the same unit Finder shows (your GB lesson).
export function bytesToMB(bytes) {
  return Math.round((bytes / 1000 ** 2) * 10) / 10;
}


// 11. checkAppName(name)
// IN:   whatever the model sent as an app name
// OUT:  null if the name is OK — otherwise a STRING saying what's wrong (the FIRST problem found):
//   - not a string, or empty after trim  -> "App name is missing."
//   - longer than 50 characters (trimmed) -> "App name is too long (max 50 characters)."
//   - any character that isn't a letter, digit, space, dot, & or -
//                                          -> "App name has characters that are not allowed."
//     regex:  /^[A-Za-z0-9 .&-]+$/   (test the TRIMMED name)
//   - in PROTECTED_APPS, ignoring upper/lower case
//                                          -> `"${trimmedName}" is protected — the assistant can't quit it.`
export function checkAppName(name) {

  if(typeof name !== 'string' ) return `App name is missing.`

  const trimmedName = name.trim();

  if(trimmedName.length === 0) return `App name is missing.`
  if(trimmedName.length > 50 ) return `App name is too long (max 50 characters).`

  const regex = /^[A-Za-z0-9 .&-]+$/;

  if(!regex.test(trimmedName)) return `App name has characters that are not allowed.`

  if(PROTECTED_APPS.some((app) => app.toLowerCase() === trimmedName.toLowerCase())) 
    return `"${trimmedName}" is protected — the assistant can't quit it.`

  return null;

}


// 12. findGroups(items, key)
// IN:   an array of objects, and the NAME of a property to group by, e.g. "size" or "hash"
// OUT:  an array of groups (arrays) of items that share the same value for that property —
//       ONLY groups with 2 or more items. Groups appear in the order their first item appeared.
// e.g.  findGroups([{ n: "a", size: 5 }, { n: "b", size: 9 }, { n: "c", size: 5 }], "size")
//         -> [[{ n: "a", size: 5 }, { n: "c", size: 5 }]]
export function findGroups(items, key) {
  
  const groups = new Map();

  for(const item of items){
    const value = item[key]         // item -> {n: "a", size: 5} -> by(key,value) -> key=size -> item[key] = item['size'] = 5

    if(groups.has(value)){
      groups.get(value).push(item)
 
    }else{
      groups.set(value, [item])        // conceptually -> Map {5  => [objectA, objectC], 20 => [objectE]}       
    }

  }
  return [...groups.values()].filter((gp) => gp.length >= 2);     //returns groups containing at least 2 items of same size

}


// 13. chooseKeeper(paths)
// IN:   an array of file paths that are identical copies, e.g.
//         ["/Users/me/Downloads/report (1).pdf", "/Users/me/Downloads/report.pdf"]
// OUT:  the ONE path to keep: the one whose FILE NAME (path.basename) is shortest.
//       Same length -> the one that comes first alphabetically (a < b).
//         -> "/Users/me/Downloads/report.pdf"
//       (Copies are usually called "x (1).pdf", "x copy.pdf", "x 2.pdf" — longer names.)
export function chooseKeeper(paths) {

  const sortedPath = [...paths].sort((a, b) => {
    const nameA = path.basename(a);                       // basename() is the last part of a file path 
    const nameB = path.basename(b);

    if(nameA.length !== nameB.length){
      return nameA.length - nameB.length;
    }

    return  nameA < nameB ? -1 : nameA > nameB ? 1: 0
  })
  return sortedPath[0];
}


// 14. isInside(folder, filePath)
// IN:   a folder path and a file path
// OUT:  true only if filePath is really INSIDE folder (at any depth), false otherwise.
export function isInside(folder, filePath) {
  
  const resolveFolder = path.resolve(folder);           //  /Users/me/Downloads
  const resolveFile = path.resolve(filePath);           // /Users/me/Downloads/../Documents/cv.pdf -> resolve -> /Users/me/Documents/cv.pdf

  return resolveFile.startsWith(resolveFolder + path.sep);  // /Users/me/Downloads + '/' -> /Users/me/Downloads/

}


// 15. planDuplicates(groups)
// IN:   groups of IDENTICAL files: [[{ path, size }, { path, size }], [...], ...]
// OUT:  {
//         groups: [{ keep, extras, sizeMB }, ...]   — one per input group, BIGGEST sizeMB first
//             keep   = chooseKeeper(all the paths in the group)
//             extras = the other paths, in their original order
//             sizeMB = bytesToMB(size of ONE file in the group)
//         extras:        every extra path from every group, in the same order as `groups`
//         reclaimableMB: bytesToMB(total bytes of ALL the extras)  — what moving them would free
//       }
export function planDuplicates(groups) {

  const grouped = groups.map((group) => {

    const paths = group.map((file) => file.path);       //  extract the paths
    const keep = chooseKeeper(paths);                   //  choose the file to keep:

    const extras = paths.filter(path => path !== keep);   // need extras path -> every path except the ones decided to keep


// eg: group = {path:".../report 1).pdf", size: 2000000},{path:".../report.pdf", size: 2000000}

    const sizeMB = bytesToMB(group[0].size);      // size of the first file because everyfile in a group has identical content->they have same size.

    const extraBytes = group[0].size * extras.length  //if A group has multiple extras, must account for that. 

    return {keep, extras, sizeMB, extraBytes};

  })

  grouped.sort((a, b) => b.sizeMB - a.sizeMB);

  const extras = grouped.flatMap(group => group.extras)   // flatMap produces one combined array instead of nested arrays

  const totalBytes = grouped.reduce((sum, gp) => sum + gp.extraBytes, 0);

  const reclaimableMB = bytesToMB(totalBytes);

  const finalGroups = grouped.map(({keep, extras, sizeMB}) => ({      // extract only three properties needed from each object
    keep,
    extras,
    sizeMB
  }))

  return {
    groups: finalGroups,
    extras,
    reclaimableMB
  }

}


// D. STAGE 4b — THE NEW TOOLS. findDuplicates only LOOKS. quitApp and moveDuplicatesToTrash
//    CHANGE things — agent.js asks you y/n before they run (you build that gate first, in Part B).
// ============================================================================

// --- Given helpers (they talk to macOS) ---------------------------------------------
// hashFile(path) -> Promise of a "fingerprint" (SHA-256) of the file's CONTENT.
// Two files with the same fingerprint have the same content, whatever their names.
// It reads the file in small chunks (a stream), so a 5 GB .dmg doesn't fill your 8 GB of RAM.
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// trashFile(path) — asks FINDER to move one file to the Trash (so "Put Back" works).
export function trashFile(filePath) {
  execFileSync("osascript", [
    "-e", "on run argv",
    "-e", "set f to (POSIX file (item 1 of argv)) as alias",
    "-e", 'tell application "Finder" to delete f',
    "-e", "end run",
    filePath,
  ], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
}

// quitByName(name) -> "quit" | "not running"
// Asks the app to quit NICELY (like ⌘Q) — if it has unsaved work, the app itself asks you.
// It asks System Events (macOS's list of RUNNING apps) first. An unknown name like "Chrome"
// just gives "not running". 
export function quitByName(name) {
  return execFileSync("osascript", [
    "-e", "on run argv",
    "-e", "set appName to item 1 of argv",
    "-e", 'tell application "System Events"',
    "-e", "if not (exists application process appName) then return \"not running\"",
    "-e", "set bundleID to bundle identifier of application process appName",
    "-e", "end tell",
    "-e", "tell application id bundleID to quit",
    "-e", 'return "quit"',
    "-e", "end run",
    name,
  ], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}


// 16. scanDuplicates(folder = DOWNLOADS)               ← async
// IN:   a folder (default: Downloads; the tests pass a temporary folder)
// OUT:  planDuplicates(...) of the identical files in that folder — FULL paths
export async function scanDuplicates(folder = DOWNLOADS) {
 
//             reads the contents of a directory.
  const entries = fs.readdirSync(folder, { withFileTypes: true });

//       -Filter out directories and hidden files
  const visibleFiles = entries.filter(entry => {
    return entry.isFile() && !entry.name.startsWith(".");   //isFile-> check whether entry is file & whether its name begin with a dot.
  })

//       Convert entries into file objects
  const files = [];

  for(const entry of visibleFiles){
    const fullPath = path.join(folder, entry.name);
    const size = fs.statSync(fullPath).size;

    if(size === 0) continue;
    files.push({path: fullPath, size})
  }

  const duplicates = [];

//       Group files by size
  const sameSize = findGroups(files, "size");     // Before: {path: "/Downloads/report.pdf", size: 2000}

  for(const group of sameSize){
    for(const file of group){

//         Calculate the hash of each file
      file.hash = await hashFile(file.path);      // After hashing: {path: "...", size:...,hash: "a1b2c3..."}
    }
//       Group files by hash
  duplicates.push(...findGroups(group, "hash"))
  }

  return planDuplicates(duplicates)
}


// 17. findDuplicates(args, { folder } = {})            ← async · READ-ONLY tool
// IN:   args from the model (none needed — ignore it), and an options object whose
//       folder defaults to DOWNLOADS. Write the parameters as:
//         (args = {}, { folder = DOWNLOADS } = {})
// OUT:  what the MODEL sees — file NAMES only (path.basename), not full paths, and max 10 groups:
//       {
//         groups:        [{ keep: "report.pdf", extras: ["report (1).pdf"], sizeMB: 2 }, ...]  (first 10)
//         totalExtras:   how many extras there are in total (ALL groups, not just the first 10)
//         reclaimableMB: from scanDuplicates
//       }
export async function findDuplicates(args = {}, { folder = DOWNLOADS } = {}) {

//step1 -> call scanDuplicates
  const plan = await scanDuplicates(folder);

// step2 -> limit it to 10 groups
  const groups = plan.groups.slice(0, 10).map(({keep, extras, sizeMB}) => ({
    keep: path.basename(keep),
    extras: extras.map((filePath) => path.basename(filePath)),
    sizeMB
  }))

// setp3 -> count all extra files
  const totalExtras = plan.extras.length;

  return{
    groups,
    totalExtras,
    reclaimableMB: plan.reclaimableMB
  }
}


// 18. moveDuplicatesToTrash({ files }, { folder, trash } = {})   ← async · ★ ACTION ★
// IN:   { files: ["report (1).pdf", ...] } from the model — FILE NAMES it got from findDuplicates,
//       and options: folder (default DOWNLOADS), trash (default trashFile — the tests pass a fake).
//       Parameters:  ({ files } = {}, { folder = DOWNLOADS, trash = trashFile } = {})
// OUT:  { moved: [names], skipped: [names], failed: [names] }
export async function moveDuplicatesToTrash({ files } = {}, { folder = DOWNLOADS, trash = trashFile } = {}) {

// Step1 -> validate the input
  if(!Array.isArray(files) || files.length === 0){
    return {error: `Give a list of file names to move.`};
  }
// Step1.1 -> check the length
  if(files.length > MAX_TRASH_FILES){
    return {error: `At most ${MAX_TRASH_FILES} files at a time.`};
  }
// Step2 -> scan the folder again
  const plan = await scanDuplicates(folder);

// Step3 -> Build a Map of allowed files             // plan.extras ->["/User.../report(1).pdf", "/User..../photo copy.jpn"]
  const allowedExtras = new Map(
    plan.extras.map((fullPath) => [path.basename(fullPath), fullPath])    //each path, create a two-element array:
  )

// Step4 ->Creat the result array
  const moved = [];
  const skipped = [];
  const failed = [];

// Step5 —>Process each requested filename
  for(const name of files){

    const fullPath = allowedExtras.get(name)
      // is it string / does filename exist in allowlist / is full path inside the intended folder
    if(typeof name !== "string" || !fullPath || !isInside(folder, fullPath)){   
      skipped.push(name);
      continue;
    }

// step6 ->Move the file and handle errors
    try{
      await trash(fullPath);            //why use tryCatch->macOS might deny permission or file might no longer exist
      moved.push(name)
    }catch{
      failed.push(name);
    }
  }
// step7 -> return final result
  return {moved, skipped, failed};
}


// 19. quitApp({ name }, { quit } = {})                 ← ★ ACTION ★
// IN:   { name: "Spotify" } from the model, and options: quit (default quitByName — tests pass a fake)
//       Parameters:  ({ name } = {}, { quit = quitByName } = {})
// OUT:  - checkAppName(name) found a problem -> { error: <that message> }   (quit is NOT called)
//       - otherwise call quit(trimmedName):
//            it returned "quit"  -> { quit: trimmedName }
//            anything else       -> { notRunning: trimmedName }
export function quitApp({ name } = {}, { quit = quitByName } = {}) {
  const problem = checkAppName(name);
  if(problem !== null){
    return {error: problem}
  }
  const trimmedName = name.trim()

  const result = quit(trimmedName);

  if(result === "quit"){
    return {quit: trimmedName};
  }else{
    return {notRunning: trimmedName}
  }

}


// --- Given: the toolbox — tool name -> function. agent.js looks tools up here. ---------
export const TOOLS = {
  getSystemInfo, getDiskSpace, getMemoryStatus, getTopApps, findFiles,   // Stage 4 (read-only)
  findDuplicates,                                                        // 4b, read-only
  quitApp, moveDuplicatesToTrash,                                        // 4b, ACTIONS
};

