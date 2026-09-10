import { test, expect } from "./fixtures";
import {
  candidateConfig,
  callToolJson,
  runSanitizedLiveCase,
  withReleaseClient,
} from "./release-live-client";
import { assertM06ReceiptFile } from "./release-external-evidence";
import { RELEASE_ENV } from "./requiredCases";

test.describe("MCP Inspector 2.5 connection", () => {
  test("REQ-H02 actual Inspector and provider prerequisites @live @stdio @http @AC13", async ({
    connectedPage: page,
  }) => {
    const status = page.getByTestId("connection-status");
    test.setTimeout(180_000);
    await expect(status).toHaveAttribute("data-status", "connected");
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("switch", { name: 'Connect or disconnect "node"' }),
    ).toBeChecked();
    await expect(
      page.getByText("Connection Error", { exact: true }),
    ).toHaveCount(0);
    await runSanitizedLiveCase("REQ-H02", async () => {
      const config = candidateConfig();
      const phase = process.env[RELEASE_ENV.phase]?.trim();
      if (phase === "R2" || phase === "R3") {
        const receiptPath = process.env[RELEASE_ENV.mcpClientsReceipt]?.trim();
        const candidate = process.env[RELEASE_ENV.candidate]?.trim();
        if (!receiptPath || !candidate) {
          throw new Error(
            "Claude Code and Codex prerequisite evidence is missing",
          );
        }
        assertM06ReceiptFile(receiptPath, {
          phase,
          candidate,
          targetUrl: config.httpUrl.toString(),
        });
      }
      for (const kind of ["stdio", "http"] as const) {
        await withReleaseClient(kind, async ({ client }) => {
          const catalogue = await callToolJson(client, "get_statistics_list", {
            viewCode: "MT_ZTITLE",
            parentId: "",
          });
          expect(catalogue.success, `${kind} real KOSIS prerequisite`).toBe(
            true,
          );
          if (phase === "R3") {
            const businesses = await callToolJson(client, "search_businesses", {
              regionType: "ctprvnCd",
              regionCode: "26",
              page: 1,
              pageSize: 20,
            });
            expect(
              businesses.success,
              `${kind} business access prerequisite`,
            ).toBe(true);
            expect(Number(businesses.returnedCount)).toBeGreaterThan(0);
          }
        });
      }
    });
  });

  test("disconnects the connected stdio server explicitly", async ({
    connectedPage: page,
  }) => {
    const connection = page.getByRole("switch", {
      name: 'Connect or disconnect "node"',
    });
    await connection.press("Space");
    await expect(connection).not.toBeChecked();
    await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toHaveCount(0);
  });
});
