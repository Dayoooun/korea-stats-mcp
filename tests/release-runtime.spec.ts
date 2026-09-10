import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  EXPECTED_CANDIDATE_VERSION,
  candidateConfig,
  callToolJson,
  runSanitizedLiveCase,
  withReleaseClient,
  type LiveTransportKind,
} from "./release-live-client";
import { RELEASE_ENV } from "./requiredCases";
import { flattenDeploymentFiles } from "./release-deployment-files";

const VERCEL_SCOPE = "dayooouns-projects";
const VERCEL_PROJECT_ID = "prj_7edzhiPnQ0Gxk0HRDVc9TciDMSZW";
const SDK_PACKAGE_NAME = "@modelcontextprotocol/sdk";
const SDK_VERSION = "1.30.0";
const PACKAGE_NAME = "@kimdayoun/korea-stats-mcp";
const MAX_COMMAND_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const CLI_TIMEOUT_MS = 30_000;

test.setTimeout(300_000);

type JsonRecord = Record<string, unknown>;
type ArchiveFile = {
  readonly archiveName: string;
  readonly relativeName: string;
  readonly bytes: Buffer;
  readonly sha1: string;
};
type CommandOutput = {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
};
type RuntimeProof = {
  readonly candidateVersion: string;
  readonly archiveSha256: string;
  readonly deploymentId: string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required release environment: ${name}`);
  return value;
}

function requiredArchivePath(): {
  readonly archivePath: string;
  readonly sha256: string;
} {
  const archivePath = requiredEnvironment("KOREA_STATS_CANDIDATE_ARCHIVE");
  const expectedSha256 = requiredEnvironment(
    "KOREA_STATS_CANDIDATE_ARCHIVE_SHA256",
  );
  if (!path.isAbsolute(archivePath)) {
    throw new Error("candidate archive must be an explicit absolute path");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error(
      "candidate archive SHA-256 must be 64 lowercase hexadecimal characters",
    );
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(archivePath);
  } catch {
    throw new Error("candidate archive cannot be read");
  }
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) {
    throw new Error("candidate archive is not a bounded regular file");
  }
  return { archivePath, sha256: expectedSha256 };
}

function sha1(bytes: Buffer): string {
  return createHash("sha1").update(bytes).digest("hex");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function regularFile(filePath: string, label: string): Buffer {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new Error(`${label} is missing`);
  }
  if (!stat.isFile()) throw new Error(`${label} is not a regular file`);
  try {
    return fs.readFileSync(filePath);
  } catch {
    throw new Error(`${label} cannot be read`);
  }
}

function readJsonFile(filePath: string, label: string): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(regularFile(filePath, label).toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as JsonRecord;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is missing`);
  }
  return value.trim();
}

