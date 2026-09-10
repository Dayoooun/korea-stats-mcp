import fs from 'node:fs';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  RELEASE_ENV,
  REQUIRED_CASES_BY_PHASE,
  type AdmissionReport,
  type CaseEvidence,
  type ReleasePhase,
  type Transport,
  evaluateAdmission,
  loadExternalReceiptsFromEnv,
  parseReleasePhase,
} from './requiredCases.ts';

type RawTest = TestCase & {
  tags?: readonly string[];
  annotations?: readonly { type?: string; description?: string }[];
};

type AttemptStatus = 'passed' | 'failed' | 'skipped' | 'notRun';

interface CollectedCase {
  readonly id: string;
  readonly ac: string[];
  readonly transport: Transport;
  readonly mode: 'offline' | 'live';
  readonly candidate: string;
  readonly candidateProof: { candidate: string };
  readonly transportProof: { candidate: string; transport: Transport };
  readonly prerequisite: boolean;
  readonly statuses: AttemptStatus[];
}

const CASE_ID_PATTERN = /\bREQ-[A-Z][0-9]{2}(?:\.(?:stdio|http))?\b/g;
const AC_PATTERN = /^(?:@)?(AC[0-9]+)$/;

function testParts(test: RawTest): string[] {
  const titlePath = typeof test.titlePath === 'function' ? test.titlePath() : [test.title];
  const annotationText = (test.annotations ?? []).flatMap(annotation =>
    [annotation.type, annotation.description].filter((value): value is string => typeof value === 'string')
  );
  return [...titlePath, ...(test.tags ?? []), ...annotationText];
}

function explicitIds(parts: readonly string[]): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    for (const match of part.matchAll(CASE_ID_PATTERN)) found.add(match[0]);
  }
  return [...found];
}

function explicitTags(parts: readonly string[]): string[] {
  return parts.flatMap(part => part.split(/[\s,]+/).filter(Boolean));
}

function transportFor(id: string, tags: readonly string[]): { transport: Transport; explicit: boolean } {
  const suffix = id.match(/\.(stdio|http)$/)?.[1] as 'stdio' | 'http' | undefined;
  const tagged = new Set(
    tags
      .map(tag => tag.toLowerCase())
      .map(tag => tag.replace(/^@/, ''))
      .filter(tag => tag === 'stdio' || tag === 'http')
  );
  if (suffix) {
    const explicit = tagged.size === 0 || (tagged.size === 1 && tagged.has(suffix));
    return { transport: suffix, explicit };
  }
  if (tagged.has('stdio') && tagged.has('http')) return { transport: 'both', explicit: true };
  if (tagged.has('stdio')) return { transport: 'stdio', explicit: true };
  if (tagged.has('http')) return { transport: 'http', explicit: true };
  return { transport: 'stdio', explicit: false };
}

function modeFor(tags: readonly string[]): { mode: 'offline' | 'live'; explicit: boolean } {
  const modes = [
    ...new Set(
      tags
        .map(tag => tag.toLowerCase().replace(/^@/, ''))
        .filter(tag => tag === 'offline' || tag === 'live')
    ),
  ];
  if (modes.length === 1) return { mode: modes[0] as 'offline' | 'live', explicit: true };
  return { mode: 'offline', explicit: false };
}

function acFor(tags: readonly string[]): string[] {
  return [...new Set(tags.map(tag => tag.match(AC_PATTERN)?.[1]).filter((ac): ac is string => !!ac))];
}

function candidateTag(tags: readonly string[]): string | undefined {
  return tags.find(tag => tag.startsWith('@candidate='))?.slice('@candidate='.length);
}

function resultStatus(result: TestResult): AttemptStatus {
  if (result.status === 'passed') return 'passed';
  if (result.status === 'skipped') return 'skipped';
  if (result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted') {
    return 'failed';
  }
  return 'notRun';
}

function aggregateStatus(statuses: readonly AttemptStatus[]): AttemptStatus {
  if (statuses.some(status => status === 'failed')) return 'failed';
  if (statuses.some(status => status === 'skipped')) return 'skipped';
  if (statuses.some(status => status === 'notRun')) return 'notRun';
  return 'passed';
}

function candidateFromEnv(env: Record<string, string | undefined>): string {
  return env[RELEASE_ENV.candidate]?.trim() ?? '';
}

function prerequisiteFromEnv(env: Record<string, string | undefined>): boolean {
  return env[RELEASE_ENV.prerequisite]?.trim().toLowerCase() === 'true';
}

/**
 * Playwright reporter that turns only explicitly tagged REQ cases into release
 * evidence. Ordinary runs never become release approvals by accident.
 */
export class AcceptanceReporter implements Reporter {
  private readonly cases = new Map<string, CollectedCase>();
  private unexpectedSkips = 0;
  private mappingErrors = 0;
  private readonly environment: Record<string, string | undefined>;
  private readonly requestedPhase: ReleasePhase | undefined;
  private readonly invalidPhase: boolean;

  constructor(options: { environment?: Record<string, string | undefined> } = {}) {
    this.environment = options.environment ?? process.env;
    const rawPhase = this.environment[RELEASE_ENV.phase]?.trim();
    this.requestedPhase = parseReleasePhase(rawPhase);
    this.invalidPhase = rawPhase !== undefined && rawPhase !== '' && !this.requestedPhase;
  }

