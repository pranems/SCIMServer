/**
 * Custom Jest Reporter — writes a structured JSON results file.
 *
 * Output format mirrors the SCIM Validator results style:
 * - Top-level metadata: run info, timing, counts
 * - Per-suite and per-test entries with status, duration, and failure details
 *
 * Output file: <repoRoot>/test-results/e2e-results-<timestamp>.json
 */
import type {
  Reporter,
  ReporterOnStartOptions,
  Test,
  TestResult,
} from '@jest/reporters';
import type { AggregatedResult, TestContext } from '@jest/test-result';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  getE2eFlowTrace,
  resetE2eFlowTrace,
  type E2eFlowStep,
} from '../helpers/flow-trace.helper.ts';

interface TestEntry {
  suite: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending' | 'todo';
  durationMs: number | null;
  actionStepIds?: number[];
  failureMessages?: string[];
}

interface SuiteSummary {
  name: string;
  file: string;
  status: 'passed' | 'failed';
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

interface ResultsJson {
  testRunner: string;
  version: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  durationFormatted: string;
  environment: {
    node: string;
    platform: string;
    arch: string;
    hostname: string;
    persistenceBackend: string;
    jestVersion: string;
  };
  summary: {
    totalSuites: number;
    passedSuites: number;
    failedSuites: number;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    pending: number;
    todo: number;
    successRate: string;
  };
  suites: SuiteSummary[];
  tests: TestEntry[];
  flowSteps: E2eFlowStep[];
}

class JsonResultsReporter implements Reporter {
  private startTime: Date = new Date();

  onRunStart(
    _results: AggregatedResult,
    _options: ReporterOnStartOptions,
  ): void {
    this.startTime = new Date();
    resetE2eFlowTrace();
  }

  onTestStart(_test: Test): void {
    // no-op
  }

  onTestResult(
    _test: Test,
    _testResult: TestResult,
    _aggregatedResult: AggregatedResult,
  ): void {
    // no-op — we process everything in onRunComplete
  }

  onRunComplete(
    _testContexts: Set<TestContext>,
    results: AggregatedResult,
  ): void {
    const finishTime = new Date();
    const durationMs = finishTime.getTime() - this.startTime.getTime();
    const runId = `e2e-${finishTime.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)}`;
    const flowSteps = getE2eFlowTrace();

    // Collect all tests and suites
    const tests: TestEntry[] = [];
    const suites: SuiteSummary[] = [];

    for (const suiteResult of results.testResults) {
      const suiteName = path.basename(suiteResult.testFilePath, '.e2e-spec.ts');
      const suiteFile = path
        .relative(
          path.resolve(process.cwd()),
          suiteResult.testFilePath,
        )
        .replace(/\\/g, '/');

      let suitePassed = 0;
      let suiteFailed = 0;
      let suiteSkipped = 0;

      for (const testCase of suiteResult.testResults) {
        const status = testCase.status as TestEntry['status'];
        const actionStepIds = flowSteps
          .filter((f) => f.testName === (testCase.fullName || testCase.title))
          .map((f) => f.stepId);
        const entry: TestEntry = {
          suite: suiteName,
          name: testCase.fullName || testCase.title,
          status,
          durationMs: testCase.duration ?? null,
          actionStepIds: actionStepIds.length > 0 ? actionStepIds : undefined,
        };
        if (
          status === 'failed' &&
          testCase.failureMessages &&
          testCase.failureMessages.length > 0
        ) {
          entry.failureMessages = testCase.failureMessages.map((m) =>
            m.substring(0, 500),
          );
        }
        tests.push(entry);

        if (status === 'passed') suitePassed++;
        else if (status === 'failed') suiteFailed++;
        else suiteSkipped++;
      }

      suites.push({
        name: suiteName,
        file: suiteFile,
        status: suiteFailed > 0 ? 'failed' : 'passed',
        tests: suiteResult.testResults.length,
        passed: suitePassed,
        failed: suiteFailed,
        skipped: suiteSkipped,
        durationMs: suiteResult.perfStats
          ? suiteResult.perfStats.end - suiteResult.perfStats.start
          : 0,
      });
    }

    const totalTests =
      results.numPassedTests +
      results.numFailedTests +
      results.numPendingTests +
      results.numTodoTests;
    const successRate =
      totalTests > 0
        ? ((results.numPassedTests / totalTests) * 100).toFixed(1)
        : '0.0';

    const jestPkg = this.readJestVersion();

    const output: ResultsJson = {
      testRunner: 'Jest E2E (SCIMServer)',
      version: this.readAppVersion(),
      runId,
      startedAt: this.startTime.toISOString(),
      finishedAt: finishTime.toISOString(),
      durationMs,
      durationFormatted: this.formatDuration(durationMs),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        persistenceBackend:
          process.env.PERSISTENCE_BACKEND?.toLowerCase() ?? 'prisma',
        jestVersion: jestPkg,
      },
      summary: {
        totalSuites: results.numTotalTestSuites,
        passedSuites: results.numPassedTestSuites,
        failedSuites: results.numFailedTestSuites,
        totalTests,
        passed: results.numPassedTests,
        failed: results.numFailedTests,
        skipped: results.numPendingTests,
        pending: results.numPendingTests,
        todo: results.numTodoTests,
        successRate: `${successRate}%`,
      },
      suites,
      tests,
      flowSteps,
    };

    // Write to test-results directory (repo root = cwd's parent since cwd is api/)
    const outDir = path.resolve(process.cwd(), '..', 'test-results');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outFile = path.join(outDir, `${runId}.json`);
    fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');

    // Also write a "latest" symlink-style copy
    const latestFile = path.join(outDir, 'e2e-results-latest.json');
    fs.writeFileSync(latestFile, JSON.stringify(output, null, 2), 'utf-8');

    console.log(`\n📊 E2E results JSON written to: ${path.relative(process.cwd(), outFile)}`);
  }

  private readAppVersion(): string {
    try {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  private readJestVersion(): string {
    try {
      const jestPkgPath = require.resolve('jest/package.json');
      const pkg = JSON.parse(fs.readFileSync(jestPkgPath, 'utf-8'));
      return pkg.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private formatDuration(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const millis = ms % 1000;
    if (mins > 0) return `${mins}m ${secs}.${String(millis).padStart(3, '0')}s`;
    return `${secs}.${String(millis).padStart(3, '0')}s`;
  }
}

export default JsonResultsReporter;
