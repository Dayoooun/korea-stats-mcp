/**
 * Playwright global setup for the live Inspector project.
 *
 * The Inspector is intentionally started here, rather than through Playwright's
 * webServer helper, so readiness, token acquisition, and teardown share one
 * lifecycle. No child output is forwarded: Inspector output may contain a
 * session token.
 */

import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const REPOSITORY_ROOT = process.cwd();
const TOKEN_FILE = path.join(REPOSITORY_ROOT, ".mcp-session-token");
const DEFAULT_TIMEOUT_MS = 30_000;
const TOKEN_ENV_NAMES = ["MCP_INSPECTOR_API_TOKEN"] as const;
const OPERATOR_ENV_NAMES = ["KOSIS_API_KEY", "DATA_GO_KR_SERVICE_KEY"] as const;

export type SpawnLike = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface InspectorLifecycleOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  tokenFile?: string;
  timeoutMs?: number;
  spawnProcess?: SpawnLike;
  clearOperatorCredentials?: boolean;
}

export interface InspectorTeardown {
  (): Promise<void>;
}

export interface OperatorEnvFile {
  filePath: string;
  directory: string;
  cleanup: () => void;
}

export type StartInspectorLike = (
  options?: InspectorLifecycleOptions,
) => Promise<InspectorTeardown>;

/** Extract a token without logging it or any surrounding Inspector output. */
export function extractSessionToken(output: string): string | undefined {
  const match =
    output.match(/\bMCP_INSPECTOR_API_TOKEN\s*[:=]\s*([A-Za-z0-9_-]+)/i) ??
    output.match(/\bsession[\s_-]*token\s*[:=]\s*([A-Za-z0-9_-]+)/i) ??
    output.match(/\btoken\s*[:=]\s*([A-Za-z0-9_-]{20,})/i);
  return match?.[1];
}

/** Recognise only explicit startup signals, not arbitrary child output. */
export function hasInspectorReadySignal(output: string): boolean {
  return /(?:^|\r?\n)MCP Inspector Web is up and running at:\r?\n[ \t]+http:\/\/(?:localhost|127\.0\.0\.1):6274(?:\?[^\s]*)?[ \t]*(?:\r?\n|$)/u.test(
    output,
  );
}

function removeTokenFile(tokenFile: string): void {
  try {
    fs.unlinkSync(tokenFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw genericFailure("unable to remove the private Inspector token");
    }
  }
}

function writeTokenFile(tokenFile: string, token: string): void {
  fs.writeFileSync(tokenFile, token, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(tokenFile, 0o600);
}

function genericFailure(reason: string): Error {
  return new Error(`MCP Inspector prerequisite failed: ${reason}`);
}

function serializeOperatorEnvValue(name: string, value: string): string {
  if (/[\r\n]/u.test(value)) {
    throw genericFailure(
      `operator credential ${name} contains an unsupported line break`,
    );
  }

  // Node's --env-file parser treats # as a comment in unquoted values. Quote
  // those values when possible, and reject combinations it cannot represent
  // without changing the credential.
  const needsQuotes =
    value !== value.trim() ||
    value.includes("#") ||
    value.startsWith("'") ||
    value.startsWith('"');
  if (!needsQuotes) return value;

  if (value.includes("'") && value.includes('"')) {
    throw genericFailure(
      `operator credential ${name} contains unsupported quote characters`,
    );
  }
  if (!value.includes("'")) return `'${value}'`;
  return `"${value}"`;
}

function removeOperatorEnvFile(directory: string): void {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    throw genericFailure(
      "unable to remove the private operator credential file",
    );
  }
}

/**
 * Write only allowlisted operator credentials to a private Node dotenv file.
 * The generated path is never derived from a credential value.
 */
export function createOperatorEnvFile(
  env: NodeJS.ProcessEnv = process.env,
): OperatorEnvFile | undefined {
  const lines = OPERATOR_ENV_NAMES.flatMap((name) => {
    const value = env[name];
    if (value === undefined) return [];
    const serialized = serializeOperatorEnvValue(name, value);
    return value.trim() ? [`${name}=${serialized}`] : [];
  });
  if (lines.length === 0) return undefined;

  let directory: string | undefined;
  try {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "korea-stats-inspector-"),
    );
    fs.chmodSync(directory, 0o700);
    const filePath = path.join(directory, "operator.env");
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.chmodSync(filePath, 0o600);
    return {
      filePath,
      directory,
      cleanup: () => removeOperatorEnvFile(directory!),
    };
  } catch {
    if (directory) removeOperatorEnvFile(directory);
    throw genericFailure("unable to prepare operator credentials securely");
  }
}

export function buildLocalInspectorArgs(
  operatorEnvFilePath: string | undefined,
  repositoryRoot: string = REPOSITORY_ROOT,
  candidateEntry?: string,
): string[] {
  const entry = candidateEntry?.trim();
  if (candidateEntry !== undefined && !entry) {
    throw genericFailure("candidate stdio entry is empty");
  }
  return [
    "exec",
    "mcp-inspector",
    "node",
    "--",
    ...(operatorEnvFilePath
      ? [`--env-file=${path.resolve(operatorEnvFilePath)}`]
      : []),
    path.resolve(repositoryRoot, entry ?? "dist/index.js"),
  ];
}

