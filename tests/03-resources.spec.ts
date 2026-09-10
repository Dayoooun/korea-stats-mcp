/**
 * MCP resource and prompt tests for the installed MCP Inspector 2.5 UI.
 *
 * Resource assertions read the returned payload through the Inspector's Copy
 * action. The virtualized editor is intentionally not treated as the document.
 */

import { test, expect, copyInspectorText } from "./fixtures";

const RESOURCES = [
  {
    name: "category-tree",
    uri: "kosis://categories/tree",
    verify(payload: Record<string, unknown>): void {
      expect(payload.name).toBe("정적 참고용 KOSIS 통계 분류 안내");
      expect(payload.description).toBe(
        "통계 탐색을 위한 정적 분류 안내이며 공식 전체 분류의 실시간 조회가 아닙니다.",
      );
      expect(payload.metadataStatus).toBe("static_reference");
      expect(payload.lastUpdatedSemantics).toBe(
        "안내를 생성한 날짜이며, 공식 분류의 갱신 시점이 아닙니다.",
      );
      expect(Array.isArray(payload.categories)).toBe(true);
      expect((payload.categories as unknown[]).length).toBeGreaterThan(0);
    },
  },
  {
    name: "key-indicators",
    uri: "kosis://indicators/list",
    verify(payload: Record<string, unknown>): void {
      expect(payload.name).toBe("주요 경제사회 지표");
      expect(typeof payload.description).toBe("string");
      expect((payload.description as string).length).toBeGreaterThan(0);
      expect(payload.metadataStatus).toBe("static_reference");
      expect(payload.lastUpdatedSemantics).toBe(
        "목록을 생성한 날짜이며, 통계값의 최신 시점이 아닙니다.",
      );
      expect(Array.isArray(payload.indicators)).toBe(true);
      const indicators = payload.indicators as Array<Record<string, unknown>>;
      expect(indicators.length).toBeGreaterThan(0);
      expect(indicators.some((indicator) => indicator.name === "총인구")).toBe(
        true,
      );
    },
  },
] as const;

const PROMPT_NAMES = ["statistics_assistant"] as const;

async function openResources(
  page: import("@playwright/test").Page,
): Promise<void> {
  const resourcesTab = page
    .getByRole("banner")
    .getByText("Resources", { exact: true });
  await expect(resourcesTab).toBeVisible({ timeout: 5_000 });
  await resourcesTab.click();
  await expect(
    page.getByRole("radio", { name: "Resources", exact: true }),
  ).toBeChecked();
  const screen = page.getByTestId("resources-screen");
  await expect(screen).toBeVisible({ timeout: 5_000 });
  await expect(screen).toHaveAttribute(
    "data-resource-count",
    String(RESOURCES.length),
    {
      timeout: 15_000,
    },
  );
}

async function readResource(
  page: import("@playwright/test").Page,
  resource: (typeof RESOURCES)[number],
): Promise<Record<string, unknown>> {
  const resourceButton = page.getByRole("button", {
    name: resource.name,
    exact: true,
  });
  const uriSection = page.getByRole("button", {
    name: `URIs (${RESOURCES.length})`,
    exact: true,
  });
  await expect(uriSection).toBeVisible({ timeout: 5_000 });
  if (!(await resourceButton.isVisible())) await uriSection.click();
  await expect(resourceButton).toBeVisible({ timeout: 5_000 });
  await resourceButton.click();

  const preview = page.getByTestId("resource-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByText(resource.uri, { exact: true })).toBeVisible();
  const copies = preview.getByRole("button", { name: "Copy", exact: true });
  // Inspector 2.5 renders URI copy first, then the complete JSON document copy.
  await expect(copies).toHaveCount(2);
  return JSON.parse(await copyInspectorText(page, copies.last())) as Record<
    string,
    unknown
  >;
}

test.describe("MCP Resources 테스트", () => {
  test("리소스 목록과 실제 반환 내용 확인", async ({ connectedPage }) => {
    await openResources(connectedPage);

    for (const resource of RESOURCES) {
      const payload = await readResource(connectedPage, resource);
      resource.verify(payload);
    }
  });
});

test.describe("MCP Prompts 테스트", () => {
  test("프롬프트 목록 확인", async ({ connectedPage }) => {
    const promptsTab = connectedPage
      .getByRole("banner")
      .getByText("Prompts", { exact: true });
    await expect(promptsTab).toBeVisible({ timeout: 5_000 });
    await promptsTab.click();
    await expect(
      connectedPage.getByRole("radio", { name: "Prompts", exact: true }),
    ).toBeChecked();

    const screen = connectedPage.getByTestId("prompts-screen");
    await expect(screen).toBeVisible({ timeout: 5_000 });
    await expect(screen).toHaveAttribute(
      "data-prompt-count",
      String(PROMPT_NAMES.length),
      {
        timeout: 15_000,
      },
    );
    await expect(
      connectedPage.getByRole("button", {
        name: new RegExp(PROMPT_NAMES[0]),
        exact: false,
      }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
