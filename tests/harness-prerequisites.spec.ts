/**
 * Offline W16a failure-injection checks.
 *
 * These tests stub the child process and use millisecond deadlines, so they
 * never require Inspector, an API key, or a 30-second live wait.
 */

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { spawnSync, type ChildProcess } from "node:child_process";
import { test, expect } from "@playwright/test";
import { assertConnectionSucceeded } from "./fixtures";
import { callToolJson } from "./release-live-client";
import { REQUIRED_CASE_IDS } from "./requiredCases";
import {
  assertM06ReceiptFile,
  assertS04ReceiptFile,
  type ExternalReceiptContext,
} from "./release-external-evidence";
import {
  flattenDeploymentFiles,
  MAX_DEPLOYMENT_TREE_DEPTH,
  MAX_DEPLOYMENT_TREE_NODES,
} from "./release-deployment-files";
import {
  buildLocalInspectorArgs,
  createOperatorEnvFile,
  startInspector,
  startInspectorWithOperatorCredentials,
  type SpawnLike,
  type StartInspectorLike,
} from "./globalSetup";

const SYNTHETIC_TOKEN = "synthetic-token-for-offline-test";
const OPERATOR_SENTINEL = "operator-key-sentinel";
const SECONDARY_OPERATOR_SENTINEL = "data-go-key-sentinel";
const READY_BANNER =
  "\nMCP Inspector Web is up and running at:\n   http://localhost:6274\n";
function deploymentFixtureUid(seed: number): string {
  return seed.toString(16).padStart(40, "0");
}

function deploymentTreeFixture(): unknown[] {
  const distChildren = [
    {
      name: "index.js",
      type: "file",
      mode: 0o644,
      uid: deploymentFixtureUid(1),
    },
    {
      name: "chunk.js",
      type: "file",
      mode: 0o644,
      uid: deploymentFixtureUid(2),
    },
  ];
  const srcChildren = [
    {
      name: "dist",
      type: "directory",
      mode: 0o755,
      children: distChildren,
    },
    {
      name: "package.json",
      type: "file",
      mode: 0o644,
      uid: deploymentFixtureUid(3),
    },
    {
      name: "api",
      type: "directory",
      mode: 0o755,
      children: [
        {
          name: "mcp.ts",
          type: "file",
          mode: 0o644,
          uid: deploymentFixtureUid(4),
        },
      ],
    },
    ...Array.from({ length: 16 }, (_, index) => ({
      name: `runtime-${index + 1}.js`,
      type: "file",
      mode: 0o644,
      uid: deploymentFixtureUid(index + 5),
    })),
  ];
  return [
    {
      name: "src",
      type: "directory",
      mode: 0o755,
      children: srcChildren,
    },
    {
      name: "out",
      type: "directory",
      mode: 0o755,
      children: [
        {
          name: "api",
          type: "directory",
          mode: 0o755,
          children: [
            {
              name: "mcp",
              type: "lambda",
              mode: 0o755,
              uid: "opaque-lambda-uid",
            },
          ],
        },
      ],
    },
  ];
}

function cloneDeploymentFixture(): unknown[] {
  return structuredClone(deploymentTreeFixture());
}

function deploymentFixtureNode(
  tree: unknown[],
  segments: readonly string[],
): Record<string, unknown> {
  let nodes = tree;
  for (const [index, segment] of segments.entries()) {
    const node = nodes.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        (candidate as Record<string, unknown>).name === segment,
    );
    if (
      node === undefined ||
      typeof node !== "object" ||
      node === null ||
      Array.isArray(node)
    ) {
      throw new Error(
        `fixture node ${segments.slice(0, index + 1).join("/")} missing`,
      );
    }
    const record = node as Record<string, unknown>;
    if (index === segments.length - 1) return record;
    if (!Array.isArray(record.children)) {
      throw new Error(`fixture node ${segment} has no children`);
    }
    nodes = record.children;
  }
  throw new Error("fixture node path is empty");
}

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  kill: () => boolean;
};

function fakeSpawn(schedule: (child: FakeChild) => void): SpawnLike {
  return () => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      child.emit("close", null, "SIGTERM");
      return true;
    };
    queueMicrotask(() => schedule(child));
    return child as unknown as ChildProcess;
  };
}

function tokenFile(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "korea-stats-harness-")),
    "token",
  );
}
type ExternalFixture = {
  readonly directory: string;
  readonly evidencePath: string;
  readonly s04Path: string;
  readonly m06Path: string;
  readonly context: ExternalReceiptContext;
};

