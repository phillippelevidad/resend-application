# Commands — ready-made prompts, not skills

**Do NOT read this folder unless asked for a command by name.** Nothing here is context for a task.

**What lives here.** Prompt templates the owner copies and pastes, by hand, into a larger prompt.
They are inert text: no frontmatter, never auto-loaded, never invoked by a model.

**Why not skills.** A skill's frontmatter loads into every session, and a model may invoke it on
its own judgement. That suits binding conventions ([`.agents/skills/`](../../.agents/skills/)), not
an expensive procedure that should run only when a person decides it should.

## Rules for a command file (MUST)

- **Self-contained.** It may be pasted into a session that has never read this repo. It carries its
  own context and does not depend on a repo path resolving.
- **Generic.** It describes a procedure, not one past use of it. A quoted past case is labelled as
  an example.
- **Budgeted.** If it spawns subagents, it states the model, a hard fan-out cap and a tool-call cap.
  The default is `do NOT spawn subagents`.
- **Staged.** A long procedure writes each stage to a file, so a crash or a rate limit loses one
  stage, not all of them.

## Naming

`<verb-noun>.md`, kebab-case.

| Command | Use it for |
| --- | --- |
| [auto-decide.md](auto-decide.md) | Letting an agent decide in the owner's place on an unattended run: decided from the ratified docs, logged as it goes, summarized for review |
| [next-bootstrap-step.md](next-bootstrap-step.md) | Working the next step of [bootstrap-checklist.md](../bootstrap-checklist.md) after a `/clear`: one batched question round with recommendations, then the step runs to a commit. Delete with the checklist |
