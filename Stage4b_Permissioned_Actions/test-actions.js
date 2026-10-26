// Self-checking runner for STAGE 4b — the action helpers, the new tools and the permission gate.
// Run with:  node test-actions.js   — no model, no real Trash, no real apps are touched:
// the tests use a temporary folder, a FAKE trash and a FAKE quit. Works with Ollama off.

import fs from "fs";
import os from "os";
import path from "path";
import {
  checkAppName, findGroups, chooseKeeper, isInside, planDuplicates,
  scanDuplicates, findDuplicates, moveDuplicatesToTrash, quitApp, TOOLS,
} from "./tools.js";
import { ACTION_TOOLS, describeAction, runTool, runAgent, TOOL_DEFINITIONS } from "./agent.js";

// --- Runner -----------------------------------------------------------------------
const show = (v) => (v === undefined ? "undefined" : JSON.stringify(v));
let pass = 0;
let fail = 0;
let currentGroup = "";
async function check(group, label, getActual, expected) {
  if (group !== currentGroup) {
    console.log(`\n${group}`);
    currentGroup = group;
  }
  try {
    const actual = await getActual();
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      pass++;
      console.log(`  PASS  ${label}`);
    } else {
      fail++;
      console.log(`  FAIL  ${label}\n        expected ${show(expected)}\n        got      ${show(actual)}`);
    }
  } catch (err) {
    fail++;
    console.log(`  ERROR ${label}\n        ${err.message}`);
  }
}

// --- A temporary "Downloads" folder, made fresh for the tests --------------------------
function makeFolder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage4b-"));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}
const DL = makeFolder({
  "a.txt": "hello",
  "a copy.txt": "hello",          // duplicate of a.txt
  "b.txt": "world",               // SAME SIZE as hello (5 bytes) but different content -> not a duplicate
  "c.txt": "unique!",
  ".hidden": "hello",             // hidden -> ignored
  "empty1": "",
  "empty2": "",                   // empty files -> ignored
  "sub/a.txt": "hello",           // inside a sub-folder -> ignored (top level only)
});
const EMPTY = makeFolder({});
const MANY = makeFolder(Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [[`f${i}.txt`, "x".repeat(i + 1)], [`f${i} copy.txt`, "x".repeat(i + 1)]]).flat(),
));

// A fake trash and a fake quit that only RECORD what they were asked to do
let trashed = [];
const fakeTrash = async (p) => { trashed.push(p); };
const brokenTrash = async () => { throw new Error("Finder said no"); };
let quitCalls = [];
const fakeQuit = (status) => (name) => { quitCalls.push(name); return status; };

// ===================== C. pure helpers =====================
await check("11. checkAppName", "\"Spotify\" -> null (OK)", () => checkAppName("Spotify"), null);
await check("11. checkAppName", "spaces around are fine", () => checkAppName("  Spotify  "), null);
await check("11. checkAppName", "\"Microsoft Word\" -> null", () => checkAppName("Microsoft Word"), null);
await check("11. checkAppName", "empty -> missing", () => checkAppName(""), "App name is missing.");
await check("11. checkAppName", "only spaces -> missing", () => checkAppName("   "), "App name is missing.");
await check("11. checkAppName", "not a string -> missing", () => checkAppName(undefined), "App name is missing.");
await check("11. checkAppName", "51 characters -> too long", () => checkAppName("a".repeat(51)), "App name is too long (max 50 characters).");
await check("11. checkAppName", "quotes / ; -> not allowed", () => checkAppName('Spotify"; rm -rf ~'), "App name has characters that are not allowed.");
await check("11. checkAppName", "\"finder\" -> protected (any case)", () => checkAppName("finder"), '"finder" is protected — the assistant can\'t quit it.');
await check("11. checkAppName", "\" Terminal \" -> protected (trimmed)", () => checkAppName(" Terminal "), '"Terminal" is protected — the assistant can\'t quit it.');

await check("12. findGroups", "groups items with the same value", () =>
  findGroups([{ n: "a", size: 5 }, { n: "b", size: 9 }, { n: "c", size: 5 }], "size"),
  [[{ n: "a", size: 5 }, { n: "c", size: 5 }]]);
await check("12. findGroups", "nothing repeated -> []", () => findGroups([{ n: "a", size: 1 }, { n: "b", size: 2 }], "size"), []);
await check("12. findGroups", "several groups, in first-seen order", () =>
  findGroups([{ n: "a", h: 1 }, { n: "b", h: 2 }, { n: "c", h: 1 }, { n: "d", h: 2 }], "h").map((g) => g.map((i) => i.n)),
  [["a", "c"], ["b", "d"]]);
await check("12. findGroups", "three the same -> one group of 3", () =>
  findGroups([{ n: "a", h: 7 }, { n: "b", h: 7 }, { n: "c", h: 7 }], "h").map((g) => g.length), [3]);
