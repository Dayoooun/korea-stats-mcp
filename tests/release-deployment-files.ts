export const MAX_DEPLOYMENT_TREE_DEPTH = 64;
export const MAX_DEPLOYMENT_TREE_NODES = 4_096;

export type DeploymentFileType = "file" | "lambda";

export type DeploymentFileRecord = Readonly<{
  readonly type: DeploymentFileType;
  readonly uid: string;
}>;

type DeploymentTreeRecord = Record<string, unknown>;

function deploymentRecord(value: unknown, label: string): DeploymentTreeRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as DeploymentTreeRecord;
}

function deploymentName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} name is missing`);
  }
  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw new Error(`${label} name is unsafe`);
  }
  return value;
}

function deploymentMode(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} mode is invalid`);
  }
  return value;
}

function deploymentUid(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} uid is missing`);
  }
  if (value !== value.trim()) {
    throw new Error(`${label} uid is invalid`);
  }
  return value;
}

function deploymentType(
  value: unknown,
  label: string,
): "directory" | DeploymentFileType {
  if (value !== "directory" && value !== "file" && value !== "lambda") {
    throw new Error(`${label} type is invalid`);
  }
  return value;
}

/**
 * Flatten the authenticated Vercel deployment tree without accepting legacy
 * flat or wrapped response shapes. Every node is checked before its leaves are
 * returned, and paths are assembled from validated single-name segments.
 */
export function flattenDeploymentFiles(
  value: unknown,
  label = "deployment files",
): Map<string, DeploymentFileRecord> {
  if (!Array.isArray(value)) {
    throw new Error(`${label} response must be a tree array`);
  }
  if (value.length !== 2) {
    throw new Error(`${label} response must contain src and out roots`);
  }

  const files = new Map<string, DeploymentFileRecord>();
  const paths = new Set<string>();
  const roots = new Set<string>();
  let nodeCount = 0;

  const visit = (
    valueToVisit: unknown,
    parentPath: string,
    depth: number,
  ): void => {
    if (depth > MAX_DEPLOYMENT_TREE_DEPTH) {
      throw new Error(`${label} response exceeds maximum depth`);
    }
    nodeCount += 1;
    if (nodeCount > MAX_DEPLOYMENT_TREE_NODES) {
      throw new Error(`${label} response exceeds maximum node count`);
    }

    const record = deploymentRecord(valueToVisit, `${label} node`);
    const name = deploymentName(record.name, `${label} node`);
    const type = deploymentType(record.type, `${label} ${name}`);
    deploymentMode(record.mode, `${label} ${name}`);
    const fullPath = parentPath.length === 0 ? name : `${parentPath}/${name}`;
    if (paths.has(fullPath)) {
      throw new Error(`${label} response contains duplicate paths`);
    }
    paths.add(fullPath);

    if (parentPath.length === 0) {
      if (type !== "directory")
        throw new Error(`${label} root must be a directory`);
      roots.add(name);
    }

    if (type === "directory") {
      const hasChildren = Object.prototype.hasOwnProperty.call(
        record,
        "children",
      );
      if (hasChildren && !Array.isArray(record.children)) {
        throw new Error(`${label} ${fullPath} children are invalid`);
      }
      if (Object.prototype.hasOwnProperty.call(record, "uid")) {
        throw new Error(`${label} ${fullPath} directory has a uid`);
      }
      if (Array.isArray(record.children)) {
        for (const child of record.children) visit(child, fullPath, depth + 1);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(record, "children")) {
      throw new Error(`${label} ${fullPath} leaf has children`);
    }
    const uid = deploymentUid(record.uid, `${label} ${fullPath}`);
    files.set(fullPath, { type, uid });
  };

  for (const root of value) visit(root, "", 1);
  if (!roots.has("src") || !roots.has("out") || roots.size !== 2) {
    throw new Error(`${label} response must contain src and out roots`);
  }
  return files;
}
