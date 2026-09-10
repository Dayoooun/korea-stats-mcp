import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  ALL_REQUIRED_CASES,
  REQUIRED_CASE_IDS,
  RELEASE_ENV,
  evaluateAdmission,
  evaluateAdmissionFromEnv,
  requiredReceiptKinds,
} from "./requiredCases.ts";
import AcceptanceReporter from "./acceptanceReporter.ts";

const candidate = "candidate-test-001";

function receipt(kind, caseIds, phase = "R1") {
  const type =
    {
      keyRevocation: "key-revocation",
      mcpClients: "mcp-clients",
    }[kind] ?? kind;
  const value = {
    kind: type,
    id: `receipt-${kind}`,
    phase,
    candidate,
    caseIds,
    status: "passed",
    version: kind === "mcpClients" ? "2.0.0" : "1.2.0-test",
    observedAt: "2026-09-09T00:00:00+09:00",
    attempts: 1,
  };
  if (kind === "live" || kind === "deploy")
    value.url = "https://example.invalid/proof";
  if (kind === "pack") value.artifact = "package.tgz";
  if (kind === "keyRevocation") value.action = "revoked";
  return value;
}
function makeM06Client(clientName, targetUrl) {
  const pages = Array.from({ length: 10 }, (_, index) => ({
    identity: `ITM-admission-page-${index + 1}`,
    cursorProgress: `cursorpayload-${index + 1}.cursorsignature-${index + 1}`,
    count: 1,
  }));
  return {
    clientName,
    clientVersion: `${clientName.toLowerCase().replaceAll(" ", "-")}-fixture-1.0.0`,
    targetUrl,
    connectionAttempts: [1, 2, 3].map((attempt) => ({
      success: true,
      candidate,
      url: targetUrl,
      observedAt: `2026-09-09T12:00:0${attempt}.000Z`,
    })),
    metadataTraversal: {
      pageCount: pages.length,
      pages,
    },
    followupData: {
      success: true,
      metadataDerived: true,
      query: "fixture metadata query reference",
      sourceIdentity: "fixture-source-identity",
    },
    protocolErrors: {
      reinitializations: 0,
      terminations: 0,
      jsonErrors: 0,
    },
  };
}

function makeM06Fixture(phase, mutate = () => {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "korea-stats-admission-m06-"),
  );
  const evidencePath = path.join(directory, "manual-evidence.txt");
  const evidence = "synthetic admission M06 evidence\n";
  fs.writeFileSync(evidencePath, evidence);
  const sha256 = createHash("sha256").update(evidence).digest("hex");
  const targetUrl = "https://mcp-clients.example.invalid/mcp";
  const value = {
    kind: "mcp-clients",
    id: `receipt-mcpClients-${phase}`,
    phase,
    candidate,
    caseIds: ["REQ-M06"],
    status: "passed",
    version: "2.0.0",
    observedAt: "2026-09-09T12:00:00.000Z",
    attempts: 3,
    evidenceRef: evidencePath,
    sha256,
    operatorVerificationRef: "admission-operator-fixture",
    metadata: {
      clients: [
        makeM06Client("Claude Code", targetUrl),
        makeM06Client("Codex", targetUrl),
      ],
    },
  };
  mutate(value);
  return { directory, evidencePath, receipt: value };
}

function completePhase(phase, mcpClientsReceipt) {
  const cases = REQUIRED_CASE_IDS[phase].map((id) => {
    const contract = ALL_REQUIRED_CASES.find((item) => item.id === id);
    const transport =
      contract.transport === "agnostic" ? "both" : contract.transport;
    const mode = contract.mode === "either" ? "offline" : contract.mode;
    return {
      id,
      ac: contract.ac,
      transport,
      mode,
      status: "passed",
      candidate,
      candidateProof: { candidate },
      transportProof: { candidate, transport },
      prerequisite: true,
      attempts: 1,
    };
  });
  const liveIds = cases
    .filter((item) => item.mode === "live")
    .map((item) => item.id);
  const report = {
    expected: cases.length,
    collected: cases.length,
    executed: cases.length,
    passed: cases.length,
    failed: 0,
    skipped: 0,
    notRun: 0,
    missing: 0,
    unexpectedSkips: 0,
    cases,
  };
  return {
    phase,
    candidate,
    prerequisite: true,
    report,
    externalReceipts: {
      live: receipt("live", liveIds, phase),
      mcpClients: mcpClientsReceipt,
      keyRevocation: receipt("keyRevocation", ["REQ-S04"], phase),
      pack: receipt("pack", ["REQ-S03.stdio", "REQ-S03.http"], phase),
      deploy: receipt("deploy", ["REQ-T02"], phase),
    },
  };
}