/**
 * Start the local Inspector candidate with credentials loaded by Node itself.
 * Keeping this wrapper separate means injectable offline startInspector calls
 * retain their original keyless behavior.
 */
export async function startInspectorWithOperatorCredentials(
  options: {
    env?: NodeJS.ProcessEnv;
    repositoryRoot?: string;
    start?: StartInspectorLike;
  } = {},
): Promise<InspectorTeardown> {
  const env = { ...process.env, ...options.env };
  const operatorEnvFile = createOperatorEnvFile(env);
  const start = options.start ?? startInspector;
  const candidateEntry = env.KOREA_STATS_CANDIDATE_STDIO_ENTRY;
  if (!operatorEnvFile && candidateEntry === undefined) return start();

  const inspectorEnv = { ...env };
  for (const name of OPERATOR_ENV_NAMES) delete inspectorEnv[name];
  delete inspectorEnv.VERCEL_AUTOMATION_BYPASS_SECRET;

  try {
    const teardown = await start({
      command: "pnpm",
      args: buildLocalInspectorArgs(
        operatorEnvFile?.filePath,
        options.repositoryRoot,
        candidateEntry,
      ),
      env: inspectorEnv,
      clearOperatorCredentials: true,
    });
    return async () => {
      try {
        await teardown();
      } finally {
        operatorEnvFile?.cleanup();
      }
    };
  } catch (error) {
    operatorEnvFile?.cleanup();
    throw error;
  }
}

/**
 * Start the Inspector and resolve only after both a ready signal and a token
 * are present. `spawnProcess` is injectable so offline tests can exercise all
 * failure paths without launching npx or waiting for the real deadline.
 */
export function startInspector(
  options: InspectorLifecycleOptions = {},
): Promise<InspectorTeardown> {
  const tokenFile = options.tokenFile ?? TOKEN_FILE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnProcess = options.spawnProcess ?? (spawn as SpawnLike);
  const command = options.command ?? "pnpm";
  const args = options.args ?? ["run", "inspector"];
  const cwd = options.cwd ?? REPOSITORY_ROOT;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    MCP_AUTO_OPEN_ENABLED: "false",
  };
  // Preview authorization belongs to the test worker, not the Inspector child.
  delete childEnv.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (options.clearOperatorCredentials) {
    for (const name of OPERATOR_ENV_NAMES) delete childEnv[name];
  }
  const explicitToken = TOKEN_ENV_NAMES.map(
    (name) => options.env?.[name] ?? process.env[name],
  ).find((value) => value?.trim());

  removeTokenFile(tokenFile);

  return new Promise<InspectorTeardown>((resolve, reject) => {
    let child: ChildProcess | undefined;
    let ready = false;
    let token: string | undefined = explicitToken?.trim() || undefined;
    let settled = false;
    let cleaned = false;
    const outputBuffers = { stdout: "", stderr: "" };
    let timer: NodeJS.Timeout | undefined;

    const cleanup = async (): Promise<void> => {
      if (cleaned) return;
      cleaned = true;
      if (timer) clearTimeout(timer);

      if (child && !child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // The process may have exited between the state check and kill.
        }
      }

      removeTokenFile(tokenFile);
    };

    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void cleanup().then(
        () => reject(genericFailure(reason)),
        () =>
          reject(
            genericFailure("unable to clean up the private Inspector token"),
          ),
      );
    };

    const succeedIfReady = (): void => {
      if (settled || !ready || !token) return;
      try {
        writeTokenFile(tokenFile, token);
      } catch {
        fail("unable to persist the session token securely");
        return;
      }
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(cleanup);
    };

    try {
      child = spawnProcess(command, args, {
        cwd,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      fail("spawn threw before the Inspector started");
      return;
    }
    if (!child) {
      fail("spawn returned no Inspector process");
      return;
    }

    const consumeOutput = (
      stream: "stdout" | "stderr",
      chunk: Buffer | string,
    ): void => {
      // Preserve split tokens within each stream without joining unrelated output.
      outputBuffers[stream] =
        `${outputBuffers[stream]}${chunk.toString()}`.slice(-64 * 1024);
      if (!token) token = extractSessionToken(outputBuffers[stream]);
      if (!ready) ready = hasInspectorReadySignal(outputBuffers[stream]);
      succeedIfReady();
    };

    child.stdout?.on("data", (chunk: Buffer) => consumeOutput("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => consumeOutput("stderr", chunk));
    child.once("error", () => fail("spawn emitted an error"));
    child.once("exit", () => {
      if (!settled)
        fail("Inspector exited before readiness and token acquisition");
    });
    child.once("close", () => {
      if (!settled)
        fail("Inspector closed before readiness and token acquisition");
    });

    if (token) {
      succeedIfReady();
    }

    timer = setTimeout(() => {
      fail("timed out waiting for Inspector readiness and session token");
    }, timeoutMs);
  });
}

async function globalSetup(): Promise<InspectorTeardown> {
  return startInspectorWithOperatorCredentials();
}

export default globalSetup;
