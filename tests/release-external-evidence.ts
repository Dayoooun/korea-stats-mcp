import { createHash } from "node:crypto";
import fs from "node:fs";
import type { ReleasePhase } from "./requiredCases";

export const RECEIPT_MAX_BYTES = 1_048_576;
export const EVIDENCE_MAX_BYTES = 10_485_760;

export interface ExternalReceiptContext {
  readonly phase: ReleasePhase;
  readonly candidate: string;
  /** The configured HTTP endpoint used by the MCP client receipt, when available. */
  readonly targetUrl?: string;
}

export type ExternalEvidenceValidation =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };
type ExternalEvidenceFailure = Extract<
  ExternalEvidenceValidation,
  { readonly ok: false }
>;
type ExternalEvidenceSuccess = Extract<
  ExternalEvidenceValidation,
  { readonly ok: true }
>;

interface ReceiptEnvelope {
  readonly kind: string;
  readonly id: string;
  readonly phase: ReleasePhase;
  readonly candidate: string;
  readonly caseIds: readonly string[];
  readonly status: "passed";
  readonly version: "2.0.0";
  readonly observedAt: string;
  readonly attempts: number;
}

type JsonRecord = Record<string, unknown>;

function failure(condition: string): ExternalEvidenceFailure {
  return {
    ok: false,
    reason: `external evidence condition failed: ${condition}`,
  };
}

function success(): ExternalEvidenceSuccess {
  return { ok: true };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isValidationFailure(value: unknown): value is ExternalEvidenceFailure {
  return (
    isRecord(value) && value.ok === false && typeof value.reason === "string"
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function observedTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function readBoundedJson(filePath: string): unknown | ExternalEvidenceFailure {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > RECEIPT_MAX_BYTES) {
      return failure("receipt file is missing, not regular, or exceeds 1 MiB");
    }
    const bytes = fs.readFileSync(filePath);
    if (bytes.byteLength > RECEIPT_MAX_BYTES)
      return failure("receipt exceeds 1 MiB");
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return failure("receipt cannot be read as bounded JSON");
  }
}

function readEvidenceDigest(
  filePath: unknown,
): string | ExternalEvidenceFailure {
  if (!nonEmptyString(filePath)) return failure("evidenceRef is non-empty");
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > EVIDENCE_MAX_BYTES) {
      return failure(
        "evidence file is missing, not regular, or exceeds 10 MiB",
      );
    }
    const bytes = fs.readFileSync(filePath);
    if (bytes.byteLength > EVIDENCE_MAX_BYTES)
      return failure("evidence exceeds 10 MiB");
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return failure("evidenceRef does not identify an existing bounded file");
  }
}

function validateEnvelope(
  value: unknown,
  expectedKind: string,
  expectedCaseIds: readonly string[],
  context: ExternalReceiptContext,
): ReceiptEnvelope | ExternalEvidenceFailure {
  if (!isRecord(value)) return failure("receipt envelope is an object");
  if (value.kind !== expectedKind)
    return failure("receipt kind matches the contract");

  const id = value.id;
  if (!nonEmptyString(id) || id === expectedCaseIds[0]) {
    return failure("receipt id is a unique non-empty identifier");
  }

  if (value.phase !== context.phase)
    return failure("receipt phase matches the explicit release phase");
  if (value.candidate !== context.candidate)
    return failure("receipt candidate matches the release candidate");
  if (
    !Array.isArray(value.caseIds) ||
    value.caseIds.length !== expectedCaseIds.length ||
    value.caseIds.some(
      (item, index) =>
        typeof item !== "string" || item !== expectedCaseIds[index],
    )
  ) {
    return failure("receipt caseIds exactly match the required case");
  }
  if (value.status !== "passed") return failure("receipt status is passed");
  if (value.version !== "2.0.0") return failure("receipt version is 2.0.0");

  const observedAt = value.observedAt;
  if (!observedTimestamp(observedAt))
    return failure("receipt observedAt is a parseable timestamp");

  const attempts = value.attempts;
  if (
    typeof attempts !== "number" ||
    !Number.isInteger(attempts) ||
    attempts <= 0
  ) {
    return failure("receipt attempts is a positive integer");
  }

  return {
    kind: expectedKind,
    id,
    phase: context.phase,
    candidate: context.candidate,
    caseIds: expectedCaseIds,
    status: "passed",
    version: "2.0.0",
    observedAt,
    attempts,
  };
}

function metadata(value: unknown): JsonRecord | ExternalEvidenceFailure {
  if (!isRecord(value) || isValidationFailure(value)) {
    return failure("receipt metadata is an object");
  }
  return value;
}

