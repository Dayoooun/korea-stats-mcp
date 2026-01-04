/**
 * MCP Tools 테스트
 * MCP Inspector v0.18.0+ UI에 맞춤
 * 참고: 이 테스트들은 MCP 서버 연결이 필요합니다.
 */

import { test, expect, Page } from '@playwright/test';

// MCP Inspector에 연결하는 헬퍼 함수 (v0.18.0+ 호환)
async function connectToMCPServer(page: Page): Promise<boolean> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Connect 버튼 클릭
  const connectButton = page.getByRole('button', { name: 'Connect' });
  await connectButton.click();

  // 연결 성공 확인 (Tools 탭이 나타나면 성공)
  try {
    await expect(page.locator('button:has-text("Tools"), [role="tab"]:has-text("Tools")').first()).toBeVisible({
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

test.describe('MCP Tools 테스트', () => {
  test.beforeEach(async ({ page }) => {
    const connected = await connectToMCPServer(page);
    if (!connected) {
      test.skip(true, 'MCP 서버 연결 필요 - 세션 토큰 설정 확인');
    }
  });

  test('도구 목록 확인 - 7개 도구 존재', async ({ page }) => {
    // Tools 탭 클릭
    const toolsTab = page.locator('button:has-text("Tools")').first();
    await toolsTab.click();

    // 각 도구가 표시되는지 확인 (get_table_info 추가됨)
    const expectedTools = [
      'search_statistics',
      'get_statistics_list',
      'get_statistics_data',
      'compare_statistics',
      'analyze_time_series',
      'get_recommended_stats',
      'get_table_info',
    ];

    for (const toolName of expectedTools) {
      await expect(page.locator(`text=${toolName}`).first()).toBeVisible({
        timeout: 10000,
      });
    }
  });

  test('search_statistics - 한글 키워드 검색', async ({ page }) => {
    // Tools 탭 클릭
    await page.locator('button:has-text("Tools")').first().click();

    // search_statistics 도구 선택
    await page.locator('text=search_statistics').first().click();

    // keyword 입력 필드 찾기 및 입력
    const keywordInput = page.locator('input, textarea').first();
    await keywordInput.fill('인구');

    // Run Tool 버튼 클릭
    const runButton = page.locator('button:has-text("Run")').first();
    await runButton.click();

    // 결과 대기 (최대 30초)
    await page.waitForTimeout(5000);

    // 결과에 데이터가 있는지 확인
    await expect(page.locator('text=/success|results|Tool Result/i').first()).toBeVisible({ timeout: 30000 });
  });

  test('get_table_info - 통계표 정보 조회', async ({ page }) => {
    // Tools 탭 클릭
    await page.locator('button:has-text("Tools")').first().click();

    // get_table_info 도구 선택
    await page.locator('text=get_table_info').first().click();

    // 도구가 표시되는지 확인
    await expect(page.locator('text=get_table_info')).toBeVisible();

    // 도구 설명 확인
    await expect(page.locator('text=/분류|항목|코드|objL1|itmId/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('get_statistics_list - 주제별 통계 목록 조회', async ({ page }) => {
    // Tools 탭 클릭
    await page.locator('button:has-text("Tools")').first().click();

    // get_statistics_list 도구 선택
    await page.locator('text=get_statistics_list').first().click();

    // Run Tool 버튼 클릭 (기본값 사용)
    const runButton = page.locator('button:has-text("Run")').first();
    await runButton.click();

    // 결과 대기
    await page.waitForTimeout(5000);

    // 성공 결과 확인
    const resultArea = page.locator('pre, code, [class*="result"]').first();
    await expect(resultArea).toBeVisible({ timeout: 30000 });
  });
});
