# Next bootstrap step

Paste after a fresh session (`/clear`). Works one step of the `.ai/` bootstrap per session, in a
"next, next, finish" rhythm: one batched round of owner questions, then the step runs to a commit.

**Budget:** subagents inherit the session model. One read-only helper in step 2 (≤ 20 tool calls).
In step 4, at most 5 subagents in flight, each ≤ 30 tool calls. Staged by design: each step lands
in its own file and its own commit.

```text
Continue the .ai/ bootstrap: work the next step of .ai/bootstrap-checklist.md.

1. Pick the step: resume a `[~]` step, otherwise take the first `[ ]` step whose dependencies are all `[x]`. Mark it `[~]`.
2. Before writing anything, start one read-only helper agent (≤ 20 tool calls). It reads the step's file (TEMPLATE banner + AGENT INSTRUCTIONS) and every input that file names. It returns only the owner decisions the step really needs, each with options, a recommended pick and the reason from the decision lens. It leaves out anything the docs already settle.
3. Ask me those questions in one batch, recommended option first. If there are none, say so and go on.
4. Do the step exactly as its instructions say: research and cite, replace the preview content, remove the banner and the instructions. Delegate to subagents where that saves context (at most 5 at once, ≤ 30 tool calls each).
5. Tick the step `[x]`, commit and push. Report in 10 lines or fewer: what was done, what's still unverified, and the next step.

One step per session. Stop if a step is blocked, and mark it `[!]`.
```