function objectValue(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function runCommand(
  command: string,
  args: readonly string[],
  label: string,
): CommandOutput {
  const result = spawnSync(command, [...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(`${label} command failed`);
  }
  const stdout = Buffer.from(result.stdout ?? Buffer.alloc(0));
  const stderr = Buffer.from(result.stderr ?? Buffer.alloc(0));
  if (
    stdout.byteLength > MAX_COMMAND_OUTPUT_BYTES ||
    stderr.byteLength > MAX_COMMAND_OUTPUT_BYTES
  ) {
    throw new Error(`${label} command output exceeded its bound`);
  }
  return { stdout, stderr };
}

function runTar(args: readonly string[], label: string): Buffer {
  return runCommand("tar", args, label).stdout;
}

function assertSafeArchiveName(rawName: string): string {
  const name = rawName.replace(/\r$/u, "");
  if (
    name.length === 0 ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new Error("candidate archive contains an unsafe path");
  }
  const withoutTrailingSlash = name.endsWith("/") ? name.slice(0, -1) : name;
  if (
    withoutTrailingSlash !== "package" &&
    !withoutTrailingSlash.startsWith("package/")
  ) {
    throw new Error("candidate archive contains a path outside package root");
  }
  return name;
}

function archiveRelativeName(archiveName: string): string {
  const withoutTrailingSlash = archiveName.endsWith("/")
    ? archiveName.slice(0, -1)
    : archiveName;
  if (withoutTrailingSlash === "package") return "";
  return withoutTrailingSlash.slice("package/".length);
}

function archiveEntryTypes(
  archiveNames: readonly string[],
  verboseListing: Buffer,
): Map<string, "file" | "directory"> {
  const knownNames = new Set(archiveNames);
  const types = new Map<string, "file" | "directory">();
  for (const line of verboseListing.toString("utf8").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const marker = line.indexOf("package");
    if (marker < 0) continue;
    let listedName = line.slice(marker).trim();
    const linkMarker = listedName.indexOf(" -> ");
    if (linkMarker >= 0) listedName = listedName.slice(0, linkMarker);
    if (!knownNames.has(listedName)) continue;
    const kind = line[0];
    if (kind !== "-" && kind !== "d") {
      throw new Error("candidate archive contains a symlink or special entry");
    }
    types.set(listedName, kind === "d" ? "directory" : "file");
  }
  for (const name of archiveNames) {
    if (!types.has(name))
      throw new Error("candidate archive entry type is unavailable");
  }
  return types;
}

function readArchiveFiles(archivePath: string): {
  readonly files: Map<string, ArchiveFile>;
  readonly archiveSha256: string;
} {
  const archiveBytes = regularFile(archivePath, "candidate archive");
  const archiveSha256 = sha256(archiveBytes);
  const namesOutput = runTar(["-tf", archivePath], "candidate archive listing");
  const archiveNames = namesOutput
    .toString("utf8")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map(assertSafeArchiveName);
  if (archiveNames.length === 0)
    throw new Error("candidate archive has no entries");
  const uniqueNames = new Set(archiveNames);
  if (uniqueNames.size !== archiveNames.length) {
    throw new Error("candidate archive contains duplicate entries");
  }
  const verboseListing = runTar(
    ["-tvf", archivePath],
    "candidate archive type listing",
  );
  const types = archiveEntryTypes(archiveNames, verboseListing);
  const files = new Map<string, ArchiveFile>();
  for (const archiveName of archiveNames) {
    const relativeName = archiveRelativeName(archiveName);
    if (
      types.get(archiveName) !== "file" ||
      (relativeName !== "package.json" && !relativeName.startsWith("dist/"))
    ) {
      continue;
    }
    const bytes = runTar(
      ["-xOf", archivePath, archiveName],
      "candidate archive file read",
    );
    const file: ArchiveFile = {
      archiveName,
      relativeName,
      bytes,
      sha1: sha1(bytes),
    };
    if (files.has(relativeName))
      throw new Error("candidate archive has duplicate runtime files");
    files.set(relativeName, file);
  }
  if (!files.has("package.json"))
    throw new Error("candidate archive package.json is missing");
  const distFiles = [...files.keys()].filter((name) =>
    name.startsWith("dist/"),
  );
  if (distFiles.length === 0)
    throw new Error("candidate archive dist files are missing");
  return { files, archiveSha256 };
}

function collectInstalledFiles(packageRoot: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const addFile = (relativeName: string, filePath: string): void => {
    const bytes = regularFile(filePath, `installed ${relativeName}`);
    if (files.has(relativeName))
      throw new Error("installed runtime file is duplicated");
    files.set(relativeName, bytes);
  };
  addFile("package.json", path.join(packageRoot, "package.json"));

  const walk = (directory: string, relativeDirectory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      throw new Error("installed dist directory cannot be read");
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const relativeName = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(entryPath, relativeName);
      } else if (entry.isFile()) {
        addFile(relativeName, entryPath);
      } else {
        throw new Error(
          "installed runtime tree contains a symlink or special entry",
        );
      }
    }
  };

  const distPath = path.join(packageRoot, "dist");
  let distStat: fs.Stats;
  try {
    distStat = fs.lstatSync(distPath);
  } catch {
    throw new Error("installed dist directory is missing");
  }
  if (!distStat.isDirectory())
    throw new Error("installed dist path is not a directory");
  walk(distPath, "dist");
  return files;
}

function findPackageJson(startFile: string, expectedName: string): JsonRecord {
  let directory = path.dirname(startFile);
  for (;;) {
    const candidate = path.join(directory, "package.json");
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isFile()) {
        const metadata = readJsonFile(candidate, "installed package metadata");
        if (metadata.name === expectedName) return metadata;
      }
    } catch {
      // Continue ascending when an intermediate package boundary is unreadable.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("installed package metadata was not found");
}

