// Slice 3, D20 (Ships 1; operations-runbook spec): the alarm-to-runbook link check. Both stacks are
// synthesized at their most (kill switch armed, simulator on), and every alarm's description must
// link `docs/runbook.md` at a heading under `## Alarms`, every registry `docs` link into the runbook
// at a heading under `## Error codes`, and the runbook's own relative links must resolve. A canary
// proves the checker rejects an unknown slug, so a checker that passes everything fails here. Unit
// tier, so `pnpm check` and the `unit` stage of `pnpm verify` run it; no credentials, no network.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorRegistry, RUNBOOK_BASE_URL } from '@ledger/core';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AppStack } from './app.stack.ts';
import { GuardrailsStack } from './guardrails.stack.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const RUNBOOK = 'docs/runbook.md';
const ALARMS_SECTION = 'Alarms';
const ERROR_CODES_SECTION = 'Error codes';

// GitHub's heading anchor: lowercase, spaces to `-`, punctuation other than `-` and `_` dropped
// (D20; the same rule as `scripts/check-links.mjs`, which has no duplicate headings to number here).
const githubSlug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
    .replace(/ /g, '-');

// The slugs of the `###` headings under each `##` section, outside fenced code.
function runbookSlugs(markdown: string): Map<string, Set<string>> {
  const sections = new Map<string, Set<string>>();
  let section: Set<string> | undefined;
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const h2 = /^## +(.+?)\s*$/.exec(line);
    if (h2?.[1] !== undefined) {
      section = new Set();
      sections.set(h2[1], section);
      continue;
    }
    const h3 = /^### +(.+?)\s*$/.exec(line);
    if (h3?.[1] !== undefined) section?.add(githubSlug(h3[1]));
  }
  return sections;
}

const RUNBOOK_LINK = new RegExp(
  `Runbook: ${RUNBOOK_BASE_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}#([^\\s#]+)$`,
);

// The checker: the names of the alarms whose description lacks a runbook link, or links a slug no
// heading under `## Alarms` carries. Empty means every alarm resolves.
function alarmsMissingRunbookEntry(
  alarms: readonly { name: string; description: string | undefined }[],
  alarmSlugs: ReadonlySet<string>,
): string[] {
  return alarms
    .filter(({ description }) => {
      const slug = RUNBOOK_LINK.exec(description ?? '')?.[1];
      return slug === undefined || !alarmSlugs.has(slug);
    })
    .map(({ name }) => name);
}

const slugs = runbookSlugs(readFileSync(join(repoRoot, RUNBOOK), 'utf8'));
const alarmSlugs = slugs.get(ALARMS_SECTION) ?? new Set<string>();
const errorCodeSlugs = slugs.get(ERROR_CODES_SECTION) ?? new Set<string>();

// Synthesized here, not inside a test: bundling every function takes seconds on a loaded machine.
const templates = [
  Template.fromStack(
    new GuardrailsStack(new App(), 'LedgerGuardrails', {
      appStackName: 'LedgerApp',
      budgetUsd: 50,
      killSwitch: true,
      budgetDrill: false,
    }),
  ),
  Template.fromStack(
    new AppStack(new App(), 'LedgerApp', {
      commit: '0123456789abcdef0123456789abcdef01234567',
      guardrailsStackName: 'LedgerGuardrails',
      simulator: true,
      resendWebhookId: 'unset',
    }),
  ),
];

type AlarmResource = { Properties: { AlarmName: string; AlarmDescription?: string } };
const alarms = templates.flatMap((template) =>
  Object.values(
    template.findResources('AWS::CloudWatch::Alarm') as Record<string, AlarmResource>,
  ).map((alarm) => ({
    name: alarm.Properties.AlarmName,
    description: alarm.Properties.AlarmDescription,
  })),
);

describe('alarm-to-runbook link check (D20)', () => {
  it('links every alarm in both stacks to a heading under ## Alarms in docs/runbook.md', () => {
    // Paired with the count, so a template holding no alarm cannot pass by matching nothing.
    expect(alarms).toHaveLength(6);
    expect(alarmsMissingRunbookEntry(alarms, alarmSlugs)).toEqual([]);
  });

  it('links every registry code whose docs point at the runbook to a heading under ## Error codes', () => {
    const runbookLinked = Object.entries(errorRegistry).filter(([, entry]) =>
      entry.docs.startsWith(`${RUNBOOK_BASE_URL}#`),
    );
    expect(runbookLinked).toHaveLength(15);
    const missing = runbookLinked
      .filter(([, entry]) => !errorCodeSlugs.has(entry.docs.slice(RUNBOOK_BASE_URL.length + 1)))
      .map(([code]) => code);
    expect(missing).toEqual([]);
  });

  it('rejects a fabricated alarm whose slug matches no heading, or that has no runbook link (canary)', () => {
    expect(
      alarmsMissingRunbookEntry(
        [
          {
            name: 'LedgerApp-no-such-alarm',
            description: `Fabricated. Runbook: ${RUNBOOK_BASE_URL}#ledgerapp-no-such-alarm`,
          },
          { name: 'LedgerApp-no-link', description: 'Fabricated, with no runbook link' },
          { name: 'LedgerApp-no-description', description: undefined },
          // A real slug under the wrong section is still refused.
          {
            name: 'unauthorized',
            description: `Fabricated. Runbook: ${RUNBOOK_BASE_URL}#unauthorized`,
          },
        ],
        alarmSlugs,
      ),
    ).toEqual([
      'LedgerApp-no-such-alarm',
      'LedgerApp-no-link',
      'LedgerApp-no-description',
      'unauthorized',
    ]);
    expect(githubSlug('LedgerGuardrails-kill-switch-errors')).toBe(
      'ledgerguardrails-kill-switch-errors',
    );
    expect(githubSlug('validation_failed')).toBe('validation_failed');
  });

  it("resolves the runbook's own relative links and anchors (scripts/check-links.mjs)", () => {
    const run = spawnSync(process.execPath, ['scripts/check-links.mjs', RUNBOOK], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });
});