  onBegin(_config: FullConfig, _suite: unknown): void {
    // Collection occurs in onTestEnd; no setup or prerequisite is synthesized here.
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const rawTest = test as RawTest;
    const parts = testParts(rawTest);
    const tags = explicitTags(parts);
    const ids = explicitIds(parts);
    const status = resultStatus(result);
    if (status === 'skipped') this.unexpectedSkips += 1;
    if (ids.length === 0) return;
    if (ids.length > 1) this.mappingErrors += 1;

    const candidate = candidateFromEnv(this.environment);
    const taggedCandidate = candidateTag(tags);
    const modeResult = modeFor(tags);
    for (const id of ids) {
      const transportResult = transportFor(id, tags);
      const testKey = `${String((test as { id?: string }).id ?? parts.join(' > '))}\u0000${id}`;
      const existing = this.cases.get(testKey);
      if (existing) {
        existing.statuses.push(status);
        if (taggedCandidate !== undefined && taggedCandidate !== candidate) this.mappingErrors += 1;
        continue;
      }
      this.cases.set(testKey, {
        id,
        ac: acFor(tags),
        transport: transportResult.transport,
        mode: modeResult.mode,
        candidate: taggedCandidate ?? candidate,
        candidateProof: { candidate: taggedCandidate ?? candidate },
        transportProof: { candidate: taggedCandidate ?? candidate, transport: transportResult.transport },
        prerequisite: prerequisiteFromEnv(this.environment),
        statuses: [status],
      });
      if (!transportResult.explicit || !modeResult.explicit) this.mappingErrors += 1;
      if (taggedCandidate !== undefined && taggedCandidate !== candidate) this.mappingErrors += 1;
    }
  }

  private makeReport(): AdmissionReport {
    const evidence: CaseEvidence[] = [];
    for (const item of this.cases.values()) {
      const status = aggregateStatus(item.statuses);
      evidence.push({
        id: item.id,
        ac: item.ac,
        transport: item.transport,
        mode: item.mode,
        status,
        candidate: item.candidate,
        candidateProof: item.candidateProof,
        transportProof: item.transportProof,
        prerequisite: item.prerequisite,
        attempts: item.statuses.length,
      });
    }
    return {
      collected: evidence.length,
      cases: evidence,
      unexpectedSkips: this.unexpectedSkips,
      candidate: candidateFromEnv(this.environment),
      // Mapping errors are intentionally part of the report, not a console-only warning.
      mappingErrors: this.mappingErrors,
    } as AdmissionReport;
  }

  private writeReport(report: AdmissionReport, decision: ReturnType<typeof evaluateAdmission>): boolean {
    const reportPath = this.environment[RELEASE_ENV.reportPath]?.trim();
    if (!reportPath) return true;
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(
        reportPath,
        JSON.stringify(
          {
            phase: decision.phase,
            candidate: decision.candidate,
            counts: decision.counts,
            expectedIds: decision.expectedIds,
            report,
            admission: { status: decision.status, reasons: decision.reasons },
          },
          null,
          2
        ) + '\n',
        'utf8'
      );
      return true;
    } catch {
      return false;
    }
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] }> {
    const rawPhase = this.environment[RELEASE_ENV.phase]?.trim();
    if (rawPhase === undefined || rawPhase === '') return { status: result.status };
    if (this.invalidPhase || !this.requestedPhase) return { status: 'failed' };

    const phase = this.requestedPhase;
    // Touching the manifest here ensures reporter behavior remains bound to the
    // selected cumulative phase, rather than to whichever tests happened to run.
    void REQUIRED_CASES_BY_PHASE[phase];
    const initialReport = this.makeReport();
    const baseDecision = evaluateAdmission({
      phase,
      candidate: candidateFromEnv(this.environment),
      prerequisite: prerequisiteFromEnv(this.environment),
      report: initialReport,
      externalReceipts: loadExternalReceiptsFromEnv(this.environment),
    });
    const completeReport = {
      ...initialReport,
      expected: baseDecision.counts.expected,
      executed: baseDecision.counts.executed,
      passed: baseDecision.counts.passed,
      failed: baseDecision.counts.failed,
      skipped: baseDecision.counts.skipped,
      notRun: baseDecision.counts.notRun,
      missing: baseDecision.counts.missing,
    } as AdmissionReport;
    const decision = evaluateAdmission({
      phase,
      candidate: candidateFromEnv(this.environment),
      prerequisite: prerequisiteFromEnv(this.environment),
      report: completeReport,
      externalReceipts: loadExternalReceiptsFromEnv(this.environment),
    });
    const reportWritten = this.writeReport(completeReport, decision);
    // Never print titles, attachments, error messages, URLs, tokens, or receipt content.
    console.error('Release admission:', JSON.stringify({
      phase,
      status: reportWritten ? decision.status : 'failed',
      counts: decision.counts,
      reasons: reportWritten ? decision.reasons : ['reportwritefailed'],
    }));
    if (!reportWritten || !decision.ok) {
      return { status: 'failed' };
    }
    return { status: result.status };
  }
}

export default AcceptanceReporter;
