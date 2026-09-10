import fs from "node:fs";
import { validateM06Receipt } from "./release-external-evidence.ts";

export const RELEASE_PHASES = ["R1", "R2", "R3"] as const;
export type ReleasePhase = (typeof RELEASE_PHASES)[number];
export type CaseStatus = "passed" | "failed" | "skipped" | "notRun";
export type Transport = "stdio" | "http" | "both";
export type TransportContract = Transport | "agnostic";
export type Mode = "offline" | "live";
export type ModeContract = Mode | "either";
export type ReceiptKind =
  "live" | "mcpClients" | "keyRevocation" | "pack" | "deploy";

export const RELEASE_ENV = Object.freeze({
  phase: "KOREA_STATS_RELEASE_PHASE",
  candidate: "KOREA_STATS_RELEASE_CANDIDATE",
  prerequisite: "KOREA_STATS_RELEASE_PREREQUISITE",
  reportPath: "KOREA_STATS_ADMISSION_REPORT_PATH",
  liveReceipt: "KOREA_STATS_LIVE_RECEIPT_PATH",
  mcpClientsReceipt: "KOREA_STATS_MCP_CLIENTS_RECEIPT_PATH",
  keyRevocationReceipt: "KOREA_STATS_KEY_REVOCATION_RECEIPT_PATH",
  packReceipt: "KOREA_STATS_PACK_RECEIPT_PATH",
  deployReceipt: "KOREA_STATS_DEPLOY_RECEIPT_PATH",
} as const);

export interface RequiredCase {
  readonly id: string;
  /** Release in which this case was introduced; phase manifests are cumulative. */
  readonly release: ReleasePhase;
  /** Acceptance criteria covered by this case (AC13 is applied by the evaluator). */
  readonly ac: readonly string[];
  readonly transport: TransportContract;
  readonly mode: ModeContract;
}

export interface TransportProof {
  readonly candidate: string;
  readonly transport: Transport;
}

export interface CaseEvidence {
  readonly id: string;
  readonly ac: readonly string[] | string;
  readonly transport: Transport;
  readonly mode: Mode;
  readonly status: CaseStatus;
  readonly candidate: string;
  readonly candidateProof?: { readonly candidate: string };
  readonly transportProof?: TransportProof;
  readonly prerequisite?: boolean;
  readonly attempts?: number;
}

export interface AdmissionReport {
  readonly collected: number;
  readonly cases: readonly CaseEvidence[];
  readonly unexpectedSkips: number;
  readonly candidate?: string;
  readonly expected?: number;
  readonly executed?: number;
  readonly passed?: number;
  readonly failed?: number;
  readonly skipped?: number;
  readonly notRun?: number;
  readonly missing?: number;
  readonly mappingErrors?: number;
}

