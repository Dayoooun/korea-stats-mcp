import { test } from "@playwright/test";
import {
  assertM06ReceiptFile,
  assertS04ReceiptFile,
  type ExternalReceiptContext,
} from "./release-external-evidence";
import { RELEASE_ENV, parseReleasePhase } from "./requiredCases";
import { runSanitizedLiveCase } from "./release-live-client";

test.setTimeout(180_000);

function receiptContext(): ExternalReceiptContext {
  const phase = parseReleasePhase(process.env[RELEASE_ENV.phase]?.trim());
  if (!phase)
    throw new Error("external receipt requires an explicit release phase");
  const candidate = process.env[RELEASE_ENV.candidate]?.trim();
  if (!candidate)
    throw new Error("external receipt requires an explicit release candidate");
  return { phase, candidate };
}

function receiptPath(name: "keyRevocation" | "mcpClients"): string {
  const path =
    process.env[
      name === "keyRevocation"
        ? RELEASE_ENV.keyRevocationReceipt
        : RELEASE_ENV.mcpClientsReceipt
    ]?.trim();
  if (!path) {
    const label = name === "mcpClients" ? "Claude Code and Codex" : name;
    throw new Error(`${label} external receipt path is required`);
  }
  return path;
}

// S04 is cumulative and therefore registered in every release phase. Missing or
// malformed operator evidence fails the case; it is never converted into a skip.
test(
  "REQ-S04 external KOSIS key revocation evidence @live @stdio @AC10",
  { tag: ["@REQ-S04", "@live", "@stdio", "@AC10"] },
  async () =>
    runSanitizedLiveCase("REQ-S04", async () => {
      assertS04ReceiptFile(receiptPath("keyRevocation"), receiptContext());
    }),
);

// Claude Code and Codex evidence is ordinary from R2 onward. R1 intentionally
// registers no M06 case; this is a registration boundary, not a skip/refusal path.
const requestedPhase = process.env[RELEASE_ENV.phase]?.trim();
if (requestedPhase !== "R1") {
  test(
    "REQ-M06 Claude Code and Codex MCP client receipt evidence @live @http @AC11",
    { tag: ["@REQ-M06", "@live", "@http", "@AC11"] },
    async () =>
      runSanitizedLiveCase("REQ-M06", async () => {
        assertM06ReceiptFile(receiptPath("mcpClients"), receiptContext());
      }),
  );
}