function packageRootForEntry(entry: string): string {
  let directory = path.dirname(entry);
  for (;;) {
    const packageJson = path.join(directory, "package.json");
    try {
      if (fs.lstatSync(packageJson).isFile()) return directory;
    } catch {
      // Keep ascending until the filesystem root.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("installed candidate package root was not found");
}

function assertInstalledRuntimeMatchesArchive(
  entry: string,
  archive: ReturnType<typeof readArchiveFiles>,
): void {
  const packageRoot = packageRootForEntry(entry);
  const packageMetadata = readJsonFile(
    path.join(packageRoot, "package.json"),
    "installed candidate package metadata",
  );
  if (
    packageMetadata.name !== PACKAGE_NAME ||
    packageMetadata.version !== EXPECTED_CANDIDATE_VERSION
  ) {
    throw new Error("installed candidate package name or version is incorrect");
  }
  const installed = collectInstalledFiles(packageRoot);
  const archiveNames = new Set(archive.files.keys());
  const installedNames = new Set(installed.keys());
  if (archiveNames.size !== installedNames.size) {
    throw new Error(
      "installed runtime file inventory differs from candidate archive",
    );
  }
  for (const [relativeName, archiveFile] of archive.files) {
    const installedBytes = installed.get(relativeName);
    if (!installedBytes)
      throw new Error(
        "installed runtime file is missing from candidate archive",
      );
    if (
      !installedBytes.equals(archiveFile.bytes) ||
      sha1(installedBytes) !== archiveFile.sha1
    ) {
      throw new Error(
        "installed runtime file bytes differ from candidate archive",
      );
    }
  }
}

function parseJsonOutput(output: Buffer, label: string): unknown {
  try {
    return JSON.parse(output.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function vercelApi(pathname: string, label: string): unknown {
  const output = runCommand(
    "vercel",
    ["api", pathname, "--scope", VERCEL_SCOPE],
    label,
  );
  return parseJsonOutput(output.stdout, label);
}

function assertDeploymentSourceMatchesArchive(
  filesValue: unknown,
  archiveFiles: ReadonlyMap<string, ArchiveFile>,
): void {
  const files = flattenDeploymentFiles(filesValue);
  const roots = new Set<string>();
  let lambdaUid: string | undefined;
  for (const [fileName, record] of files) {
    roots.add(fileName.split("/", 1)[0]);
    if (fileName === "out/api/mcp") {
      if (record.type !== "lambda") {
        throw new Error("deployed out/api/mcp is not an immutable lambda");
      }
      lambdaUid = record.uid;
    }
  }
  if (roots.size !== 2 || !roots.has("src") || !roots.has("out")) {
    throw new Error("deployment file inventory must contain src and out roots");
  }
  if (!lambdaUid)
    throw new Error("deployed out/api/mcp lambda has no immutable uid");

  let missing = 0;
  let mismatch = 0;
  for (const [relativeName, archiveFile] of archiveFiles) {
    const remote = files.get(`src/${relativeName}`);
    if (!remote) {
      missing += 1;
      continue;
    }
    if (
      remote.type !== "file" ||
      !/^[a-f0-9]{40}$/u.test(remote.uid) ||
      remote.uid !== archiveFile.sha1
    ) {
      mismatch += 1;
    }
  }
  if (missing !== 0 || mismatch !== 0) {
    throw new Error(
      "immutable deployment source files differ from candidate archive",
    );
  }
}

function assertDeploymentMetadata(
  value: unknown,
  releaseCandidate: string,
): string {
  const deployment = objectValue(value, "deployment response");
  const deploymentId = nonEmptyString(deployment.id, "deployment id");
  nonEmptyString(deployment.url, "deployment url");
  if (deployment.readyState !== "READY")
    throw new Error("deployment is not ready");
  if (deployment.projectId !== VERCEL_PROJECT_ID)
    throw new Error("deployment project is not the release project");
  const metadata = objectValue(deployment.meta, "deployment metadata");
  nonEmptyString(metadata.sourceDigest, "deployment source digest");
  if (metadata.candidate !== releaseCandidate)
    throw new Error("deployment candidate does not match release candidate");
  nonEmptyString(metadata.sourceState, "deployment source state");
  if (metadata.gitDirty !== "0" && metadata.gitDirty !== "1")
    throw new Error("deployment gitDirty metadata must be 0 or 1");
  return deploymentId;
}

function assertBuildLogProof(output: CommandOutput): void {
  const buildOutput = Buffer.concat([output.stdout, output.stderr]).toString(
    "utf8",
  );
  const sdkMatch = /@modelcontextprotocol\/sdk\s+(\d+\.\d+\.\d+)/u.exec(
    buildOutput,
  );
  const sdkAtMatch = /@modelcontextprotocol\/sdk@(\d+\.\d+\.\d+)/u.exec(
    buildOutput,
  );
  if (sdkMatch?.[1] !== SDK_VERSION && sdkAtMatch?.[1] !== SDK_VERSION) {
    throw new Error("deployment logs do not prove the installed SDK version");
  }
  if (!/frozen-lockfile/iu.test(buildOutput)) {
    throw new Error("deployment logs do not prove a frozen lockfile install");
  }
}

function assertInstalledSdk(entry: string): void {
  let sdkEntry: string;
  try {
    const requireFromCandidate = createRequire(entry);
    sdkEntry = requireFromCandidate.resolve(
      "@modelcontextprotocol/sdk/server/mcp.js",
    );
  } catch {
    throw new Error("installed candidate SDK server entry cannot be resolved");
  }
  regularFile(sdkEntry, "installed SDK server entry");
  const sdkMetadata = findPackageJson(sdkEntry, SDK_PACKAGE_NAME);
  if (sdkMetadata.version !== SDK_VERSION) {
    throw new Error("installed candidate SDK version is not 1.30.0");
  }
}

async function collectRuntimeProof(): Promise<RuntimeProof> {
  const config = candidateConfig();
  const releaseCandidate = requiredEnvironment(RELEASE_ENV.candidate);
  const archiveConfig = requiredArchivePath();
  const archive = readArchiveFiles(archiveConfig.archivePath);
  if (archive.archiveSha256 !== archiveConfig.sha256) {
    throw new Error(
      "candidate archive SHA-256 does not match its explicit binding",
    );
  }
  assertInstalledRuntimeMatchesArchive(config.stdioEntry, archive);
  assertInstalledSdk(config.stdioEntry);

  const deployment = vercelApi(
    `/v13/deployments/${config.httpUrl.hostname}`,
    "deployment metadata request",
  );
  const deploymentId = assertDeploymentMetadata(deployment, releaseCandidate);
  const deploymentFiles = vercelApi(
    `/v6/deployments/${deploymentId}/files`,
    "deployment files request",
  );
  assertDeploymentSourceMatchesArchive(deploymentFiles, archive.files);
  const inspectOutput = runCommand(
    "vercel",
    ["inspect", config.httpUrl.hostname, "--logs", "--scope", VERCEL_SCOPE],
    "deployment inspect request",
  );
  assertBuildLogProof(inspectOutput);
  return {
    candidateVersion: config.version,
    archiveSha256: archive.archiveSha256,
    deploymentId,
  };
}

let verifiedRuntimeProof: RuntimeProof | undefined;

async function ensureRuntimeProof(): Promise<RuntimeProof> {
  if (verifiedRuntimeProof) return verifiedRuntimeProof;
  const proof = await collectRuntimeProof();
  verifiedRuntimeProof = proof;
  return proof;
}

async function assertLiveRuntime(kind: LiveTransportKind): Promise<void> {
  const proof = await ensureRuntimeProof();
  if (proof.candidateVersion !== EXPECTED_CANDIDATE_VERSION) {
    throw new Error("candidate runtime version proof is not 2.0.0");
  }
  await withReleaseClient(kind, async ({ client }) => {
    const listing = await client.listTools(undefined, {
      timeout: 30_000,
      maxTotalTimeout: 30_000,
    });
    expect(
      listing.tools.some((tool) => tool.name === "get_statistics_list"),
      `${kind} launched candidate tool registration`,
    ).toBe(true);
    const result = await callToolJson(client, "get_statistics_list", {
      viewCode: "MT_ZTITLE",
      parentId: "",
    });
    if (
      result.success !== true ||
      !Array.isArray(result.items) ||
      result.items.length === 0
    ) {
      throw new Error(
        `${kind} launched candidate tool call did not return data`,
      );
    }
  });
}

test(
  "REQ-S03.stdio installed release runtime and immutable source proof @live @stdio @transport @AC10",
  {
    tag: ["@REQ-S03.stdio", "@live", "@stdio", "@transport", "@AC10"],
  },
  async () =>
    runSanitizedLiveCase("REQ-S03.stdio", () => assertLiveRuntime("stdio")),
);

test(
  "REQ-S03.http deployed release runtime and immutable source proof @live @http @transport @AC10",
  {
    tag: ["@REQ-S03.http", "@live", "@http", "@transport", "@AC10"],
  },
  async () =>
    runSanitizedLiveCase("REQ-S03.http", () => assertLiveRuntime("http")),
);
