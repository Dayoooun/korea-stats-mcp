/**
 * MCP Resources 및 Prompts 테스트
 * MCP Inspector v0.18.0+ UI에 맞춤
 */

import { test, expect, Page } from '@playwright/test';

// MCP Inspector에 연결하는 헬퍼 함수 (v0.18.0+ 호환)
async function connectToMCPServer(page: Page): Promise<boolean> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Connect 버튼 클릭
  const connectButton = page.getByRole('button', { name: 'Connect' });
  await connectButton.click();

  // 연결 성공 확인 (Resources 탭이 나타나면 성공)
  try {
    await expect(page.locator('button:has-text("Resources"), [role="tab"]:has-text("Resources")').first()).toBeVisible({
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

test.describe('MCP Resources 테스트', () => {
  test.beforeEach(async ({ page }) => {
    const connected = await connectToMCPServer(page);
    if (!connected) {
      test.skip(true, 'MCP 서버 연결 필요 - 세션 토큰 설정 확인');
    }
  });

  test('리소스 목록 확인', async ({ page }) => {
    // Resources 탭 클릭
    const resourcesTab = page.locator('button:has-text("Resources")').first();
    await resourcesTab.click();

    // 리소스 목록 버튼 또는 리소스가 표시되는지 확인
    const listButton = page.locator('button:has-text("List")').first();
    if (await listButton.isVisible()) {
      await listButton.click();
      await page.waitForTimeout(3000);
    }

    // 리소스가 표시되는지 확인 (URI 패턴)
    await expect(page.locator('text=/kosis|category|indicator/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('카테고리 트리 리소스 확인', async ({ page }) => {
    // Resources 탭 클릭
    await page.locator('button:has-text("Resources")').first().click();

    // List 버튼 클릭 (있는 경우)
    const listButton = page.locator('button:has-text("List")').first();
    if (await listButton.isVisible()) {
      await listButton.click();
      await page.waitForTimeout(3000);
    }

    // category-tree 리소스 확인
    await expect(page.locator('text=/category.*tree|categories/i').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('MCP Prompts 테스트', () => {
  test.beforeEach(async ({ page }) => {
    const connected = await connectToMCPServer(page);
    if (!connected) {
      test.skip(true, 'MCP 서버 연결 필요 - 세션 토큰 설정 확인');
    }
  });

  test('프롬프트 목록 확인', async ({ page }) => {
    // Prompts 탭 클릭
    const promptsTab = page.locator('button:has-text("Prompts")').first();
    await promptsTab.click();

    // statistics_assistant 프롬프트 확인
    await expect(page.locator('text=/statistics.*assistant|assistant/i').first()).toBeVisible({
      timeout: 10000,
    });
  });
});
