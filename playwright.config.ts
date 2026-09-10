import { defineConfig, devices } from "@playwright/test";

const selectedProjects = process.argv.flatMap((argument, index) => {
  if (argument.startsWith("--project="))
    return argument.slice("--project=".length).split(",");
  if (argument === "--project")
    return process.argv[index + 1]?.split(",") ?? [];
  return [];
});
const selectingWithoutInspector =
  (selectedProjects.length > 0 &&
    selectedProjects.every(
      (name) => name === "offline" || name === "release-live",
    )) ||
  (process.argv.some((argument) =>
    /(?:harness-prerequisites|release-(?:offline|transport|indicators|locality|metadata|businesses|analysis|microdata|aggregate|external|runtime|lifecycle))\.spec\.ts/.test(
      argument,
    ),
  ) &&
    !selectedProjects.includes("live"));

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html"], ["list"], ["./tests/acceptanceReporter.ts"]],
  timeout: 60000,
  // Direct SDK admission and offline tests do not launch the Inspector UI.
  globalSetup: selectingWithoutInspector ? undefined : "./tests/globalSetup.ts",
  use: {
    baseURL: "http://localhost:6274",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "offline",
      testMatch: /(?:harness-prerequisites|release-offline)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "live",
      testMatch: /\.spec\.ts/,
      testIgnore:
        /(?:harness-prerequisites|release-(?:offline|transport|indicators|locality|metadata|businesses|analysis|microdata|aggregate|external|runtime|lifecycle))\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "release-live",
      testMatch:
        /release-(?:transport|indicators|locality|metadata|businesses|analysis|microdata|aggregate|external|runtime|lifecycle)\.spec\.ts/,
      use: { trace: "off", screenshot: "off" },
    },
  ],
});
