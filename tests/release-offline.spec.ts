import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { RELEASE_ENV } from './requiredCases';

const repositoryRoot = process.cwd();
const probe = path.join(repositoryRoot, 'tests', 'release-probe.mjs');
const releaseEnvironmentNames = Object.values(RELEASE_ENV);

test.setTimeout(120_000);

type ProbeOptions = {
  readonly expectedStatus?: number;
  readonly environment?: NodeJS.ProcessEnv;
};

function scrubReleaseEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of releaseEnvironmentNames) delete environment[name];
  return environment;
}

function runProbe(command: string | readonly string[], options: ProbeOptions = {}): ReturnType<typeof spawnSync> {
  const args = typeof command === 'string' ? [command] : [...command];
  const label = args.join(' ');
  const result = spawnSync(process.execPath, [probe, ...args], {
    cwd: repositoryRoot,
    env: options.environment ?? scrubReleaseEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(result.error, `${label} probe could not start`).toBeUndefined();
  expect(result.status, `${label} probe status`).toBe(options.expectedStatus ?? 0);
  return result;
}

function runNegativeGateProbe(kind: string): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'korea-stats-negative-gate-'));
  const reportPath = path.join(directory, `${kind}.json`);
  const environment = scrubReleaseEnvironment();
  // A negative probe owns an isolated report path and can never overwrite the
  // outer release report, even when this spec is nested in a release run.
  environment[RELEASE_ENV.phase] = 'R1';
  environment[RELEASE_ENV.candidate] = 'offline-negative-probe';
  environment[RELEASE_ENV.prerequisite] = 'true';
  environment[RELEASE_ENV.reportPath] = reportPath;
  try {
    runProbe(['admission-gate', kind], { expectedStatus: 1, environment });
    expect(fs.existsSync(reportPath)).toBe(false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test.describe('W16b offline release admission', () => {
  test('REQ-H01 offline prerequisite and fixture independence @offline @stdio @AC13', {
    tag: ['@REQ-H01', '@AC13', '@offline', '@stdio'],
  }, () => {
    runProbe('h01');
  });

  test('REQ-H03 failure-injection children are nonzero for every Inspector startup failure @offline @stdio @AC13', {
    tag: ['@REQ-H03', '@AC13', '@offline', '@stdio'],
  }, () => {
    runProbe('h03');
  });

  test('REQ-H04 manifest and count failures make the release gate nonzero @offline @stdio @AC13', {
    tag: ['@REQ-H04', '@AC13', '@offline', '@stdio'],
  }, () => {
    for (const kind of ['missing', 'skip', 'zero', 'reportmissing']) runNegativeGateProbe(kind);
  });

  test('REQ-S01 configuration, redaction, bundle, and documentation stay credential-free @offline @stdio @AC10', {
    tag: ['@REQ-S01', '@AC10', '@offline', '@stdio'],
  }, () => {
    runProbe('s01');
  });

  test('REQ-S02 SDK declaration and lockfile reproduce in an isolated frozen install @offline @stdio @AC10', {
    tag: ['@REQ-S02', '@AC10', '@offline', '@stdio'],
  }, () => {
    runProbe('s02');
  });
  if (process.env[RELEASE_ENV.phase]?.trim() !== 'R1') {
    test('REQ-M07 official metadata axes and hierarchy remain evidence-backed @offline @stdio @AC2 @AC11', {
      tag: ['@REQ-M07', '@AC2', '@AC11', '@offline', '@stdio'],
    }, () => {
      runProbe('m07');
    });

    test('REQ-Q01 selectors and cache entries remain independently isolated @offline @stdio @AC3', {
      tag: ['@REQ-Q01', '@AC3', '@offline', '@stdio'],
    }, () => {
      runProbe('q01');
    });

    test('REQ-Q02 annual, period, sign, missing, and unit observations stay fail-closed @offline @stdio @AC4', {
      tag: ['@REQ-Q02', '@AC4', '@offline', '@stdio'],
    }, () => {
      runProbe('q02');
    });
  }
});
