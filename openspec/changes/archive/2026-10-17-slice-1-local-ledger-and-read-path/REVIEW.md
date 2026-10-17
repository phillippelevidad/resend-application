# Review — 2026-10-17

**Verdict:** ready for `opsx:apply`
**Checked against:** the slice 1 card · `.ai/pre-proposals/2026-10-17-slice-1-local-ledger-and-read-path.md` · pp-workflow, pp-general, pp-backend, pp-database, pp-testing, pp-cli (`Never` lists) · ADR-001–005, 008, 009, 011–013, 016, 018, 019 · the repo at `fb0218a`
**Repaired:** 9 (pre-proposal §8, §12, §18 and §21 carried into design.md and tasks.md, because apply loads only the four artifacts; non-object verified payloads stored raw instead of dead-listed, ADR-004; 43 decisions made addressable as `### Dn —` headings; endpoint paths in four specs replaced by operation ids; the simulator spec's probe-address contradiction; three spec scenarios no test asserted; the drift stage's header comment; the dev:full CLI banner; the sim e2e test after 11.4)

## Judgement calls the builder should know about
- A top-level JSON `null` payload is stored as the `jsonb` value `null`. If the installed Drizzle sends SQL `NULL`, D17's fallback is the `'null'` literal through the `sql` template. Task 6.3 finds out which.
- Decision authorities stay in PP §7 under the same `D<n>`; design.md states each rule without its citation trail. A decision here is not reopened at build time.
- The verify-gate spec keeps the two committed file names: they are Ships 9's own wording and the stage's printed output.
- Tasks 7.4 and 9.6 keep `GET /nope` and `DELETE /emails/e1` as test inputs; they are deliberately unassigned paths.

## What this review could not confirm
- The 8 remaining `[contract]` BLOCKs from `check.mjs` are one false positive: dotted code identifiers (`webhooks.verify`, `crypto.randomUUID`, `app.notFound`, repository functions) read as operation names. None is a read-API operation.
- Library behaviour the design leaves to install time, each with a fallback: `@hono/zod-openapi`'s 415, drizzle-kit loading `@ledger/core`, `openapi-typescript` under TypeScript 7, Vitest project `globalSetup`, Drizzle's `jsonb` `null`.
- RS-U14, RS-U15, RS-U18, RS-U21, RS-U22: only the owner's Ask-first experiments in group 11 settle them.
- No pass was cut. Reality checks ran inline (no sub-agents).