function makeExternalFixture(): ExternalFixture {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "korea-stats-external-fixture-"),
  );
  const evidencePath = path.join(directory, "manual-evidence.txt");
  const s04Path = path.join(directory, "s04.json");
  const m06Path = path.join(directory, "m06.json");
  const context: ExternalReceiptContext = {
    phase: "R2",
    candidate: "offline-fixture-candidate",
    targetUrl: "https://mcp-clients.example.invalid/mcp",
  };
  const evidence = "clearly synthetic offline validator fixture\n";
  fs.writeFileSync(evidencePath, evidence);
  const sha256 = createHash("sha256").update(evidence).digest("hex");

  fs.writeFileSync(
    s04Path,
    JSON.stringify({
      kind: "key-revocation",
      id: "offline-s04-receipt",
      phase: context.phase,
      candidate: context.candidate,
      caseIds: ["REQ-S04"],
      status: "passed",
      version: "2.0.0",
      observedAt: "2026-09-09T12:00:00.000Z",
      attempts: 1,
      action: "revoked",
      evidenceRef: evidencePath,
      sha256,
      operatorVerificationRef: "offline-operator-fixture",
      metadata: {
        provider: "KOSIS",
        keyReference: "opaque-fixture-reference",
        oldKeyStatus: "revoked",
        exposureDisposition: "replaced",
        verifiedAt: "2026-09-09T12:00:00.000Z",
      },
    }),
  );

  const pages = Array.from({ length: 10 }, (_, index) => ({
    identity: `ITM-fixture-page-${index + 1}`,
    cursorProgress: `cursorpayload-${index + 1}.cursorsignature-${index + 1}`,
    count: 1,
  }));
  const m06Client = (clientName: string, clientVersion: string) => ({
    clientName,
    clientVersion,
    targetUrl: context.targetUrl,
    connectionAttempts: [1, 2, 3].map((attempt) => ({
      success: true,
      candidate: context.candidate,
      url: context.targetUrl,
      observedAt: `2026-09-09T12:00:0${attempt}.000Z`,
    })),
    metadataTraversal: {
      pageCount: pages.length,
      pages: pages.map((page) => ({ ...page })),
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
  });
  fs.writeFileSync(
    m06Path,
    JSON.stringify({
      kind: "mcp-clients",
      id: "offline-m06-receipt",
      phase: context.phase,
      candidate: context.candidate,
      caseIds: ["REQ-M06"],
      status: "passed",
      version: "2.0.0",
      observedAt: "2026-09-09T12:00:00.000Z",
      attempts: 3,
      evidenceRef: evidencePath,
      sha256,
      operatorVerificationRef: "offline-operator-fixture",
      metadata: {
        clients: [
          m06Client("Claude Code", "claude-code-fixture-1.0.0"),
          m06Client("Codex", "codex-fixture-1.0.0"),
        ],
      },
    }),
  );

  return { directory, evidencePath, s04Path, m06Path, context };
}

function readFixtureJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
    string,
    unknown
  >;
}

function writeFixtureJson(
  filePath: string,
  value: Record<string, unknown>,
): void {
  fs.writeFileSync(filePath, JSON.stringify(value));
}

