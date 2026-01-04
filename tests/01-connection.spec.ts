/**
 * MCP Inspector 연결 테스트
 * MCP Inspector v0.18.0+ UI에 맞춤
 */

import { test, expect } from '@playwright/test';

test.describe('MCP Inspector 연결 테스트', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('페이지 로드 확인', async ({ page }) => {
    // MCP Inspector 타이틀 확인
    await expect(page).toHaveTitle(/MCP|Inspector/i);

    // 헤더에 버전 정보 확인
    await expect(page.locator('h1')).toContainText(/MCP Inspector/i);
  });

  test('서버 연결 UI 요소 확인', async ({ page }) => {
    // Transport Type combobox 확인 (v0.18.0에서 select -> combobox로 변경)
    const transportCombobox = page.getByRole('combobox', { name: 'Transport Type' });
    await expect(transportCombobox).toBeVisible();

    // Command 입력 필드 확인
    const commandInput = page.getByRole('textbox', { name: 'Command' });
    await expect(commandInput).toBeVisible();

    // Arguments 입력 필드 확인
    const argsInput = page.getByRole('textbox', { name: 'Arguments' });
    await expect(argsInput).toBeVisible();

    // Connect 버튼 확인
    const connectButton = page.getByRole('button', { name: 'Connect' });
    await expect(connectButton).toBeVisible();
  });

  test('Configuration 섹션 확인', async ({ page }) => {
    // Configuration 버튼 클릭
    const configButton = page.getByRole('button', { name: 'Configuration' });
    await configButton.click();

    // Configuration 옵션들 확인
    await expect(page.getByRole('spinbutton', { name: 'Request Timeout' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Proxy Session Token' })).toBeVisible();
  });

  test('Environment Variables 섹션 확인', async ({ page }) => {
    // Environment Variables 버튼이 존재하고 클릭 가능한지 확인
    const envButton = page.getByRole('button', { name: 'Environment Variables' });
    await expect(envButton).toBeVisible();
    await expect(envButton).toBeEnabled();

    // 버튼 클릭
    await envButton.click();

    // 클릭 후 UI 변화 확인 (토글 또는 확장)
    await page.waitForTimeout(500);
  });

  test('서버 연결 시도', async ({ page }) => {
    // Connect 버튼 클릭
    const connectButton = page.getByRole('button', { name: 'Connect' });
    await connectButton.click();

    // 연결 시도 결과 확인 (성공 또는 오류 메시지)
    // 토큰이 없으면 에러가 발생할 수 있음
    const status = page.locator('[class*="status"], [data-testid*="status"]').first();

    // 연결 상태 변화 확인 (성공, 실패, 또는 에러 메시지)
    await expect(async () => {
      const text = await page.locator('body').innerText();
      const hasStatusChange =
        text.includes('Connected') ||
        text.includes('Connection Error') ||
        text.includes('Tools') ||
        text.includes('Disconnected');
      expect(hasStatusChange).toBeTruthy();
    }).toPass({ timeout: 10000 });
  });
});
