/**
 * MCP tool tests for the live Inspector project.
 *
 * Connection is provided by the shared connectedPage fixture. A missing token,
 * rejected connection, or missing tool is an ordinary test failure.
 */

import { test, expect, runTool } from "./fixtures";

test.describe("MCP Tools 테스트", () => {
  test("도구 목록 확인 - 개발본 14개 도구 존재", async ({ connectedPage }) => {
    const toolsTab = connectedPage
      .getByRole("banner")
      .getByText("Tools", { exact: true });
    await expect(toolsTab).toBeVisible();
    await toolsTab.click();
    await expect(
      connectedPage.getByRole("radio", { name: "Tools", exact: true }),
    ).toBeChecked();

    const expectedTools = [
      "quick_stats",
      "quick_trend",
      "search_statistics",
      "get_statistics_list",
      "get_statistics_data",
      "compare_statistics",
      "analyze_time_series",
      "get_recommended_statistics",
      "get_table_info",
      "search_indicators",
      "get_indicator",
      "search_businesses",
      "search_microdata",
      "get_microdata_info",
    ];

    for (const toolName of expectedTools) {
      await expect(
        connectedPage.getByRole("button", { name: toolName, exact: true }),
      ).toBeVisible({
        timeout: 10_000,
      });
    }
  });

  test("search_statistics - 한글 키워드 검색", async ({ connectedPage }) => {
    const result = await runTool(connectedPage, "search_statistics", {
      query: "인구",
    });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.results)).toBe(true);
    expect((result.results as unknown[]).length).toBeGreaterThan(0);
  });

  test("get_table_info - 통계표 정보 실제 조회", async ({ connectedPage }) => {
    // This intentionally invokes the tool; a description-only UI check is not
    // evidence that W5 has registered or implemented the metadata path.
    const result = await runTool(connectedPage, "get_table_info", {
      orgId: "101",
      tableId: "DT_1B04005",
      infoType: "ITM",
    });
    expect(result.success).toBe(true);
    expect(typeof result.returnedCount).toBe("number");
    expect(result.returnedCount as number).toBeGreaterThan(0);
    const periods = await runTool(connectedPage, "get_table_info", {
      orgId: "101",
      tableId: "DT_1B04005",
      infoType: "PRD",
    });
    expect(periods.success).toBe(true);
    expect(periods.infoType).toBe("PRD");
    expect(periods.returnedCount as number).toBeGreaterThan(0);
    expect(
      (periods.rawData as Record<string, unknown>[]).every(
        (row) => row.PRD_SE !== undefined,
      ),
    ).toBe(true);
  });

  test("get_statistics_list - 주제별 통계 목록 실제 조회", async ({
    connectedPage,
  }) => {
    const result = await runTool(connectedPage, "get_statistics_list", {
      viewCode: "MT_ZTITLE",
    });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.items)).toBe(true);
    expect((result.items as unknown[]).length).toBeGreaterThan(0);
  });
});
