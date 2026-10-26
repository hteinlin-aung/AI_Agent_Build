// Run every tool directly — NO model involved.  node check-tools.js
// Use this to check your tools on your Mac BEFORE the agent uses them.
// If a tool is wrong here, the agent will be wrong too.

import { TOOLS } from "./tools.js";

const examples = {
  getSystemInfo: {},
  getDiskSpace: {},
  getMemoryStatus: {},
  getTopApps: { limit: 5 },
  findFiles: { name: "Resume" }, // a file u KNOW exists — proves the tool works
};

for (const [name, args] of Object.entries(examples)) {
  console.log(`\n=== ${name}(${JSON.stringify(args)}) ===`);
  try {
    const result = await TOOLS[name](args);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}