export interface ExternalReceipt {
  readonly kind: string;
  readonly id: string;
  readonly phase: ReleasePhase;
  readonly candidate: string;
  readonly caseIds: readonly string[];
  readonly status: "passed";
  readonly version?: string;
  readonly url?: string;
  readonly observedAt?: string;
  readonly attempts?: number;
  readonly artifact?: string;
  readonly action?: string;
  readonly metadata?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface AdmissionInput {
  readonly phase: ReleasePhase;
  readonly candidate: string;
  readonly prerequisite: boolean;
  readonly report?: AdmissionReport | null;
  readonly externalReceipts?: Partial<Record<ReceiptKind, unknown>>;
}

export interface AdmissionCounts {
  readonly expected: number;
  readonly collected: number;
  readonly executed: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly notRun: number;
  readonly missing: number;
  readonly unexpectedSkips: number;
}

export interface AdmissionDecision {
  readonly ok: boolean;
  readonly status: "passed" | "failed";
  readonly phase: ReleasePhase;
  readonly candidate: string;
  readonly expectedIds: readonly string[];
  readonly counts: AdmissionCounts;
  readonly requiredReceiptKinds: readonly ReceiptKind[];
  readonly reasons: readonly string[];
}

const c = (
  id: string,
  release: ReleasePhase,
  ac: readonly string[],
  transport: TransportContract,
  mode: ModeContract,
): RequiredCase =>
  Object.freeze({ id, release, ac: Object.freeze([...ac]), transport, mode });

/* This is the release contract. Do not derive it from collected test output. */
export const ALL_REQUIRED_CASES: readonly RequiredCase[] = Object.freeze([
  c("REQ-H01", "R1", ["AC13"], "agnostic", "offline"),
  c("REQ-H02", "R1", ["AC13"], "agnostic", "live"),
  c("REQ-H03", "R1", ["AC13"], "agnostic", "offline"),
  c("REQ-H04", "R1", ["AC13"], "agnostic", "offline"),
  c("REQ-S01", "R1", ["AC10"], "agnostic", "offline"),
  c("REQ-S02", "R1", ["AC10"], "agnostic", "offline"),
  c("REQ-S03.stdio", "R1", ["AC10"], "stdio", "live"),
  c("REQ-S03.http", "R1", ["AC10"], "http", "live"),
  c("REQ-S04", "R1", ["AC10"], "agnostic", "live"),
  c("REQ-T01.stdio", "R1", ["AC9"], "stdio", "live"),
  c("REQ-T01.http", "R1", ["AC9"], "http", "live"),
  c("REQ-T02", "R1", ["AC12"], "http", "live"),

  c("REQ-M01", "R2", ["AC11"], "both", "live"),
  c("REQ-M02.stdio", "R2", ["AC11"], "stdio", "live"),
  c("REQ-M02.http", "R2", ["AC11"], "http", "live"),
  c("REQ-M03.stdio", "R2", ["AC11"], "stdio", "live"),
  c("REQ-M03.http", "R2", ["AC11"], "http", "live"),
  c("REQ-M04.stdio", "R2", ["AC1", "AC2", "AC8", "AC11"], "stdio", "live"),
  c("REQ-M04.http", "R2", ["AC1", "AC2", "AC8", "AC11"], "http", "live"),
  c("REQ-M05", "R2", ["AC12"], "http", "live"),
  c("REQ-M06", "R2", ["AC11"], "http", "live"),
  c("REQ-M07", "R2", ["AC2", "AC11"], "agnostic", "offline"),
  c("REQ-Q01", "R2", ["AC3"], "agnostic", "either"),
  c("REQ-Q02", "R2", ["AC4"], "agnostic", "either"),
  c("REQ-G01.stdio", "R2", ["AC1", "AC8"], "stdio", "live"),
  c("REQ-G01.http", "R2", ["AC1", "AC8"], "http", "live"),
  c("REQ-G02.stdio", "R2", ["AC1", "AC8"], "stdio", "live"),
  c("REQ-G02.http", "R2", ["AC1", "AC8"], "http", "live"),
  c("REQ-G03.stdio", "R2", ["AC1", "AC8"], "stdio", "live"),
  c("REQ-G03.http", "R2", ["AC1", "AC8"], "http", "live"),
  c("REQ-G04.stdio", "R2", ["AC1", "AC9"], "stdio", "live"),
  c("REQ-G04.http", "R2", ["AC1", "AC9"], "http", "live"),
  c("REQ-Q03.stdio", "R2", ["AC8", "AC9"], "stdio", "live"),
  c("REQ-Q03.http", "R2", ["AC8", "AC9"], "http", "live"),

  c("REQ-I01.stdio", "R3", ["AC5", "AC8"], "stdio", "live"),
  c("REQ-I01.http", "R3", ["AC5", "AC8"], "http", "live"),
  c("REQ-I02.stdio", "R3", ["AC5", "AC8"], "stdio", "live"),
  c("REQ-I02.http", "R3", ["AC5", "AC8"], "http", "live"),
  c("REQ-D01.stdio", "R3", ["AC7", "AC8"], "stdio", "live"),
  c("REQ-D01.http", "R3", ["AC7", "AC8"], "http", "live"),
  c("REQ-D02.stdio", "R3", ["AC7", "AC8"], "stdio", "live"),
  c("REQ-D02.http", "R3", ["AC7", "AC8"], "http", "live"),
  c("REQ-D03.stdio", "R3", ["AC6", "AC8"], "stdio", "live"),
  c("REQ-D03.http", "R3", ["AC6", "AC8"], "http", "live"),
  c("REQ-D04.stdio", "R3", ["AC6", "AC10"], "stdio", "live"),
  c("REQ-D04.http", "R3", ["AC6", "AC10"], "http", "live"),
  c("REQ-O01.stdio", "R3", ["AC9", "AC10", "AC13"], "stdio", "live"),
  c("REQ-O01.http", "R3", ["AC9", "AC10", "AC13"], "http", "live"),
]);

const phaseIndex = (phase: ReleasePhase): number =>
  RELEASE_PHASES.indexOf(phase);

export const REQUIRED_CASES_BY_PHASE: Readonly<
  Record<ReleasePhase, readonly RequiredCase[]>
> = Object.freeze(
  Object.fromEntries(
    RELEASE_PHASES.map((phase) => [
      phase,
      Object.freeze(
        ALL_REQUIRED_CASES.filter(
          (item) => phaseIndex(item.release) <= phaseIndex(phase),
        ),
      ),
    ]),
  ) as Record<ReleasePhase, readonly RequiredCase[]>,
);

/** Compatibility-friendly aliases for consumers that want the phase manifest directly. */
export const REQUIRED_CASES = REQUIRED_CASES_BY_PHASE;
export const PHASE_CASES = REQUIRED_CASES_BY_PHASE;
export const REQUIRED_CASE_IDS: Readonly<
  Record<ReleasePhase, readonly string[]>
> = Object.freeze({
  R1: REQUIRED_CASES_BY_PHASE.R1.map((item) => item.id),
  R2: REQUIRED_CASES_BY_PHASE.R2.map((item) => item.id),
  R3: REQUIRED_CASES_BY_PHASE.R3.map((item) => item.id),
});

export function parseReleasePhase(value: unknown): ReleasePhase | undefined {
  return typeof value === "string" &&
    (RELEASE_PHASES as readonly string[]).includes(value)
    ? (value as ReleasePhase)
    : undefined;
}

const receiptEnvNames: Record<ReceiptKind, string> = {
  live: RELEASE_ENV.liveReceipt,
  mcpClients: RELEASE_ENV.mcpClientsReceipt,
  keyRevocation: RELEASE_ENV.keyRevocationReceipt,
  pack: RELEASE_ENV.packReceipt,
  deploy: RELEASE_ENV.deployReceipt,
};

const receiptTypeNames: Record<ReceiptKind, string> = {
  live: "live",
  mcpClients: "mcp-clients",
  keyRevocation: "key-revocation",
  pack: "pack",
  deploy: "deploy",
};

export function requiredReceiptKinds(
  phase: ReleasePhase,
): readonly ReceiptKind[] {
  const cases = REQUIRED_CASES_BY_PHASE[phase];
  if (!cases) return [];
  const kinds: ReceiptKind[] = [];
  if (cases.some((item) => item.mode === "live")) kinds.push("live");
  if (phaseIndex(phase) >= phaseIndex("R2")) kinds.push("mcpClients");
  if (cases.some((item) => item.id === "REQ-S04")) kinds.push("keyRevocation");
  if (cases.some((item) => item.id.startsWith("REQ-S03."))) kinds.push("pack");
  if (cases.some((item) => item.id === "REQ-T02")) kinds.push("deploy");
  return kinds;
}

/** Read only explicitly configured JSON receipts. Missing files stay missing; nothing is synthesized. */
export function loadExternalReceiptsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Partial<Record<ReceiptKind, unknown>> {
  const receipts: Partial<Record<ReceiptKind, unknown>> = {};
  for (const kind of Object.keys(receiptEnvNames) as ReceiptKind[]) {
    const file = env[receiptEnvNames[kind]]?.trim();
    if (!file) continue;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      receipts[kind] = parsed;
    } catch (error) {
      // Keep markers only; paths and receipt content never enter diagnostics.
      receipts[kind] =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? { __missingReceipt: true }
          : { __invalidReceipt: true };
    }
  }
  return receipts;
}

