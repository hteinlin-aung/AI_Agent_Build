// Stage 4b — try the NEW tools on your real Mac, with NO model. Run with:  node check-actions.js
// Like check-tools.js, but for the actions. It asks you y/n before anything changes.
//
// What it does:
//   1. findDuplicates on your real Downloads (read-only) and prints what it found
//   2. quitApp with a FAKE app name  -> should say notRunning (proves the AppleScript works
//      and doesn't launch anything)
//   3. quitApp("Finder")             -> should be blocked as protected
//   4. Makes two test files in Downloads:  stage4b-test.txt  and  stage4b-test copy.txt
//      and asks y/n to move the COPY to the Trash. Check your Trash afterwards — you should be
//      able to "Put Back" it. You can delete stage4b-test.txt yourself when you're done.

import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { findDuplicates, quitApp, moveDuplicatesToTrash, DOWNLOADS } from "./tools.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function show(label, fn) {
  try {
    console.log(`\n${label}\n`, await fn());
  } catch (err) {
    console.log(`\n${label}\n  ERROR: ${err.message}`);
  }
}

await show("1. findDuplicates() — your real Downloads, read-only:", () => findDuplicates());
await show("2. quitApp({ name: \"NotARealApp123\" }) — expect { notRunning: ... }:", () => quitApp({ name: "NotARealApp123" }));
await show("3. quitApp({ name: \"Finder\" }) — expect a 'protected' error:", () => quitApp({ name: "Finder" }));

const original = path.join(DOWNLOADS, "stage4b-test.txt");
const copy = path.join(DOWNLOADS, "stage4b-test copy.txt");
const reply = await rl.question(`\n4. Create two test files in Downloads and move "stage4b-test copy.txt" to the Trash? (y/n) `);
if (reply.trim().toLowerCase() === "y") {
  fs.writeFileSync(original, "Stage 4b test file — safe to delete.\n");
  fs.writeFileSync(copy, "Stage 4b test file — safe to delete.\n");
  await show("   findDuplicates() should now list stage4b-test copy.txt as an extra:", () => findDuplicates());
  await show("   moveDuplicatesToTrash({ files: [\"stage4b-test copy.txt\"] }):",
    () => moveDuplicatesToTrash({ files: ["stage4b-test copy.txt"] }));
  console.log(`\n   Copy still in Downloads? ${fs.existsSync(copy) ? "YES — it was NOT moved" : "no — it's in the Trash ✅"}`);
  console.log(`   Original still in Downloads? ${fs.existsSync(original) ? "yes ✅ (delete it yourself when done)" : "NO — that's wrong!"}`);
} else {
  console.log("   Skipped — nothing was created or moved.");
}
rl.close();