function validateEvidenceFields(
  receipt: JsonRecord,
): ExternalEvidenceValidation {
  if (!nonEmptyString(receipt.operatorVerificationRef)) {
    return failure("operatorVerificationRef is non-empty");
  }
  if (!/^[a-f0-9]{64}$/.test(String(receipt.sha256 ?? ""))) {
    return failure("sha256 is a lowercase SHA-256 digest");
  }
  const digest = readEvidenceDigest(receipt.evidenceRef);
  if (typeof digest !== "string") return digest;
  if (digest !== receipt.sha256)
    return failure("sha256 matches the existing evidence file");
  return success();
}

function validateS04Substantive(
  receipt: JsonRecord,
): ExternalEvidenceValidation {
  const details = metadata(receipt.metadata);
  if (isValidationFailure(details)) return details;
  if (!isRecord(details)) return failure("receipt metadata is an object");
  if (details.provider !== "KOSIS") return failure("S04 provider is KOSIS");
  if (
    !nonEmptyString(details.keyReference) ||
    String(details.keyReference).length > 256
  ) {
    return failure("S04 keyReference is an opaque non-empty reference");
  }
  if (
    details.oldKeyStatus !== "revoked" &&
    details.oldKeyStatus !== "inactive"
  ) {
    return failure("S04 oldKeyStatus is revoked or inactive");
  }
  if (
    details.exposureDisposition !== "revoked" &&
    details.exposureDisposition !== "replaced"
  ) {
    return failure("S04 exposureDisposition is revoked or replaced");
  }
  if (!observedTimestamp(details.verifiedAt))
    return failure("S04 verifiedAt is a parseable timestamp");

  const action = receipt.action;
  if (action === "revoked") return success();
  if (action !== "confirmed")
    return failure("S04 action is revoked or confirmed");
  if (details.resolutionStatus !== "confirmed-resolved") {
    return failure("confirmed S04 action has confirmed-resolved status");
  }
  return success();
}

function validateHttpTarget(
  value: unknown,
  expectedUrl: string | undefined,
): string | ExternalEvidenceValidation {
  if (!nonEmptyString(value)) return failure("M06 target URL is non-empty");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return failure("M06 target URL is an HTTP URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    return failure("M06 target URL has no credentials");
  }
  if (parsed.search || parsed.hash)
    return failure("M06 target URL has no query key or fragment");
  if (expectedUrl !== undefined && value !== expectedUrl) {
    return failure("M06 target URL matches the configured HTTP target");
  }
  return value;
}

function validateConnectionAttempts(
  details: JsonRecord,
  context: ExternalReceiptContext,
): ExternalEvidenceValidation {
  if (
    !Array.isArray(details.connectionAttempts) ||
    details.connectionAttempts.length < 3
  ) {
    return failure("M06 has at least three connection attempts");
  }
  const target = validateHttpTarget(details.targetUrl, context.targetUrl);
  if (typeof target !== "string") return target;
  for (const attempt of details.connectionAttempts) {
    if (!isRecord(attempt) || attempt.success !== true) {
      return failure("M06 every connection attempt succeeds");
    }
    if (attempt.candidate !== context.candidate || attempt.url !== target) {
      return failure(
        "M06 every connection attempt binds candidate and target URL",
      );
    }
    if (!observedTimestamp(attempt.observedAt)) {
      return failure("M06 every connection attempt has observedAt");
    }
  }
  return success();
}

function cursorShape(value: unknown): value is string {
  return (
    nonEmptyString(value) &&
    /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(value)
  );
}

function validateMetadataTraversal(
  details: JsonRecord,
): ExternalEvidenceValidation {
  const traversal = metadata(details.metadataTraversal);
  if (isValidationFailure(traversal)) return traversal;
  if (!isRecord(traversal))
    return failure("M06 metadataTraversal is an object");
  if (
    !Number.isInteger(traversal.pageCount) ||
    Number(traversal.pageCount) < 10
  ) {
    return failure("M06 metadataTraversal pageCount is at least 10");
  }
  if (!Array.isArray(traversal.pages) || traversal.pages.length < 10) {
    return failure("M06 metadataTraversal has at least 10 page identities");
  }
  const identities = new Set<string>();
  const cursors = new Set<string>();
  for (const page of traversal.pages) {
    if (
      !isRecord(page) ||
      !nonEmptyString(page.identity) ||
      identities.has(page.identity)
    ) {
      return failure(
        "M06 metadataTraversal page identities are actual and unique",
      );
    }
    if (!cursorShape(page.cursorProgress)) {
      return failure(
        "M06 metadataTraversal cursorProgress is an opaque progressed cursor",
      );
    }
    if (!Number.isInteger(page.count) || Number(page.count) <= 0) {
      return failure("M06 metadataTraversal page counts are positive");
    }
    identities.add(page.identity);
    cursors.add(page.cursorProgress);
  }
  if (cursors.size < 10 || identities.size < 10) {
    return failure(
      "M06 metadataTraversal contains at least 10 distinct progress points",
    );
  }
  return success();
}