const asAcSet = (ac: readonly string[] | string): Set<string> => {
  if (typeof ac === "string")
    return new Set(ac.split(/[\s,\/]+/).filter(Boolean));
  return new Set(ac);
};

const isTransport = (value: unknown): value is Transport =>
  value === "stdio" || value === "http" || value === "both";

const isMode = (value: unknown): value is Mode =>
  value === "offline" || value === "live";

function receiptValue(receipt: Record<string, unknown>, name: string): unknown {
  if (receipt[name] !== undefined) return receipt[name];
  const metadata = receipt.metadata;
  return metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)[name]
    : undefined;
}

function receiptHasRequiredMetadata(
  kind: ReceiptKind,
  receipt: Record<string, unknown>,
): boolean {
  const required = [
    "id",
    "phase",
    "candidate",
    "caseIds",
    "status",
    "observedAt",
    "version",
    "attempts",
  ];
  if (kind === "pack") required.push("artifact");
  if (kind === "keyRevocation") required.push("action");
  if (kind === "live" || kind === "deploy") required.push("url");
  return required.every((name) => {
    const value = receiptValue(receipt, name);
    if (name === "attempts")
      return Number.isInteger(value) && Number(value) > 0;
    if (name === "caseIds") return Array.isArray(value) && value.length > 0;
    return typeof value === "string" && value.trim().length > 0;
  });
}