await check("12. findGroups", "doesn't change the input", () => {
  const input = [{ n: "a", size: 5 }, { n: "c", size: 5 }];
  findGroups(input, "size");
  return input;
}, [{ n: "a", size: 5 }, { n: "c", size: 5 }]);

await check("13. chooseKeeper", "keeps \"report.pdf\" over \"report (1).pdf\"", () =>
  chooseKeeper(["/d/report (1).pdf", "/d/report.pdf"]), "/d/report.pdf");
await check("13. chooseKeeper", "shortest of three", () =>
  chooseKeeper(["/d/photo copy.jpg", "/d/photo.jpg", "/d/photo 2.jpg"]), "/d/photo.jpg");
await check("13. chooseKeeper", "same length -> alphabetical", () => chooseKeeper(["/d/b.txt", "/d/a.txt"]), "/d/a.txt");
await check("13. chooseKeeper", "compares the FILE NAME, not the whole path", () =>
  chooseKeeper(["/a-very-long-folder/a.txt", "/d/aa.txt"]), "/a-very-long-folder/a.txt");
await check("13. chooseKeeper", "doesn't change the input (careful: .sort changes arrays!)", () => {
  const input = ["/d/report (1).pdf", "/d/report.pdf"];
  chooseKeeper(input);
  return input;
}, ["/d/report (1).pdf", "/d/report.pdf"]);

await check("14. isInside", "a file in the folder -> true", () => isInside("/Users/me/Downloads", "/Users/me/Downloads/a.pdf"), true);
await check("14. isInside", "in a sub-folder -> true", () => isInside("/Users/me/Downloads", "/Users/me/Downloads/x/y.pdf"), true);
await check("14. isInside", "\"..\" escapes the folder -> false", () => isInside("/Users/me/Downloads", "/Users/me/Downloads/../Documents/cv.pdf"), false);
await check("14. isInside", "\"Downloads2\" is NOT inside \"Downloads\" -> false", () => isInside("/Users/me/Downloads", "/Users/me/Downloads2/a.pdf"), false);
await check("14. isInside", "the folder itself -> false", () => isInside("/Users/me/Downloads", "/Users/me/Downloads"), false);
await check("14. isInside", "\"./\" is cleaned up -> true", () => isInside("/Users/me/Downloads", "/Users/me/Downloads/./a.pdf"), true);

const GROUPS = [
  [{ path: "/d/a (1).pdf", size: 2_000_000 }, { path: "/d/a.pdf", size: 2_000_000 }],
  [{ path: "/d/big copy.zip", size: 50_000_000 }, { path: "/d/big.zip", size: 50_000_000 }, { path: "/d/big (2).zip", size: 50_000_000 }],
];
await check("15. planDuplicates", "biggest group first, keep + extras + sizeMB", () => planDuplicates(GROUPS).groups, [
  { keep: "/d/big.zip", extras: ["/d/big copy.zip", "/d/big (2).zip"], sizeMB: 50 },
  { keep: "/d/a.pdf", extras: ["/d/a (1).pdf"], sizeMB: 2 },
]);
await check("15. planDuplicates", "extras = every extra, same order as groups", () => planDuplicates(GROUPS).extras,
  ["/d/big copy.zip", "/d/big (2).zip", "/d/a (1).pdf"]);
await check("15. planDuplicates", "reclaimableMB = all extras' bytes (50+50+2)", () => planDuplicates(GROUPS).reclaimableMB, 102);
await check("15. planDuplicates", "adds BYTES first, then rounds", () =>
  planDuplicates([[{ path: "/d/x.bin", size: 1_040_000 }, { path: "/d/x (1).bin", size: 1_040_000 }, { path: "/d/x (2).bin", size: 1_040_000 }]]).reclaimableMB, 2.1);
await check("15. planDuplicates", "no groups", () => planDuplicates([]), { groups: [], extras: [], reclaimableMB: 0 });

// ===================== D. the new tools (temporary folder, fake trash, fake quit) =====================
await check("16. scanDuplicates", "finds a.txt + \"a copy.txt\" only (same size but different content is NOT a duplicate)", async () => {
  const plan = await scanDuplicates(DL);
  return plan.groups.map((g) => ({ keep: path.basename(g.keep), extras: g.extras.map((p) => path.basename(p)) }));
}, [{ keep: "a.txt", extras: ["a copy.txt"] }]);
await check("16. scanDuplicates", "returns FULL paths", async () => (await scanDuplicates(DL)).extras, [path.join(DL, "a copy.txt")]);
await check("16. scanDuplicates", "ignores hidden files, empty files and sub-folders", async () => (await scanDuplicates(DL)).extras.length, 1);
await check("16. scanDuplicates", "empty folder -> nothing", async () => scanDuplicates(EMPTY), { groups: [], extras: [], reclaimableMB: 0 });

