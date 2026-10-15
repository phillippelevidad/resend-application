# Product & domain context

These docs are **AI-first, human-second**: written to be queried by coding agents, and readable by
humans reviewing decisions. Optimize for retrieval and signal density, not prose.

Every file below is ratified and binding. [docs/idea.md](../docs/idea.md) is a frozen RFC (accepted
2026-10-15): read it for history, never as the current rule.

## Rules

- Docs here MUST be tight — cut rhetoric, state facts and constraints, cross-reference instead of
  repeating.
- Edits and additions MUST preserve the AI-first intent above.
- Authors SHOULD use RFC 2119 keywords (MUST, MUST NOT, SHOULD, MAY) when stating rules or
  constraints, so agents can tell a hard requirement from a preference.
- Binding constraints MUST be stated once, canonically, and linked. Unverified claims MUST be tagged
  `[Unverified]` and listed under [about.md → Open questions](about.md#open-questions).
- **Every reliability claim carries its evidence** — a test, a property, an invariant or a cited
  doc page ([decision lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- This repo is **public**. No personal details, no real recipient addresses, no account IDs,
  endpoint URLs or secrets. Refer to people by role.

## Documents

| Document | Description | When to read |
| --- | --- | --- |
| [about.md](about.md) | Product, personas, what the project must demonstrate, milestones, scale ceiling, risk appetite, vocabulary, non-goals, open questions | Required |
| [decision-lens-suite.md](decision-lens-suite.md) | The ratified cases the [decision lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized) MUST reproduce, with the reason each verdict rests on | Required — before editing the decision lens |
| [features.md](features.md) | Adopter lifecycle (binding), journeys, capability inventory, Webhook Ingester parity (non-binding) | Optional — scoping |
| [resend.md](resend.md) | Verified Resend behavior Ledger relies on (`RS-NN` facts), each with its cited page | Required — any code touching webhooks or Resend's API |
| [aws.md](aws.md) | AWS limits and semantics Ledger relies on (`AWS-NN` facts), cost shape, budget alarms | Required — infra work |
| [integrations.md](integrations.md) | Resend calling discipline, relationship to the Webhook Ingester, Postgres host decision | Optional — integration work |
| [architecture.md](architecture.md) | ADRs, system shape, Deferred (YAGNI), build order (slices → milestones), risks | Required — implementation work |
| [data-modeling.md](data-modeling.md) | Modeling principles and per-table intent; the Drizzle schema in `packages/db` owns columns | Required — schema work |
| [api-contract.md](api-contract.md) | Operations and their surfaces (read API, SDK, CLI, MCP), scopes, error-code registry | Required — any public contract work |
| [build-checklist.md](build-checklist.md) | Per-slice execution tracker the `wf-*` skills parse | Required — planning, proposing, status |
| [check-before-launch.md](check-before-launch.md) | Homeless pre-deploy and pre-demo checks | Required — before a deploy or publishing the demo |
| [pre-proposals/](pre-proposals/) | One decision-complete brief per slice, written by `wf-before-propose` | When proposing a slice |
| [reviews/](reviews/) | One folder per docs verification run: its decisions log. A historical record, **not binding**: the fixes live in the docs above | Never — unless auditing a past review |
| [commands/](commands/AGENTS.md) | Ready-made prompts the owner pastes by hand. **Not context, never auto-invoked** | **Never — unless asked for a command by name** |