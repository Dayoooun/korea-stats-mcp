/**
 * Shared live Playwright fixtures for the MCP Inspector.
 *
 * A live test receives a page only after the session token is present and the
 * Inspector reports a connected state. Connection failures are test failures,
 * never an implicit skip.
 */

import {
  test as base,
  expect,
  type Page,
  type Locator,
} from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const TOKEN_FILE = path.join(process.cwd(), ".mcp-session-token");
const TOKEN_ENV_NAMES = ["MCP_INSPECTOR_API_TOKEN"] as const;

export function getSessionToken(): string {
  const environmentToken = TOKEN_ENV_NAMES.map((name) =>
    process.env[name]?.trim(),
  ).find(Boolean);
  if (environmentToken) return environmentToken;

  try {
    const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (token) return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("Unable to read the Inspector session token");
    }
  }

  throw new Error("Inspector session token prerequisite is missing");
}

export function assertConnectionSucceeded(
  connected: boolean,
): asserts connected {
  if (!connected) {
    throw new Error("MCP Inspector connection prerequisite was not satisfied");
  }
}

/** Connect a page to the Inspector, throwing on every failed prerequisite. */
export async function connectToInspector(page: Page): Promise<void> {
  const token = getSessionToken();
  let stage = "loading authenticated Inspector page";
  try {
    await page.goto(`/?MCP_INSPECTOR_API_TOKEN=${encodeURIComponent(token)}`, {
      waitUntil: "domcontentloaded",
    });
    stage = "finding the server connection switch";
    const connection = page.getByRole("switch", {
      name: 'Connect or disconnect "node"',
    });
    await expect(connection).toBeVisible({ timeout: 5_000 });
    stage = "activating the server connection switch";
    if (!(await connection.isChecked())) await connection.press("Space");
    stage = "waiting for a confirmed connected state";
    await expect(page.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  } catch {
    // Navigation errors can contain the token-bearing URL.
    throw new Error(
      `MCP Inspector connection prerequisite failed while ${stage}`,
    );
  }
}

export const test = base.extend<{ connectedPage: Page }>({
  connectedPage: async ({ page }, use) => {
    await connectToInspector(page);
    await use(page);
  },
});

export { expect };

type ClipboardCaptureWindow = Window & {
  __inspectorResultCopy?: { text?: string; restore: () => void };
};

/** Capture the complete payload via the Inspector's Copy action. */
export async function copyInspectorText(
  page: Page,
  copyButton: Locator,
): Promise<string> {
  await page.evaluate(() => {
    const scope = window as ClipboardCaptureWindow;
    const originalWrite = navigator.clipboard.writeText;
    scope.__inspectorResultCopy = {
      restore: () => {
        navigator.clipboard.writeText = originalWrite;
        delete scope.__inspectorResultCopy;
      },
    };
    navigator.clipboard.writeText = async (text: string) => {
      scope.__inspectorResultCopy!.text = text;
    };
  });
  try {
    await expect(copyButton).toBeVisible({ timeout: 5_000 });
    // Ace's scrollbar can overlap Copy; activate the real button by keyboard.
    await copyButton.focus();
    await copyButton.press("Space", { timeout: 5_000 });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as ClipboardCaptureWindow).__inspectorResultCopy?.text,
        ),
      )
      .toBeTruthy();
    return await page.evaluate(
      () => (window as ClipboardCaptureWindow).__inspectorResultCopy!.text!,
    );
  } finally {
    if (!page.isClosed()) {
      await page.evaluate(() =>
        (window as ClipboardCaptureWindow).__inspectorResultCopy?.restore(),
      );
    }
  }
}

/** Run a tool through the Inspector UI and require a rendered result. */
export async function runTool(
  page: Page,
  toolName: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const toolsTab = page.getByRole("banner").getByText("Tools", { exact: true });
  await expect(toolsTab).toBeVisible({ timeout: 5_000 });
  await toolsTab.click();
  await expect(
    page.getByRole("radio", { name: "Tools", exact: true }),
  ).toBeChecked();
  const closeResults = page.getByRole("button", {
    name: "Close results",
    exact: true,
  });
  if (await closeResults.isVisible()) {
    await closeResults.click();
    await expect(
      page.getByRole("heading", { name: "Results", exact: true }),
    ).toBeHidden();
  }

  const tool = page.getByRole("button", { name: toolName, exact: true });
  await expect(tool).toBeVisible({ timeout: 5_000 });
  await tool.click();

  for (const [key, value] of Object.entries(params)) {
    const input = page.getByRole("textbox", { name: key, exact: true });
    await expect(input).toBeVisible({ timeout: 5_000 });
    if ((await input.getAttribute("aria-haspopup")) === "listbox") {
      if ((await input.inputValue()) !== value) {
        await input.click();
        const option = page.getByRole("option", { name: value, exact: true });
        await expect(option).toBeVisible({ timeout: 5_000 });
        await option.click();
      }
      await expect(input).toHaveValue(value);
    } else {
      await input.fill(value);
    }
  }

  const runButton = page.getByRole("button", {
    name: "Execute Tool",
    exact: true,
  });
  await expect(runButton).toBeVisible({ timeout: 5_000 });
  await expect(runButton).toBeEnabled();
  await runButton.click();

  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  const resultEditor = page.getByRole("textbox", { name: /^JSON content/ });
  await expect(resultEditor).toBeVisible();
  // The virtualized editor's textbox is not the complete document. Exercise its
  // Copy action, capturing writeText without changing the host clipboard.
  return JSON.parse(
    await copyInspectorText(
      page,
      page.getByRole("button", { name: "Copy", exact: true }),
    ),
  ) as Record<string, unknown>;
}
