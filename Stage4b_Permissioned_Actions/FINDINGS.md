Stage 4b gave the Mac AI assistant the ability to do things, not just check system information. It can now quit apps and move duplicate files from 
Downloads to the Trash, but it must ask for permission before doing anything. It also checks that the files are really duplicates and blocks important 
apps from being closed. During testing, a few bugs came up, including problems with where variables could be used, the order of the code, and the output 
format. After fixing them, all 66 action tests passed. Another problem was that the AI sometimes made up details about the Mac when it did not use the 
tools. This was improved by changing the prompt and adding a check in the code to make the agent use its tools instead of only saying what it planned to 
do. Testing also found issues with fake app names and the exit command, which were fixed too. The main lesson from this stage is that an AI agent needs 
more than the ability to do things. It also needs clear limits, permission checks, and tests to make sure it behaves properly when something goes wrong. 
Stage 4b is now complete, and the next step is to rebuild the agent with LangGraph to help organize its workflow and handle permission requests.


