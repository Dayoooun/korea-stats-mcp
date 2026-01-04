import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // API 호출 제한으로 순차 실행
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html'], ['list']],
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:6274',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm run inspector',
    url: 'http://localhost:6274',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