function validateReceipt(
  kind: ReceiptKind,
  raw: unknown,
  phase: ReleasePhase,
  candidate: string,
  expectedIds: ReadonlySet<string>,
): string | undefined {
  if (raw === undefined || raw === null) return `missingexternalproof:${kind}`;
  if (typeof raw !== "object" || Array.isArray(raw))
    return `invalidexternalproof:${kind}`;
  if ((raw as Record<string, unknown>).__missingReceipt === true)
    return `missingexternalproof:${kind}`;
  const receipt = raw as Record<string, unknown>;
  if (receipt.__invalidReceipt === true) return `invalidexternalproof:${kind}`;
  if (!receiptHasRequiredMetadata(kind, receipt))
    return `missingexternalmetadata:${kind}`;
  if (receiptValue(receipt, "kind") !== receiptTypeNames[kind])
    return `wrongexternaltype:${kind}`;
  if (receiptValue(receipt, "phase") !== phase)
    return `wrongexternalphase:${kind}`;
  if (receiptValue(receipt, "candidate") !== candidate)
    return `wrongexternalcandidate:${kind}`;
  if (receiptValue(receipt, "status") !== "passed")
    return `failedexternalproof:${kind}`;
  if (kind === "keyRevocation") {
    const action = receiptValue(receipt, "action");
    if (action !== "revoked" && action !== "confirmed")
      return `invalidexternalaction:${kind}`;
  }
  const caseIds = receiptValue(receipt, "caseIds");
  if (
    !Array.isArray(caseIds) ||
    caseIds.some((id) => typeof id !== "string" || !expectedIds.has(id))
  ) {
    return `wrongexternalids:${kind}`;
  }
  if ([...expectedIds].some((id) => !caseIds.includes(id)))
    return `wrongexternalids:${kind}`;
  if (new Set(caseIds).size !== caseIds.length)
    return `wrongexternalids:${kind}`;
  if (kind === "mcpClients") {
    const validation = validateM06Receipt(receipt, { phase, candidate });
    if (!validation.ok) return validation.reason;
  }
  return undefined;
}

