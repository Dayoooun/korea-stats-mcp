import { createRequire } from "node:module";

type PackageMetadata = {
  version?: unknown;
};

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json") as PackageMetadata;
const packageVersion = packageMetadata.version;

if (typeof packageVersion !== "string" || packageVersion.length === 0) {
  throw new Error("package.json must define a non-empty version");
}

export const PACKAGE_VERSION = packageVersion;