function completeR1() {
  const cases = REQUIRED_CASE_IDS.R1.map((id) => {
    const contract = ALL_REQUIRED_CASES.find((item) => item.id === id);
    const transport =
      contract.transport === "agnostic" ? "both" : contract.transport;
    const mode = contract.mode === "either" ? "offline" : contract.mode;
    return {
      id,
      ac: contract.ac,
      transport,
      mode,
      status: "passed",
      candidate,
      candidateProof: { candidate },
      transportProof: { candidate, transport },
      prerequisite: true,
      attempts: 1,
    };
  });
  const liveIds = cases
    .filter((item) => item.mode === "live")
    .map((item) => item.id);
  const report = {
    expected: cases.length,
    collected: cases.length,
    executed: cases.length,
    passed: cases.length,
    failed: 0,
    skipped: 0,
    notRun: 0,
    missing: 0,
    unexpectedSkips: 0,
    cases,
  };
  return {
    phase: "R1",
    candidate,
    prerequisite: true,
    report,
    externalReceipts: {
      live: receipt("live", liveIds),
      keyRevocation: receipt("keyRevocation", ["REQ-S04"]),
      pack: receipt("pack", ["REQ-S03.stdio", "REQ-S03.http"]),
      deploy: receipt("deploy", ["REQ-T02"]),
    },
  };
}

function evaluateR1(change = (value) => value) {
  const input = completeR1();
  return evaluateAdmission(change(input));
}