function validateFollowup(details: JsonRecord): ExternalEvidenceValidation {
  const followup = metadata(details.followupData);
  if (isValidationFailure(followup)) return followup;
  if (!isRecord(followup)) return failure("M06 followupData is an object");
  if (followup.success !== true || followup.metadataDerived !== true) {
    return failure("M06 followupData is successful and metadata-derived");
  }
  if (!nonEmptyString(followup.sourceIdentity)) {
    return failure("M06 followupData has a source identity reference");
  }
  if (!nonEmptyString(followup.query) && !isRecord(followup.query)) {
    return failure("M06 followupData has a query reference");
  }
  return success();
}

function validateProtocolErrors(
  details: JsonRecord,
): ExternalEvidenceValidation {
  const errors = metadata(details.protocolErrors);
  if (isValidationFailure(errors)) return errors;
  if (!isRecord(errors)) return failure("M06 protocolErrors is an object");
  for (const key of [
    "reinitializations",
    "terminations",
    "jsonErrors",
  ] as const) {
    if (!Number.isInteger(errors[key]) || Number(errors[key]) !== 0) {
      return failure("M06 protocolErrors are all zero");
    }
  }
  return success();
}

/** Validate the explicit offline/online contract for the S04 key-revocation receipt. */
export function validateS04ReceiptFile(
  receiptPath: string,
  context: ExternalReceiptContext,
): ExternalEvidenceValidation {
  const raw = readBoundedJson(receiptPath);
  if (isValidationFailure(raw)) return raw;
  if (!isRecord(raw)) return failure("receipt envelope is an object");
  const envelope = validateEnvelope(
    raw,
    "key-revocation",
    ["REQ-S04"],
    context,
  );
  if (isValidationFailure(envelope)) return envelope;
  if (!isRecord(envelope)) return failure("receipt envelope is an object");
  const evidence = validateEvidenceFields(raw);
  if (!evidence.ok) return evidence;
  return validateS04Substantive(raw);
}

/** Validate the explicit offline/online contract for the M06 MCP client receipt. */
function validateM06Client(
  value: unknown,
  context: ExternalReceiptContext,
  seenNames: Set<string>,
): ExternalEvidenceValidation {
  if (!isRecord(value)) return failure("M06 metadata clients are objects");

  const clientName = value.clientName;
  if (
    typeof clientName !== "string" ||
    (clientName !== "Claude Code" && clientName !== "Codex") ||
    seenNames.has(clientName)
  ) {
    return failure(
      "M06 metadata identifies distinct Claude Code and Codex clients",
    );
  }
  seenNames.add(clientName);

  if (!nonEmptyString(value.clientVersion)) {
    return failure("M06 metadata clients have a client version");
  }

  const connection = validateConnectionAttempts(value, context);
  if (!connection.ok) return connection;
  const traversal = validateMetadataTraversal(value);
  if (!traversal.ok) return traversal;
  const followup = validateFollowup(value);
  if (!followup.ok) return followup;
  return validateProtocolErrors(value);
}

export function validateM06Receipt(
  raw: unknown,
  context: ExternalReceiptContext,
): ExternalEvidenceValidation {
  if (!isRecord(raw)) return failure("receipt envelope is an object");
  const envelope = validateEnvelope(raw, "mcp-clients", ["REQ-M06"], context);
  if (isValidationFailure(envelope)) return envelope;
  if (!isRecord(envelope)) return failure("receipt envelope is an object");
  const evidence = validateEvidenceFields(raw);
  if (!evidence.ok) return evidence;
  const details = metadata(raw.metadata);
  if (isValidationFailure(details)) return details;
  if (!isRecord(details)) return failure("receipt metadata is an object");
  if (
    Object.keys(details).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(details, "clients")
  ) {
    return failure("M06 metadata contains only the clients collection");
  }

  if (!Array.isArray(details.clients) || details.clients.length !== 2) {
    return failure("M06 metadata has exactly two clients");
  }

  const seenNames = new Set<string>();
  for (const client of details.clients) {
    const validation = validateM06Client(client, context, seenNames);
    if (!validation.ok) return validation;
  }

  if (seenNames.size !== 2) {
    return failure("M06 metadata identifies Claude Code and Codex clients");
  }
  return success();
}

export function validateM06ReceiptFile(
  receiptPath: string,
  context: ExternalReceiptContext,
): ExternalEvidenceValidation {
  const raw = readBoundedJson(receiptPath);
  if (isValidationFailure(raw)) return raw;
  return validateM06Receipt(raw, context);
}

export function assertS04ReceiptFile(
  receiptPath: string,
  context: ExternalReceiptContext,
): void {
  const result = validateS04ReceiptFile(receiptPath, context);
  if (!result.ok)
    throw new Error(result.reason ?? "S04 external evidence failed");
}

export function assertM06ReceiptFile(
  receiptPath: string,
  context: ExternalReceiptContext,
): void {
  const result = validateM06ReceiptFile(receiptPath, context);
  if (!result.ok)
    throw new Error(result.reason ?? "M06 external evidence failed");
}