async function expectLifecycleFailure(spawnProcess: SpawnLike): Promise<void> {
  const file = tokenFile();
  try {
    await expect(
      startInspector({
        spawnProcess,
        tokenFile: file,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/MCP Inspector prerequisite failed/);
    expect(fs.existsSync(file)).toBe(false);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

test.describe("W16a offline prerequisite admission", () => {
  test("ready without token rejects and cleans up", async () => {
    await expectLifecycleFailure(
      fakeSpawn((child) => {
        child.stdout.emit("data", READY_BANNER);
      }),
    );
  });

  test("explicit token with a bind-error diagnostic is not ready", async () => {
    const file = tokenFile();
    try {
      await expect(
        startInspector({
          env: { MCP_INSPECTOR_API_TOKEN: SYNTHETIC_TOKEN },
          tokenFile: file,
          timeoutMs: 20,
          spawnProcess: fakeSpawn((child) => {
            child.stderr.emit(
              "data",
              "Error listening on http://127.0.0.1:6274: EADDRINUSE",
            );
          }),
        }),
      ).rejects.toThrow("prerequisite failed");
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("startup token cleanup failure is rejected without an unhandled promise", async () => {
    const file = tokenFile();
    try {
      await expect(
        startInspector({
          tokenFile: file,
          timeoutMs: 20,
          spawnProcess: fakeSpawn(() => {
            fs.mkdirSync(file);
          }),
        }),
      ).rejects.toThrow("unable to clean up the private Inspector token");
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("token without ready rejects and cleans up", async () => {
    await expectLifecycleFailure(
      fakeSpawn((child) => {
        child.stderr.emit("data", `MCP_INSPECTOR_API_TOKEN=${SYNTHETIC_TOKEN}`);
      }),
    );
  });

  test("silent startup times out instead of resolving", async () => {
    await expectLifecycleFailure(fakeSpawn(() => undefined));
  });

  test("early child exit rejects instead of resolving", async () => {
    await expectLifecycleFailure(
      fakeSpawn((child) => {
        child.emit("exit", 1, null);
        child.emit("close", 1, null);
      }),
    );
  });

  test("spawn error rejects instead of resolving", async () => {
    await expectLifecycleFailure(
      fakeSpawn((child) => {
        child.emit("error", new Error("synthetic spawn failure"));
      }),
    );
  });
  test("captured output token requires ready and is written securely", async () => {
    const file = tokenFile();
    const teardown = await startInspector({
      spawnProcess: fakeSpawn((child) => {
        child.stdout.emit("data", READY_BANNER);
        child.stderr.emit("data", `MCP_INSPECTOR_API_TOKEN=${SYNTHETIC_TOKEN}`);
      }),
      tokenFile: file,
      timeoutMs: 100,
    });

    try {
      expect(fs.readFileSync(file, "utf8")).toBe(SYNTHETIC_TOKEN);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      await teardown();
      expect(fs.existsSync(file)).toBe(false);
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("explicit environment token requires ready and is mode 0600 until teardown", async () => {
    const file = tokenFile();
    const spawnProcess = fakeSpawn((child) => {
      child.stdout.emit("data", READY_BANNER);
    });
    const teardown = await startInspector({
      spawnProcess: (command, args, options) => {
        expect(options.env?.MCP_AUTO_OPEN_ENABLED).toBe("false");
        return spawnProcess(command, args, options);
      },
      env: {
        MCP_INSPECTOR_API_TOKEN: SYNTHETIC_TOKEN,
        MCP_AUTO_OPEN_ENABLED: "true",
      },
      tokenFile: file,
      timeoutMs: 100,
    });

    try {
      expect(fs.readFileSync(file, "utf8")).toBe(SYNTHETIC_TOKEN);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      await teardown();
      expect(fs.existsSync(file)).toBe(false);
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  test("operator credentials use a private dotenv file and never enter Inspector arguments", async () => {
    const prepared = createOperatorEnvFile({
      KOSIS_API_KEY: OPERATOR_SENTINEL,
      DATA_GO_KR_SERVICE_KEY: SECONDARY_OPERATOR_SENTINEL,
      UNRELATED_SECRET: "must-not-be-copied",
    });
    expect(prepared).toBeDefined();

    try {
      expect(fs.statSync(prepared!.directory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(prepared!.filePath).mode & 0o777).toBe(0o600);
      const contents = fs.readFileSync(prepared!.filePath, "utf8");
      expect(contents).toContain(`KOSIS_API_KEY=${OPERATOR_SENTINEL}`);
      expect(contents).toContain(
        `DATA_GO_KR_SERVICE_KEY=${SECONDARY_OPERATOR_SENTINEL}`,
      );
      expect(contents).not.toContain("UNRELATED_SECRET");

      const args = buildLocalInspectorArgs(prepared!.filePath);
      expect(args).toEqual([
        "exec",
        "mcp-inspector",
        "node",
        "--",
        `--env-file=${prepared!.filePath}`,
        path.resolve("dist/index.js"),
      ]);
      expect(args.join(" ")).not.toContain(OPERATOR_SENTINEL);
      expect(args.join(" ")).not.toContain(SECONDARY_OPERATOR_SENTINEL);
    } finally {
      prepared!.cleanup();
      expect(fs.existsSync(prepared!.filePath)).toBe(false);
      expect(fs.existsSync(prepared!.directory)).toBe(false);
    }
  });

  test("Node env-file preserves quoted sentinel values and rejects line injection", () => {
    for (const value of ["sentinel#fragment", "'sentinel", '"sentinel']) {
      const prepared = createOperatorEnvFile({ KOSIS_API_KEY: value });
      try {
        const child = spawnSync(
          process.execPath,
          [
            `--env-file=${prepared!.filePath}`,
            "-e",
            "process.stdout.write(JSON.stringify(process.env.KOSIS_API_KEY))",
          ],
          { env: {}, encoding: "utf8" },
        );
        expect(child.status).toBe(0);
        expect(JSON.parse(child.stdout)).toBe(value);
      } finally {
        prepared!.cleanup();
      }
    }
    for (const value of [
      "sentinel\nINJECTED=value",
      "\nsentinel",
      "sentinel\r\n",
    ]) {
      expect(() => createOperatorEnvFile({ KOSIS_API_KEY: value })).toThrow(
        "unsupported line break",
      );
    }
    expect(() =>
      createOperatorEnvFile({
        KOSIS_API_KEY: "'sentinel\"",
      }),
    ).toThrow("unsupported quote characters");
  });

  test("operator dotenv file is removed when local setup rejects", async () => {
    let preparedFilePath: string | undefined;
    const start: StartInspectorLike = async (options) => {
      preparedFilePath = options?.args
        ?.find((argument) => argument.startsWith("--env-file="))
        ?.slice("--env-file=".length);
      expect(preparedFilePath).toBeDefined();
      expect(fs.existsSync(preparedFilePath!)).toBe(true);
      throw new Error("synthetic local setup rejection");
    };

    await expect(
      startInspectorWithOperatorCredentials({
        env: { KOSIS_API_KEY: OPERATOR_SENTINEL },
        start,
      }),
    ).rejects.toThrow("synthetic local setup rejection");

    expect(fs.existsSync(preparedFilePath!)).toBe(false);
    expect(fs.existsSync(path.dirname(preparedFilePath!))).toBe(false);
  });

  test("operator dotenv file remains through setup and is removed by teardown", async () => {
    let preparedFilePath: string | undefined;
    const teardown = await startInspectorWithOperatorCredentials({
      env: { KOSIS_API_KEY: OPERATOR_SENTINEL },
      start: async (options) => {
        preparedFilePath = options?.args
          ?.find((argument) => argument.startsWith("--env-file="))
          ?.slice("--env-file=".length);
        expect(preparedFilePath).toBeDefined();
        expect(fs.existsSync(preparedFilePath!)).toBe(true);
        expect(options?.clearOperatorCredentials).toBe(true);
        expect(options?.env?.KOSIS_API_KEY).toBeUndefined();
        expect(options?.env?.DATA_GO_KR_SERVICE_KEY).toBeUndefined();
        return async () => undefined;
      },
    });

    expect(fs.existsSync(preparedFilePath!)).toBe(true);
    await teardown();
    expect(fs.existsSync(preparedFilePath!)).toBe(false);
    expect(fs.existsSync(path.dirname(preparedFilePath!))).toBe(false);
  });

  test("Inspector binds an explicit candidate entry with or without provider credentials", async () => {
    const entry = path.resolve(
      os.tmpdir(),
      "candidate with spaces/dist/index.js",
    );
    for (const configured of [false, true]) {
      let privateFile: string | undefined;
      let started = false;
      const teardown = await startInspectorWithOperatorCredentials({
        env: {
          KOSIS_API_KEY: configured ? OPERATOR_SENTINEL : "",
          DATA_GO_KR_SERVICE_KEY: "",
          KOREA_STATS_CANDIDATE_STDIO_ENTRY: entry,
          VERCEL_AUTOMATION_BYPASS_SECRET: SECONDARY_OPERATOR_SENTINEL,
        },
        start: async (options) => {
          started = true;
          expect(options?.args?.at(-1)).toBe(entry);
          expect(options?.env?.KOSIS_API_KEY).toBeUndefined();
          expect(options?.env?.DATA_GO_KR_SERVICE_KEY).toBeUndefined();
          expect(options?.env?.VERCEL_AUTOMATION_BYPASS_SECRET).toBeUndefined();
          const envArgument = options?.args?.find((arg) =>
            arg.startsWith("--env-file="),
          );
          expect(Boolean(envArgument)).toBe(configured);
          privateFile = envArgument?.slice("--env-file=".length);
          expect(JSON.stringify(options?.args)).not.toContain(
            OPERATOR_SENTINEL,
          );
          expect(JSON.stringify(options?.args)).not.toContain(
            SECONDARY_OPERATOR_SENTINEL,
          );
          return async () => undefined;
        },
      });
      try {
        expect(started).toBe(true);
        if (privateFile) expect(fs.existsSync(privateFile)).toBe(true);
      } finally {
        await teardown();
      }
      if (privateFile) expect(fs.existsSync(privateFile)).toBe(false);
    }
    let startedWithEmptyEntry = false;
    await expect(
      startInspectorWithOperatorCredentials({
        env: {
          KOSIS_API_KEY: "",
          DATA_GO_KR_SERVICE_KEY: "",
          KOREA_STATS_CANDIDATE_STDIO_ENTRY: " ",
        },
        start: async () => {
          startedWithEmptyEntry = true;
          return async () => undefined;
        },
      }),
    ).rejects.toThrow("candidate stdio entry is empty");
    expect(startedWithEmptyEntry).toBe(false);
  });
  test("clearOperatorCredentials removes operator keys from the Inspector child environment", async () => {
    for (const clearOperatorCredentials of [false, true]) {
      const file = tokenFile();
      let childEnvironment: NodeJS.ProcessEnv | undefined;
      const teardown = await startInspector({
        env: {
          MCP_INSPECTOR_API_TOKEN: SYNTHETIC_TOKEN,
          KOSIS_API_KEY: OPERATOR_SENTINEL,
          DATA_GO_KR_SERVICE_KEY: SECONDARY_OPERATOR_SENTINEL,
          VERCEL_AUTOMATION_BYPASS_SECRET: "private-preview-bypass-fixture",
        },
        clearOperatorCredentials,
        tokenFile: file,
        timeoutMs: 100,
        spawnProcess: (command, args, options) => {
          childEnvironment = options.env;
          return fakeSpawn((child) => {
            child.stdout.emit("data", READY_BANNER);
          })(command, args, options);
        },
      });

      try {
        expect(
          childEnvironment?.VERCEL_AUTOMATION_BYPASS_SECRET,
        ).toBeUndefined();
        expect(childEnvironment?.KOSIS_API_KEY).toBe(
          clearOperatorCredentials ? undefined : OPERATOR_SENTINEL,
        );
        expect(childEnvironment?.DATA_GO_KR_SERVICE_KEY).toBe(
          clearOperatorCredentials ? undefined : SECONDARY_OPERATOR_SENTINEL,
        );
        expect(childEnvironment?.MCP_INSPECTOR_API_TOKEN).toBe(SYNTHETIC_TOKEN);
      } finally {
        await teardown();
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
      }
    }
  });
  test("live tool failure diagnostics retain only bounded codes and canonical names", async () => {
    const captured: string[] = [];
    const originalError = console.error;
    const fake = (payload: Record<string, unknown>) =>
      ({
        callTool: async () => ({
          content: [{ type: "text", text: JSON.stringify(payload) }],
        }),
      }) as unknown as Parameters<typeof callToolJson>[0];
    console.error = (...values: unknown[]) => captured.push(values.join(" "));
    try {
      for (const entry of [
        { name: "get_table_info", code: "40", expected: "40" },
        { name: "get_table_info", code: "TIMEOUT", expected: "TIMEOUT" },
        {
          name: "get_table_info",
          code: OPERATOR_SENTINEL,
          expected: "OTHER_FAILURE",
        },
        {
          name: OPERATOR_SENTINEL,
          code: OPERATOR_SENTINEL,
          expected: "OTHER_FAILURE",
        },
      ]) {
        const payload = {
          success: false,
          code: entry.code,
          error: OPERATOR_SENTINEL,
        };
        await expect(
          callToolJson(fake(payload), entry.name, { query: OPERATOR_SENTINEL }),
        ).resolves.toEqual(payload);
        expect(JSON.parse(captured.at(-1)!)).toEqual({
          event: "live_tool_unsuccessful",
          tool: entry.name === "get_table_info" ? entry.name : "unknown",
          code: entry.expected,
        });
      }
      await callToolJson(fake({ success: true }), "get_table_info", {});
      expect(captured).toHaveLength(4);
      expect(captured.join("\n")).not.toContain(OPERATOR_SENTINEL);
    } finally {
      console.error = originalError;
    }
  });
  test("error-marked MCP payload cannot become successful admission evidence", async () => {
    const payload = {
      success: true,
      value: "100",
      source: { regionCode: "26" },
    };
    const fake = (isError: boolean) =>
      ({
        callTool: async () => ({
          isError,
          content: [{ type: "text", text: JSON.stringify(payload) }],
        }),
      }) as unknown as Parameters<typeof callToolJson>[0];
    await expect(callToolJson(fake(true), "quick_stats", {})).rejects.toThrow(
      "error-marked result",
    );
    await expect(callToolJson(fake(false), "quick_stats", {})).resolves.toEqual(
      payload,
    );
  });
  test("connection rejection is an admission failure", () => {
    expect(() => assertConnectionSucceeded(false)).toThrow(
      "MCP Inspector connection prerequisite was not satisfied",
    );
  });
  test("external S04 validator accepts a bounded fixture and rejects unsafe substitutions", () => {
    const fixture = makeExternalFixture();
    try {
      expect(() =>
        assertS04ReceiptFile(fixture.s04Path, fixture.context),
      ).not.toThrow();

      const wrongCandidate = readFixtureJson(fixture.s04Path);
      wrongCandidate.candidate = "different-offline-candidate";
      writeFixtureJson(fixture.s04Path, wrongCandidate);
      expect(() =>
        assertS04ReceiptFile(fixture.s04Path, fixture.context),
      ).toThrow();

      const wrongPhase = readFixtureJson(fixture.s04Path);
      wrongPhase.candidate = fixture.context.candidate;
      wrongPhase.phase = "R1";
      writeFixtureJson(fixture.s04Path, wrongPhase);
      expect(() =>
        assertS04ReceiptFile(fixture.s04Path, fixture.context),
      ).toThrow();

      const wrongHash = readFixtureJson(fixture.s04Path);
      wrongHash.phase = fixture.context.phase;
      wrongHash.sha256 = "0".repeat(64);
      writeFixtureJson(fixture.s04Path, wrongHash);
      expect(() =>
        assertS04ReceiptFile(fixture.s04Path, fixture.context),
      ).toThrow();

      const reusedKey = readFixtureJson(fixture.s04Path);
      reusedKey.sha256 = createHash("sha256")
        .update(fs.readFileSync(fixture.evidencePath))
        .digest("hex");
      reusedKey.metadata = {
        ...(reusedKey.metadata as Record<string, unknown>),
        oldKeyStatus: "active",
        exposureDisposition: "reused",
      };
      writeFixtureJson(fixture.s04Path, reusedKey);
      expect(() =>
        assertS04ReceiptFile(fixture.s04Path, fixture.context),
      ).toThrow();

      fs.rmSync(fixture.evidencePath);
      expect(() =>
        assertS04ReceiptFile(fixture.s04Path, fixture.context),
      ).toThrow();
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  test("external M06 validator accepts a bounded fixture and rejects MCP client proof gaps", () => {
    const fixture = makeExternalFixture();
    try {
      expect(() =>
        assertM06ReceiptFile(fixture.m06Path, fixture.context),
      ).not.toThrow();

      const validReceipt = readFixtureJson(fixture.m06Path);
      const firstClient = (receipt: Record<string, unknown>) =>
        (
          (receipt.metadata as Record<string, unknown>).clients as Record<
            string,
            unknown
          >[]
        )[0];

      const missingClient = structuredClone(validReceipt);
      const missingClientMetadata = missingClient.metadata as Record<
        string,
        unknown
      >;
      missingClientMetadata.clients = [
        ...(missingClientMetadata.clients as Record<string, unknown>[]).slice(
          0,
          1,
        ),
      ];
      writeFixtureJson(fixture.m06Path, missingClient);
      expect(() =>
        assertM06ReceiptFile(fixture.m06Path, fixture.context),
      ).toThrow();

      const duplicateClient = structuredClone(validReceipt);
      const duplicateClientMetadata = duplicateClient.metadata as Record<
        string,
        unknown
      >;
      const originalClient = firstClient(duplicateClient);
      duplicateClientMetadata.clients = [
        originalClient,
        structuredClone(originalClient),
      ];
      writeFixtureJson(fixture.m06Path, duplicateClient);
      expect(() =>
        assertM06ReceiptFile(fixture.m06Path, fixture.context),
      ).toThrow();

      const oneInvalidClient = structuredClone(validReceipt);
      const oneInvalidClientMetadata = oneInvalidClient.metadata as Record<
        string,
        unknown
      >;
      const oneInvalidClients = oneInvalidClientMetadata.clients as Record<
        string,
        unknown
      >[];
      oneInvalidClients[1] = {
        ...oneInvalidClients[1],
        clientName: "Cursor",
      };
      writeFixtureJson(fixture.m06Path, oneInvalidClient);
      expect(() =>
        assertM06ReceiptFile(fixture.m06Path, fixture.context),
      ).toThrow();

      const fakeProgress = structuredClone(validReceipt);
      const fakeProgressTraversal = firstClient(fakeProgress)
        .metadataTraversal as Record<string, unknown>;
      fakeProgressTraversal.pages = [
        ...(fakeProgressTraversal.pages as Record<string, unknown>[]).map(
          (page, index) =>
            index === 0 ? { ...page, cursorProgress: "fakeCursorname" } : page,
        ),
      ];
      writeFixtureJson(fixture.m06Path, fakeProgress);
      expect(() =>
        assertM06ReceiptFile(fixture.m06Path, fixture.context),
      ).toThrow();

      const shortConnections = structuredClone(validReceipt);
      const shortConnectionClient = firstClient(shortConnections);
      shortConnectionClient.connectionAttempts = (
        shortConnectionClient.connectionAttempts as Record<string, unknown>[]
      ).slice(0, 2);
      writeFixtureJson(fixture.m06Path, shortConnections);
      expect(() =>
        assertM06ReceiptFile(fixture.m06Path, fixture.context),
      ).toThrow();

      const shortTraversal = structuredClone(validReceipt);
      const shortTraversalClient = firstClient(shortTraversal);
      shortTraversalClient.metadataTraversal = {
        pageCount: 9,
        pages: Array.from({ length: 9 }, (_, index) => ({
          identity: `ITM-fixture-page-${index + 1}`,
          cursorProgress: `cursorpayload-${index + 1}.cursorsignature-${index + 1}`,
          count: 1,
        })),
      };
      writeFixtureJson(fixture.m06Path, shortTraversal);
      expect(() =>
        assertM06ReceiptFile(fixture.m06Path, fixture.context),
      ).toThrow();

      const protocolFailure = structuredClone(validReceipt);
      const protocolFailureClient = firstClient(protocolFailure);
      protocolFailureClient.protocolErrors = {
        reinitializations: 0,
        terminations: 0,
        jsonErrors: 1,
      };
      writeFixtureJson(fixture.m06Path, protocolFailure);
      expect(() =>
        assertM06ReceiptFile(fixture.m06Path, fixture.context),
      ).toThrow();

      const missingFollowup = structuredClone(validReceipt);
      const missingFollowupClient = firstClient(missingFollowup);
      delete missingFollowupClient.followupData;
      writeFixtureJson(fixture.m06Path, missingFollowup);
      expect(() =>
        assertM06ReceiptFile(fixture.m06Path, fixture.context),
      ).toThrow();
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
test("deployment tree fixture flattens actual paths and preserves immutable identities", () => {
  const first = flattenDeploymentFiles(deploymentTreeFixture(), "fixture");
  expect(first.size).toBe(21);
  expect(first.get("src/package.json")).toEqual({
    type: "file",
    uid: deploymentFixtureUid(3),
  });
  expect(first.get("src/dist/index.js")).toEqual({
    type: "file",
    uid: deploymentFixtureUid(1),
  });
  expect(first.get("src/api/mcp.ts")).toEqual({
    type: "file",
    uid: deploymentFixtureUid(4),
  });
  expect(first.get("out/api/mcp")).toEqual({
    type: "lambda",
    uid: "opaque-lambda-uid",
  });

  const altered = cloneDeploymentFixture();
  deploymentFixtureNode(altered, ["src", "api", "mcp.ts"]).uid =
    deploymentFixtureUid(99);
  const second = flattenDeploymentFiles(altered, "altered fixture");
  const inventory = (files: ReadonlyMap<string, unknown>) =>
    [...files.entries()].filter(([file]) => file.startsWith("src/"));
  expect(inventory(second)).not.toEqual(inventory(first));
});

test("deployment tree accepts observed empty directories without children", () => {
  const tree = cloneDeploymentFixture();
  const before = flattenDeploymentFiles(tree);
  const root = deploymentFixtureNode(tree, ["src"]);
  (root.children as unknown[]).push({
    name: "empty",
    type: "directory",
    mode: 0o755,
  });
  expect(flattenDeploymentFiles(tree)).toEqual(before);
});

test("deployment tree flattening rejects unsafe, malformed, duplicate, and unbounded fixtures", () => {
  const mutations: Array<{
    readonly label: string;
    readonly mutate: (tree: unknown[]) => void;
  }> = [
    {
      label: "traversal segment",
      mutate: (tree) => {
        deploymentFixtureNode(tree, ["src", "package.json"]).name =
          "../package.json";
      },
    },
    {
      label: "absolute segment",
      mutate: (tree) => {
        deploymentFixtureNode(tree, ["src", "package.json"]).name =
          "/package.json";
      },
    },
    {
      label: "separator segment",
      mutate: (tree) => {
        deploymentFixtureNode(tree, ["src", "package.json"]).name =
          "nested/package.json";
      },
    },
    {
      label: "duplicate path",
      mutate: (tree) => {
        const src = deploymentFixtureNode(tree, ["src"]);
        (src.children as unknown[]).push(
          structuredClone(deploymentFixtureNode(tree, ["src", "package.json"])),
        );
      },
    },
    {
      label: "malformed children",
      mutate: (tree) => {
        deploymentFixtureNode(tree, ["src", "dist"]).children = {};
      },
    },
    {
      label: "leaf root",
      mutate: (tree) => {
        const root = deploymentFixtureNode(tree, ["out"]);
        root.type = "file";
        root.uid = deploymentFixtureUid(123);
        delete root.children;
      },
    },
    {
      label: "malformed type",
      mutate: (tree) => {
        deploymentFixtureNode(tree, ["src", "package.json"]).type = "symlink";
      },
    },
    {
      label: "missing uid",
      mutate: (tree) => {
        delete deploymentFixtureNode(tree, ["src", "package.json"]).uid;
      },
    },
    {
      label: "leaf children",
      mutate: (tree) => {
        deploymentFixtureNode(tree, ["src", "package.json"]).children = [];
      },
    },
    {
      label: "depth bound",
      mutate: (tree) => {
        const out = deploymentFixtureNode(tree, ["out"]);
        let nested: Record<string, unknown> = {
          name: "leaf",
          type: "lambda",
          mode: 0o755,
          uid: "opaque-deep-lambda",
        };
        for (let index = 0; index < MAX_DEPLOYMENT_TREE_DEPTH; index += 1) {
          nested = {
            name: `d${index}`,
            type: "directory",
            mode: 0o755,
            children: [nested],
          };
        }
        out.children = [nested];
      },
    },
    {
      label: "node bound",
      mutate: (tree) => {
        const src = deploymentFixtureNode(tree, ["src"]);
        (src.children as unknown[]).push(
          ...Array.from({ length: MAX_DEPLOYMENT_TREE_NODES }, (_, index) => ({
            name: `overflow-${index}`,
            type: "file",
            mode: 0o644,
            uid: deploymentFixtureUid(index + 1000),
          })),
        );
      },
    },
  ];

  for (const { label, mutate } of mutations) {
    const fixture = cloneDeploymentFixture();
    mutate(fixture);
    expect(() => flattenDeploymentFiles(fixture, label), label).toThrow();
  }
  expect(() =>
    flattenDeploymentFiles({ files: deploymentTreeFixture() }, "wrapped"),
  ).toThrow();
});

test("release projects register exactly their fixed phase IDs without extras or duplicates", () => {
  test.setTimeout(45_000);
  const expectedCounts = { R1: 12, R2: 34, R3: 48 };
  for (const phase of ["R1", "R2", "R3"] as const) {
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0" };
    for (const key of Object.keys(env)) {
      if (
        key.startsWith("KOREA_STATS_") ||
        [
          "KOSIS_API_KEY",
          "DATA_GO_KR_SERVICE_KEY",
          "VERCEL_AUTOMATION_BYPASS_SECRET",
          "NO_COLOR",
        ].includes(key)
      ) {
        delete env[key];
      }
    }
    env.KOREA_STATS_RELEASE_PHASE = phase;
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--project=offline",
        "--project=live",
        "--project=release-live",
        "--list",
        "--reporter=list",
      ],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env,
        encoding: "utf8",
        timeout: 12_000,
      },
    );
    expect(result.status, `${phase} test discovery exits successfully`).toBe(0);
    const observed = result.stdout
      .split("\n")
      .flatMap((line) =>
        /^\s*\[(?:offline|live|release-live)\]/.test(line)
          ? [
              ...new Set(
                line.match(/REQ-[A-Z]\d{2}(?:\.(?:stdio|http))?/g) ?? [],
              ),
            ]
          : [],
      );
    expect(REQUIRED_CASE_IDS[phase].length).toBe(expectedCounts[phase]);
    expect(observed.length, `${phase} exact registration count`).toBe(
      expectedCounts[phase],
    );
    expect(
      new Set(observed).size,
      `${phase} duplicate registration check`,
    ).toBe(observed.length);
    expect(observed.sort(), `${phase} exact fixed requirement IDs`).toEqual(
      [...REQUIRED_CASE_IDS[phase]].sort(),
    );
  }
});