function externalReceiptCaseIds(
  kind: ReceiptKind,
  cases: readonly RequiredCase[],
): Set<string> {
  if (kind === "live")
    return new Set(
      cases.filter((item) => item.mode === "live").map((item) => item.id),
    );
  if (kind === "mcpClients") return new Set(["REQ-M06"]);
  if (kind === "keyRevocation") return new Set(["REQ-S04"]);
  if (kind === "pack") return new Set(["REQ-S03.stdio", "REQ-S03.http"]);
  return new Set(["REQ-T02"]);
}

function checkSummary(
  report: AdmissionReport,
  counts: AdmissionCounts,
  reasons: string[],
): void {
  const fields: (keyof AdmissionCounts)[] = [
    "expected",
    "collected",
    "executed",
    "passed",
    "failed",
    "skipped",
    "notRun",
    "missing",
    "unexpectedSkips",
  ];
  for (const field of fields) {
    const supplied = report[field];
    if (supplied !== undefined && supplied !== counts[field])
      reasons.push(`countmismatch:${field}`);
  }
}

/**
 * Pure, fail-closed admission check. It only evaluates supplied values and never
 * promotes an absent report, missing receipt, or absent prerequisite.
 */
export function evaluateAdmission(input: AdmissionInput): AdmissionDecision {
  const phase = input?.phase;
  const candidate =
    typeof input?.candidate === "string" ? input.candidate.trim() : "";
  const required = REQUIRED_CASES_BY_PHASE[phase];
  const reasons: string[] = [];

  if (!required) {
    return {
      ok: false,
      status: "failed",
      phase: phase as ReleasePhase,
      candidate,
      expectedIds: [],
      counts: {
        expected: 0,
        collected: 0,
        executed: 0,
        passed: 0,
        failed: 1,
        skipped: 0,
        notRun: 0,
        missing: 0,
        unexpectedSkips: 0,
      },
      requiredReceiptKinds: [],
      reasons: ["invalidphase"],
    };
  }

  const expectedIds = required.map((item) => item.id);
  const expectedSet = new Set(expectedIds);
  if (!candidate) reasons.push("missingcandidate");
  if (input?.prerequisite !== true) reasons.push("prerequisitefail");

  const report = input?.report;
  if (!report || typeof report !== "object") {
    reasons.push("missingreport");
  }

  const cases = report && Array.isArray(report.cases) ? report.cases : [];
  if (
    !report ||
    report.collected !== cases.length ||
    typeof report.collected !== "number"
  ) {
    reasons.push("reportcountinvalid");
  }
  if (report && report.collected === 0) reasons.push("0cases");
  if (report && typeof report.unexpectedSkips !== "number")
    reasons.push("missingunexpectedskipcount");
  if (report && report.unexpectedSkips !== 0) reasons.push("unexpectedskip");
  if (
    report &&
    report.mappingErrors !== undefined &&
    report.mappingErrors !== 0
  ) {
    reasons.push("mappingerror");
  }
  if (
    report &&
    report.candidate !== undefined &&
    report.candidate !== candidate
  ) {
    reasons.push("wrongcandidate");
  }

  const idCounts = new Map<string, number>();
  const statuses = new Set<CaseStatus>([
    "passed",
    "failed",
    "skipped",
    "notRun",
  ]);
  let executed = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let explicitNotRun = 0;
  for (const evidence of cases) {
    const id = evidence && typeof evidence.id === "string" ? evidence.id : "";
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    if (evidence && statuses.has(evidence.status)) {
      if (evidence.status === "passed") {
        passed += 1;
        executed += 1;
      } else if (evidence.status === "failed") {
        failed += 1;
        executed += 1;
      } else if (evidence.status === "skipped") {
        skipped += 1;
        executed += 1;
      } else {
        explicitNotRun += 1;
      }
    } else {
      failed += 1;
      executed += 1;
      reasons.push("invalidstatus");
    }
  }

  const duplicates = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicates.length > 0) reasons.push("duplicateID");
  const missing = expectedIds.filter((id) => !idCounts.has(id));
  const unexpected = [...idCounts.keys()].filter((id) => !expectedSet.has(id));
  if (missing.length > 0) reasons.push("missingID");
  if (unexpected.length > 0) reasons.push("unexpectedID");

  const notRun = explicitNotRun + missing.length;
  if (failed > 0) reasons.push("requiredfail");
  if (skipped > 0) reasons.push("requiredskip");
  if (notRun > 0) reasons.push("notRun");

  for (const evidence of cases) {
    if (!evidence || typeof evidence !== "object") continue;
    const expected = required.find((item) => item.id === evidence.id);
    if (!expected) continue;
    if (evidence.candidate !== candidate) reasons.push("wrongcandidate");
    if (
      !evidence.candidateProof ||
      evidence.candidateProof.candidate !== candidate
    ) {
      reasons.push("candidateproof");
    }
    if (!isTransport(evidence.transport)) {
      reasons.push("transportproof");
    } else if (
      !evidence.transportProof ||
      evidence.transportProof.candidate !== candidate ||
      evidence.transportProof.transport !== evidence.transport
    ) {
      reasons.push("transportproof");
    }
    if (!isMode(evidence.mode)) reasons.push("modecontract");
    else if (expected.mode !== "either" && expected.mode !== evidence.mode)
      reasons.push("modecontract");
    if (
      expected.transport !== "agnostic" &&
      evidence.transport !== expected.transport
    ) {
      reasons.push("transportcontract");
    }
    const actualAc = asAcSet(evidence.ac);
    if (expected.ac.some((ac) => !actualAc.has(ac))) reasons.push("ACcontract");
    if (evidence.prerequisite === false) reasons.push("prerequisitefail");
    if (
      evidence.attempts !== undefined &&
      (!Number.isInteger(evidence.attempts) || evidence.attempts < 1)
    ) {
      reasons.push("attempts");
    }
  }

  const counts: AdmissionCounts = {
    expected: required.length,
    collected: cases.length,
    executed,
    passed,
    failed,
    skipped,
    notRun,
    missing: missing.length,
    unexpectedSkips: report?.unexpectedSkips ?? 0,
  };
  if (report) checkSummary(report, counts, reasons);
  if (
    counts.expected !== counts.executed ||
    counts.expected !== counts.passed
  ) {
    reasons.push("countincomplete");
  }
  if (
    counts.failed !== 0 ||
    counts.skipped !== 0 ||
    counts.notRun !== 0 ||
    counts.missing !== 0
  ) {
    reasons.push("AC13");
  }

  const requiredKinds = requiredReceiptKinds(phase);
  const suppliedReceipts = input?.externalReceipts ?? {};
  for (const kind of requiredKinds) {
    const receipt = suppliedReceipts[kind];
    const receiptError = validateReceipt(
      kind,
      receipt,
      phase,
      candidate,
      externalReceiptCaseIds(kind, required),
    );
    if (receiptError) reasons.push(receiptError);
  }

  const uniqueReasons = [...new Set(reasons)];
  const ok = uniqueReasons.length === 0;
  return {
    ok,
    status: ok ? "passed" : "failed",
    phase,
    candidate,
    expectedIds,
    counts,
    requiredReceiptKinds: requiredKinds,
    reasons: uniqueReasons,
  };
}

export function evaluateAdmissionFromEnv(
  phase: ReleasePhase,
  candidate: string,
  prerequisite: boolean,
  report: AdmissionReport | null | undefined,
): AdmissionDecision {
  return evaluateAdmission({
    phase,
    candidate,
    prerequisite,
    report,
    externalReceipts: loadExternalReceiptsFromEnv(),
  });
}

export const RECEIPT_ENV_PATHS = Object.freeze(receiptEnvNames);