test("manifest keeps the approved cumulative 12/34/48 case counts", () => {
  assert.equal(REQUIRED_CASE_IDS.R1.length, 12);
  assert.equal(REQUIRED_CASE_IDS.R2.length, 34);
  assert.equal(REQUIRED_CASE_IDS.R3.length, 48);
  assert.equal(new Set(REQUIRED_CASE_IDS.R3).size, 48);
  assert.deepEqual(requiredReceiptKinds("R1"), [
    "live",
    "keyRevocation",
    "pack",
    "deploy",
  ]);
});
test("R2/R3 accept canonical Claude Code and Codex receipts through generic admission", () => {
  for (const phase of ["R2", "R3"]) {
    const fixture = makeM06Fixture(phase);
    try {
      const decision = evaluateAdmission(completePhase(phase, fixture.receipt));
      assert.equal(decision.status, "passed", phase);
      assert.equal(decision.ok, true, phase);
      assert.equal(decision.counts.expected, phase === "R2" ? 34 : 48);
      assert.deepEqual(decision.requiredReceiptKinds, [
        "live",
        "mcpClients",
        "keyRevocation",
        "pack",
        "deploy",
      ]);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("M06 generic admission rejects missing Codex, duplicate clients, missing proof, hash mismatch, and fake receipts", () => {
  const malformed = [
    [
      "missing Codex",
      (value) => {
        value.metadata.clients = [value.metadata.clients[0]];
      },
    ],
    [
      "duplicate client",
      (value) => {
        value.metadata.clients = [
          value.metadata.clients[0],
          value.metadata.clients[0],
        ];
      },
    ],
    [
      "one client missing proof",
      (value) => {
        delete value.metadata.clients[1].followupData;
      },
    ],
    [
      "hash mismatch",
      (value) => {
        value.sha256 = "0".repeat(64);
      },
    ],
  ];
  for (const [label, mutate] of malformed) {
    const fixture = makeM06Fixture("R2", mutate);
    try {
      const decision = evaluateAdmission(completePhase("R2", fixture.receipt));
      assert.equal(decision.status, "failed", label);
      assert.equal(decision.ok, false, label);
      assert.ok(
        decision.reasons.some((reason) =>
          reason.startsWith("external evidence condition failed:"),
        ),
        label,
      );
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }

  const fake = completePhase("R2", receipt("mcpClients", ["REQ-M06"], "R2"));
  const fakeDecision = evaluateAdmission(fake);
  assert.equal(fakeDecision.status, "failed", "fake generic receipt");
  assert.equal(fakeDecision.ok, false, "fake generic receipt");
  assert.ok(
    fakeDecision.reasons.some((reason) =>
      reason.startsWith("external evidence condition failed:"),
    ),
    "fake generic receipt",
  );
});

test("evaluateAdmissionFromEnv applies strict M06 validation and restores environment", () => {
  const phase = "R2";
  const fixture = makeM06Fixture(phase);
  const input = completePhase(phase, fixture.receipt);
  const reportPath = path.join(fixture.directory, "admission-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(input.report));
  const receiptPaths = {
    live: RELEASE_ENV.liveReceipt,
    mcpClients: RELEASE_ENV.mcpClientsReceipt,
    keyRevocation: RELEASE_ENV.keyRevocationReceipt,
    pack: RELEASE_ENV.packReceipt,
    deploy: RELEASE_ENV.deployReceipt,
  };
  const envKeys = [
    RELEASE_ENV.phase,
    RELEASE_ENV.candidate,
    RELEASE_ENV.prerequisite,
    RELEASE_ENV.reportPath,
    ...Object.values(receiptPaths),
  ];
  const before = new Map(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env[RELEASE_ENV.phase] = phase;
    process.env[RELEASE_ENV.candidate] = candidate;
    process.env[RELEASE_ENV.prerequisite] = "true";
    process.env[RELEASE_ENV.reportPath] = reportPath;
    for (const [kind, envKey] of Object.entries(receiptPaths)) {
      const receiptPath = path.join(fixture.directory, `${kind}.json`);
      fs.writeFileSync(
        receiptPath,
        JSON.stringify(input.externalReceipts[kind]),
      );
      process.env[envKey] = receiptPath;
    }
    const decision = evaluateAdmissionFromEnv(
      phase,
      candidate,
      true,
      input.report,
    );
    assert.equal(decision.status, "passed");
    assert.equal(decision.ok, true);
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
  for (const [key, value] of before) {
    assert.equal(process.env[key], value, `restored ${key}`);
  }
});

test("a complete R1 caller-supplied fixture is accepted", () => {
  const decision = evaluateR1();
  assert.equal(decision.status, "passed");
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.counts, {
    expected: 12,
    collected: 12,
    executed: 12,
    passed: 12,
    failed: 0,
    skipped: 0,
    notRun: 0,
    missing: 0,
    unexpectedSkips: 0,
  });
});

test("five offline cases cannot satisfy the cumulative R1 gate", () => {
  const input = completeR1();
  const offlineIds = new Set([
    "REQ-H01",
    "REQ-H03",
    "REQ-H04",
    "REQ-S01",
    "REQ-S02",
  ]);
  const cases = input.report.cases.filter((item) => offlineIds.has(item.id));
  input.report = {
    ...input.report,
    cases,
    collected: cases.length,
    executed: cases.length,
    passed: cases.length,
    failed: 0,
    skipped: 0,
    notRun: 7,
    missing: 7,
  };
  input.externalReceipts = {};
  const decision = evaluateAdmission(input);
  assert.equal(decision.status, "failed");
  assert.equal(decision.ok, false);
  assert.ok(decision.reasons.includes("missingID"));
  assert.ok(decision.reasons.includes("countincomplete"));
  assert.ok(decision.reasons.includes("missingexternalproof:live"));
  assert.ok(decision.reasons.includes("missingexternalproof:keyRevocation"));
  assert.ok(decision.reasons.includes("missingexternalproof:pack"));
  assert.ok(decision.reasons.includes("missingexternalproof:deploy"));
  assert.equal(decision.counts.expected, 12);
  assert.equal(decision.counts.collected, 5);
  assert.equal(decision.counts.passed, 5);
  assert.equal(decision.counts.missing, 7);
});

test("missingID is fail-closed", () => {
  const decision = evaluateR1((input) => {
    input.report = {
      ...input.report,
      cases: input.report.cases.slice(1),
      collected: 11,
    };
    return input;
  });
  assert.equal(decision.status, "failed");
  assert.ok(decision.reasons.includes("missingID"));
});
test("unexpectedskip is fail-closed", () => {
  const decision = evaluateR1((input) => {
    input.report = { ...input.report, unexpectedSkips: 1 };
    return input;
  });
  assert.equal(decision.status, "failed");
  assert.ok(decision.reasons.includes("unexpectedskip"));
});

test("missing report is fail-closed", () => {
  const input = completeR1();
  input.report = undefined;
  const decision = evaluateAdmission(input);
  assert.equal(decision.status, "failed");
  assert.ok(decision.reasons.includes("missingreport"));
  assert.ok(decision.reasons.includes("reportcountinvalid"));
});

test("requiredskip is fail-closed", () => {
  const decision = evaluateR1((input) => {
    const cases = input.report.cases.map((item, index) =>
      index === 0 ? { ...item, status: "skipped" } : item,
    );
    input.report = { ...input.report, cases, passed: 11, skipped: 1 };
    return input;
  });
  assert.equal(decision.status, "failed");
  assert.ok(decision.reasons.includes("requiredskip"));
});

test("duplicateID cannot fill the expected count", () => {
  const decision = evaluateR1((input) => {
    const cases = [...input.report.cases.slice(0, -1), input.report.cases[0]];
    input.report = { ...input.report, cases };
    return input;
  });
  assert.equal(decision.status, "failed");
  assert.ok(decision.reasons.includes("duplicateID"));
  assert.ok(decision.reasons.includes("missingID"));
});

test("0cases is fail-closed", () => {
  const decision = evaluateR1((input) => {
    input.report = {
      ...input.report,
      cases: [],
      collected: 0,
      expected: 12,
      executed: 0,
      passed: 0,
      notRun: 12,
      missing: 12,
    };
    return input;
  });
  assert.equal(decision.status, "failed");
  assert.ok(decision.reasons.includes("0cases"));
});

test("prerequisitefail is fail-closed", () => {
  const decision = evaluateR1((input) => ({ ...input, prerequisite: false }));
  assert.equal(decision.status, "failed");
  assert.ok(decision.reasons.includes("prerequisitefail"));
});

test("wrongcandidate is fail-closed even when counts pass", () => {
  const decision = evaluateR1((input) => {
    const cases = input.report.cases.map((item, index) =>
      index === 0
        ? {
            ...item,
            candidate: "other-candidate",
            candidateProof: { candidate: "other-candidate" },
            transportProof: {
              ...item.transportProof,
              candidate: "other-candidate",
            },
          }
        : item,
    );
    input.report = { ...input.report, cases };
    return input;
  });
  assert.equal(decision.status, "failed");
  assert.ok(decision.reasons.includes("wrongcandidate"));
});

test("missingexternalproof is fail-closed and never synthesized", () => {
  const decision = evaluateR1((input) => {
    const { pack: _pack, ...externalReceipts } = input.externalReceipts;
    return { ...input, externalReceipts };
  });
  assert.equal(decision.status, "failed");
  assert.ok(decision.reasons.includes("missingexternalproof:pack"));
});

test("Playwright empty reporter options do not discard release environment settings", async () => {
  const priorPhase = process.env.KOREA_STATS_RELEASE_PHASE;
  const priorReportPath = process.env.KOREA_STATS_ADMISSION_REPORT_PATH;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "korea-stats-reporter-probe-"),
  );
  const reportPath = path.join(directory, "negative.json");
  process.env.KOREA_STATS_RELEASE_PHASE = "R1";
  process.env.KOREA_STATS_ADMISSION_REPORT_PATH = reportPath;
  try {
    const reporter = new AcceptanceReporter({});
    const verdict = await reporter.onEnd({ status: "passed" });
    assert.equal(verdict.status, "failed");
    assert.equal(fs.existsSync(reportPath), true);
  } finally {
    if (priorPhase === undefined) delete process.env.KOREA_STATS_RELEASE_PHASE;
    else process.env.KOREA_STATS_RELEASE_PHASE = priorPhase;
    if (priorReportPath === undefined)
      delete process.env.KOREA_STATS_ADMISSION_REPORT_PATH;
    else process.env.KOREA_STATS_ADMISSION_REPORT_PATH = priorReportPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ordinary reporter invocation does not claim release admission", async () => {
  const reporter = new AcceptanceReporter({ environment: {} });
  assert.equal((await reporter.onEnd({ status: "failed" })).status, "failed");
  assert.equal((await reporter.onEnd({ status: "passed" })).status, "passed");
});