await check("17. findDuplicates", "names only (no paths), the model's view", async () => findDuplicates({}, { folder: DL }), {
  groups: [{ keep: "a.txt", extras: ["a copy.txt"], sizeMB: 0 }], totalExtras: 1, reclaimableMB: 0,
});
await check("17. findDuplicates", "max 10 groups, but totalExtras counts all 12", async () => {
  const r = await findDuplicates({}, { folder: MANY });
  return [r.groups.length, r.totalExtras];
}, [10, 12]);

await check("18. moveDuplicatesToTrash", "an extra copy -> moved (fake trash got the FULL path)", async () => {
  trashed = [];
  const r = await moveDuplicatesToTrash({ files: ["a copy.txt"] }, { folder: DL, trash: fakeTrash });
  return [r, trashed];
}, [{ moved: ["a copy.txt"], skipped: [], failed: [] }, [path.join(DL, "a copy.txt")]]);
await check("18. moveDuplicatesToTrash", "the KEEP file -> skipped, trash never called", async () => {
  trashed = [];
  const r = await moveDuplicatesToTrash({ files: ["a.txt"] }, { folder: DL, trash: fakeTrash });
  return [r, trashed];
}, [{ moved: [], skipped: ["a.txt"], failed: [] }, []]);
await check("18. moveDuplicatesToTrash", "\"../secret\" and a non-duplicate -> skipped", async () => {
  trashed = [];
  const r = await moveDuplicatesToTrash({ files: ["../secret.txt", "c.txt", "sub/a.txt"] }, { folder: DL, trash: fakeTrash });
  return [r, trashed];
}, [{ moved: [], skipped: ["../secret.txt", "c.txt", "sub/a.txt"], failed: [] }, []]);
await check("18. moveDuplicatesToTrash", "no list -> error", async () => moveDuplicatesToTrash({}, { folder: DL, trash: fakeTrash }),
  { error: "Give a list of file names to move." });
await check("18. moveDuplicatesToTrash", "empty list -> error", async () => moveDuplicatesToTrash({ files: [] }, { folder: DL, trash: fakeTrash }),
  { error: "Give a list of file names to move." });
await check("18. moveDuplicatesToTrash", "21 names -> error (max 20)", async () =>
  moveDuplicatesToTrash({ files: Array(21).fill("a copy.txt") }, { folder: DL, trash: fakeTrash }), { error: "At most 20 files at a time." });
await check("18. moveDuplicatesToTrash", "trash throws -> failed (no crash)", async () =>
  moveDuplicatesToTrash({ files: ["a copy.txt"] }, { folder: DL, trash: brokenTrash }), { moved: [], skipped: [], failed: ["a copy.txt"] });

await check("19. quitApp", "running app -> { quit }", () => { quitCalls = []; return [quitApp({ name: "Spotify" }, { quit: fakeQuit("quit") }), quitCalls]; },
  [{ quit: "Spotify" }, ["Spotify"]]);
await check("19. quitApp", "name is trimmed before quitting", () => { quitCalls = []; quitApp({ name: "  Spotify " }, { quit: fakeQuit("quit") }); return quitCalls; },
  ["Spotify"]);
await check("19. quitApp", "not running -> { notRunning }", () => quitApp({ name: "Spotify" }, { quit: fakeQuit("not running") }), { notRunning: "Spotify" });
await check("19. quitApp", "\"Finder\" -> error, quit NEVER called", () => { quitCalls = []; return [quitApp({ name: "Finder" }, { quit: fakeQuit("quit") }), quitCalls]; },
  [{ error: '"Finder" is protected — the assistant can\'t quit it.' }, []]);
await check("19. quitApp", "bad name -> error, quit NEVER called", () => { quitCalls = []; return [quitApp({ name: 'x"; rm' }, { quit: fakeQuit("quit") }), quitCalls]; },
  [{ error: "App name has characters that are not allowed." }, []]);
await check("19. quitApp", "no name -> error", () => quitApp({}, { quit: fakeQuit("quit") }), { error: "App name is missing." });

// ===================== B. the permission gate (agent.js) =====================
await check("Toolbox", "TOOLS has the 3 new tools", () => ["findDuplicates", "quitApp", "moveDuplicatesToTrash"].map((n) => typeof TOOLS[n]),
  ["function", "function", "function"]);
await check("Toolbox", "8 definitions, all exist in TOOLS", () =>
  [TOOL_DEFINITIONS.length, TOOL_DEFINITIONS.every((d) => typeof TOOLS[d.function.name] === "function")], [8, true]);
await check("Toolbox", "ACTION_TOOLS are the two actions", () => ACTION_TOOLS, ["quitApp", "moveDuplicatesToTrash"]);

