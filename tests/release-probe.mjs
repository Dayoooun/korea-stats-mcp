import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const releaseEnvironmentNames = [
  "KOREA_STATS_RELEASE_PHASE",
  "KOREA_STATS_RELEASE_CANDIDATE",
  "KOREA_STATS_RELEASE_PREREQUISITE",
  "KOREA_STATS_ADMISSION_REPORT_PATH",
  "KOREA_STATS_LIVE_RECEIPT_PATH",
  "KOREA_STATS_MCP_CLIENTS_RECEIPT_PATH",
  "KOREA_STATS_KEY_REVOCATION_RECEIPT_PATH",
  "KOREA_STATS_PACK_RECEIPT_PATH",
  "KOREA_STATS_DEPLOY_RECEIPT_PATH",
];

function scrubReleaseEnvironment() {
  const environment = { ...process.env };
  for (const name of releaseEnvironmentNames) delete environment[name];
  return environment;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    env: scrubReleaseEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function statusOf(result) {
  return typeof result.status === "number" ? result.status : 1;
}

function runFocusedPlaywright(pattern) {
  const cli = path.join(
    repositoryRoot,
    "node_modules",
    "@playwright",
    "test",
    "cli.js",
  );
  return run(process.execPath, [
    cli,
    "test",
    "tests/harness-prerequisites.spec.ts",
    "--project=offline",
    "--grep",
    pattern,
    "--reporter=line",
  ]);
}

function runFocusedNodeTests(file, pattern) {
  return run(process.execPath, [
    "--test",
    "--test-reporter=tap",
    "--test-name-pattern",
    pattern,
    file,
  ]);
}

function assertProbeSucceeded(result, label) {
  if (statusOf(result) !== 0) {
    throw new Error(`${label} failed`);
  }
}
function assertFocusedNodeTestsExecuted(result, label) {
  assertProbeSucceeded(result, label);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const metric = (name) => {
    const match = output.match(
      new RegExp(`(?:^|\\n)\\s*(?:#|ℹ)\\s*${name}\\s+(\\d+)`, "i"),
    );
    return match ? Number(match[1]) : undefined;
  };
  const tests = metric("tests");
  const passed = metric("pass");
  const failed = metric("fail");
  const skipped = metric("skipped");
  if (
    tests === undefined ||
    passed === undefined ||
    failed === undefined ||
    skipped === undefined ||
    tests < 1 ||
    passed < 1 ||
    tests !== passed ||
    failed !== 0 ||
    skipped !== 0
  ) {
    throw new Error(`${label} did not execute a nonempty passing suite`);
  }
}

function runNegativeGateProcess(kind) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "korea-stats-negative-gate-"),
  );
  const reportPath = path.join(directory, `${kind}.json`);
  const environment = scrubReleaseEnvironment();
  environment.KOREA_STATS_RELEASE_PHASE = "R1";
  environment.KOREA_STATS_RELEASE_CANDIDATE = "offline-negative-probe";
  environment.KOREA_STATS_RELEASE_PREREQUISITE = "true";
  environment.KOREA_STATS_ADMISSION_REPORT_PATH = reportPath;
  try {
    return spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "admission-gate", kind],
      {
        cwd: repositoryRoot,
        env: environment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function assertGateRejected(kind) {
  // This command intentionally exits with the evaluator's nonzero gate status.
  // It receives no outer release report path; the caller assigns one when it
  // invokes this probe from a release run.
  const candidate = "offline-negative-probe";
  const base = {
    phase: "R1",
    candidate,
    prerequisite: true,
  };
  const commonEvidence = {
    id: "REQ-H01",
    ac: ["AC13"],
    transport: "stdio",
    mode: "offline",
    status: "passed",
    candidate,
    candidateProof: { candidate },
    transportProof: { candidate, transport: "stdio" },
    prerequisite: true,
    attempts: 1,
  };
  if (kind === "missing") {
    base.report = { collected: 1, unexpectedSkips: 0, cases: [commonEvidence] };
  } else if (kind === "skip") {
    base.report = {
      collected: 1,
      unexpectedSkips: 0,
      cases: [{ ...commonEvidence, status: "skipped" }],
    };
  } else if (kind === "zero") {
    base.report = { collected: 0, unexpectedSkips: 0, cases: [] };
  } else if (kind === "reportmissing") {
    // Leave report absent to exercise the report-missing path.
  } else {
    throw new Error("unknown admission fixture");
  }

  return import("./requiredCases.ts").then(({ evaluateAdmission }) => {
    const decision = evaluateAdmission(base);
    // A release gate must be nonzero for every injected negative fixture.
    process.exitCode = decision.status === "failed" && !decision.ok ? 1 : 0;
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function allFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  if (fs.existsSync(root)) visit(root);
  return files;
}

function runSecurityProbe() {
  const packageConfig = fs.readFileSync(
    path.join(repositoryRoot, "src", "config", "index.ts"),
    "utf8",
  );
  if (!/process\.env\.KOSIS_API_KEY/.test(packageConfig))
    throw new Error("config env route missing");
  if (/apiKey\s*:\s*['"`][^$<{][^'"`]{15,}['"`]/i.test(packageConfig)) {
    throw new Error("direct config key detected");
  }

  const outputFiles = [
    path.join(repositoryRoot, "README.md"),
    ...allFiles(path.join(repositoryRoot, "docs")),
    ...allFiles(path.join(repositoryRoot, "dist")),
  ];
  const literalSecret =
    /(?:KOSIS_API_KEY|DATA_GO_KR_SERVICE_KEY|apiKey|serviceKey)\s*[:=]\s*['"`]([A-Za-z0-9_+/=-]{16,})['"`]/i;
  for (const file of outputFiles) {
    const content = fs.readFileSync(file, "utf8");
    if (literalSecret.test(content))
      throw new Error("literal credential in release output");
  }

  const security = runFocusedNodeTests(
    "tests/security.test.mjs",
    "local configuration requires|missing client credentials|upstream credentials and error bodies|remote MCP accepts anonymous|unexpected upstream envelopes|npm stdio transport",
  );
  assertProbeSucceeded(security, "security focused checks");
}

function runPackageProbe() {
  const packageJson = readJson(path.join(repositoryRoot, "package.json"));
  const lockText = fs.readFileSync(
    path.join(repositoryRoot, "pnpm-lock.yaml"),
    "utf8",
  );
  const declared = packageJson.dependencies?.["@modelcontextprotocol/sdk"];
  if (declared !== "^1.30.0")
    throw new Error("SDK declaration is not the approved range");
  if (
    !/['"]?@modelcontextprotocol\/sdk['"]?:\n\s+specifier: \^1\.30\.0\n\s+version: 1\.30\.0\(/.test(
      lockText,
    )
  ) {
    throw new Error("lockfile does not resolve SDK 1.30.0");
  }

  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "korea-stats-release-install-"),
  );
  try {
    fs.copyFileSync(
      path.join(repositoryRoot, "package.json"),
      path.join(temporaryRoot, "package.json"),
    );
    fs.copyFileSync(
      path.join(repositoryRoot, "pnpm-lock.yaml"),
      path.join(temporaryRoot, "pnpm-lock.yaml"),
    );
    const install = spawnSync(
      "pnpm",
      [
        "install",
        "--frozen-lockfile",
        "--offline",
        "--ignore-scripts",
        "--reporter=silent",
      ],
      {
        cwd: temporaryRoot,
        env: scrubReleaseEnvironment(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    assertProbeSucceeded(install, "isolated frozen install");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const [command, argument] = process.argv.slice(2);
try {
  if (command === "h01") {
    assertProbeSucceeded(
      runFocusedPlaywright(
        "ready without token|token without ready|silent startup times out|early child exit|spawn error|captured output token|explicit environment token|connection rejection",
      ),
      "offline prerequisite checks",
    );
  } else if (command === "h03") {
    assertProbeSucceeded(
      runFocusedPlaywright(
        "ready without token|token without ready|silent startup times out|early child exit|connection rejection",
      ),
      "offline failure-injection checks",
    );
  } else if (command === "h04") {
    const checks = runFocusedNodeTests(
      "tests/release-admission.test.mjs",
      "missingID|requiredskip|0cases|missing report",
    );
    assertProbeSucceeded(checks, "admission evaluator checks");
    for (const kind of ["missing", "skip", "zero", "reportmissing"]) {
      const probe = runNegativeGateProcess(kind);
      if (statusOf(probe) === 0)
        throw new Error(`negative gate fixture ${kind} unexpectedly passed`);
    }
  } else if (command === "m07") {
    assertFocusedNodeTestsExecuted(
      runFocusedNodeTests("tests/metadata-pagination.test.mjs", ".*"),
      "M07 metadata assertions",
    );
  } else if (command === "q01") {
    assertFocusedNodeTestsExecuted(
      runFocusedNodeTests(
        "tests/query-integrity.test.mjs",
        "classification dimensions reach|each L1-L8 selector|cache identity version|cache hits isolate returned raw rows|wildcard and list selections|plus-separated provider selectors",
      ),
      "Q01 query identity assertions",
    );
  } else if (command === "q02") {
    const suites = [
      ["tests/query-integrity.test.mjs", ".*", "Q02 query observations"],
      [
        "tests/annual-response-contract.test.mjs",
        ".*",
        "Q02 annual observations",
      ],
      ["tests/analysis-integrity.test.mjs", ".*", "Q02 analysis observations"],
      ["tests/quick-tools.test.mjs", ".*", "Q02 quick observations"],
    ];
    for (const [file, pattern, label] of suites) {
      assertFocusedNodeTestsExecuted(runFocusedNodeTests(file, pattern), label);
    }
  } else if (command === "admission-gate") {
    await assertGateRejected(argument);
  } else if (command === "s01") {
    runSecurityProbe();
  } else if (command === "s02") {
    runPackageProbe();
  } else {
    throw new Error("unknown release probe");
  }
} catch (error) {
  // Deliberately report only a stable category; child output may contain credentials.
  console.error(
    error instanceof Error ? error.message : "release probe failed",
  );
  process.exitCode = 1;
}
