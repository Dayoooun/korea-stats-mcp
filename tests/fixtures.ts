/**
 * Playwright 테스트 Fixtures
 * MCP Inspector v0.18.0+ UI에 맞춘 연결 헬퍼
 */

import { test as base, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// 세션 토큰 파일 경로
const TOKEN_FILE = path.join(__dirname, '..', '.mcp-session-token');

/**
 * 세션 토큰 읽기
 */
function getSessionToken(): string | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
    }
  } catch {
    // 토큰 파일이 없으면 null 반환
  }
  return null;
}

/**
 * MCP Inspector 연결 설정
 */
async function connectToInspector(page: Page): Promise<boolean> {
  // Configuration 열기
  const configButton = page.getByRole('button', { name: 'Configuration' });
  if (await configButton.isVisible()) {
    await configButton.click();
  }

  // 세션 토큰 입력 (있는 경우)
  const token = getSessionToken();
  if (token) {
    const tokenInput = page.getByRole('textbox', { name: 'Proxy Session Token' });
    if (await tokenInput.isVisible()) {
      await tokenInput.fill(token);
    }
  }

  // Configuration 닫기 (다시 클릭)
  if (await configButton.getAttribute('aria-expanded') === 'true') {
    await configButton.click();
  }

  // Connect 버튼 클릭
  const connectButton = page.getByRole('button', { name: 'Connect' });
  await connectButton.click();

  // 연결 상태 확인 (최대 30초 대기)
  try {
    // "Connected" 또는 Tools 탭이 나타나면 성공
    await expect(
      page.locator('text=Tools, text=Resources, text=Connected').first()
    ).toBeVisible({ timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 연결된 상태의 테스트를 위한 확장된 test fixture
 */
export const test = base.extend<{ connectedPage: Page }>({
  connectedPage: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 연결 시도
    await connectToInspector(page);

    await use(page);
  },
});

export { expect };

/**
 * 도구 실행 헬퍼
 */
export async function runTool(
  page: Page,
  toolName: string,
  params: Record<string, string>
): Promise<void> {
  // Tools 탭 클릭
  const toolsTab = page.locator('button:has-text("Tools"), a:has-text("Tools")').first();
  if (await toolsTab.isVisible()) {
    await toolsTab.click();
  }

  // 도구 선택
  await page.locator(`text=${toolName}`).first().click();

  // 파라미터 입력
  for (const [key, value] of Object.entries(params)) {
    const input = page.locator(`input[name="${key}"], textarea[name="${key}"]`).first();
    if (await input.isVisible()) {
      await input.fill(value);
    }
  }

  // Run 버튼 클릭
  const runButton = page.getByRole('button', { name: /run/i }).first();
  await runButton.click();
}