await check("4. describeAction", "quitApp", () => describeAction("quitApp", { name: "Spotify" }), 'Quit the app "Spotify"');
await check("4. describeAction", "moveDuplicatesToTrash lists every file", () =>
  describeAction("moveDuplicatesToTrash", { files: ["a (1).pdf", "b copy.jpg"] }),
  "Move 2 file(s) from Downloads to the Trash:\n  - a (1).pdf\n  - b copy.jpg");
await check("4. describeAction", "any other tool", () => describeAction("getDiskSpace", {}), 'Run the tool "getDiskSpace"');

// A fake toolbox that records which tools actually RAN
let ran = [];
const box = {
  getDiskSpace: () => { ran.push("getDiskSpace"); return { freeGB: 204 }; },
  quitApp: ({ name }) => { ran.push("quitApp"); return { quit: name }; },
  moveDuplicatesToTrash: ({ files }) => { ran.push("moveDuplicatesToTrash"); return { moved: files, skipped: [], failed: [] }; },
};
let asked = [];
const answer = (reply) => async (text) => { asked.push(text); return reply; };
const DECLINED = JSON.stringify({ declined: true, message: "The user said no. Nothing was changed." });
const reset = () => { ran = []; asked = []; };

await check("6. runTool (4b)", "action + you say NO -> declined, tool did NOT run", async () => {
  reset(); return [await runTool("quitApp", { name: "Spotify" }, box, answer(false)), ran];
}, [DECLINED, []]);
await check("6. runTool (4b)", "action + you say YES -> tool runs", async () => {
  reset(); return [await runTool("quitApp", { name: "Spotify" }, box, answer(true)), ran];
}, [JSON.stringify({ quit: "Spotify" }), ["quitApp"]]);
await check("6. runTool (4b)", "you are shown describeAction's text", async () => {
  reset(); await runTool("moveDuplicatesToTrash", { files: ["a (1).pdf"] }, box, answer(true)); return asked;
}, ["Move 1 file(s) from Downloads to the Trash:\n  - a (1).pdf"]);
await check("6. runTool (4b)", "confirm returns \"yes\" (not true) -> declined", async () => {
  reset(); return [await runTool("quitApp", { name: "Spotify" }, box, answer("yes")), ran];
}, [DECLINED, []]);
await check("6. runTool (4b)", "NO confirm passed -> declined (fail closed)", async () => {
  reset(); return [await runTool("quitApp", { name: "Spotify" }, box), ran];
}, [DECLINED, []]);
await check("6. runTool (4b)", "read-only tool -> no question asked", async () => {
  reset(); return [await runTool("getDiskSpace", {}, box, answer(false)), asked, ran];
}, [JSON.stringify({ freeGB: 204 }), [], ["getDiskSpace"]]);
await check("6. runTool (4b)", "unknown tool -> error, no question asked", async () => {
  reset(); return [await runTool("deleteEverything", {}, box, answer(true)), asked];
}, [JSON.stringify({ error: "Unknown tool: deleteEverything" }), []]);
await check("6. runTool (4b)", "confirm crashes -> error JSON, tool did NOT run", async () => {
  reset();
  const r = await runTool("quitApp", { name: "Spotify" }, box, async () => { throw new Error("keyboard on fire"); });
  return [r, ran];
}, [JSON.stringify({ error: "keyboard on fire" }), []]);

// runAgent with a scripted fake model
let sent = [];
function fakeModel(replies) {
  sent = [];
  let i = 0;
  globalThis.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    const message = replies[Math.min(i, replies.length - 1)];
    i++;
    return { ok: true, status: 200, json: async () => ({ message, done_reason: "stop" }) };
  };
}
const callTool = (name, args = {}) => ({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] });
const say = (text) => ({ role: "assistant", content: text });

await check("8. runAgent (4b)", "passes confirm through: asked, approved, tool ran", async () => {
  reset();
  fakeModel([callTool("quitApp", { name: "Spotify" }), say("Done — Spotify is closed.")]);
  const r = await runAgent("Quit Spotify", { toolbox: box, confirm: answer(true) });
  return [r.answer, r.toolsUsed, asked, ran];
}, ["Done — Spotify is closed.", ["quitApp"], ['Quit the app "Spotify"'], ["quitApp"]]);
await check("8. runAgent (4b)", "no confirm -> declined; the model is TOLD it was declined", async () => {
  reset();
  fakeModel([callTool("quitApp", { name: "Spotify" }), say("Okay, I left Spotify open.")]);
  await runAgent("Quit Spotify", { toolbox: box });
  const toolMessage = sent[1].messages.find((m) => m.role === "tool");
  return [ran, toolMessage.content];
}, [[], DECLINED]);

// --- clean up the temporary folders
for (const dir of [DL, EMPTY, MANY]) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
