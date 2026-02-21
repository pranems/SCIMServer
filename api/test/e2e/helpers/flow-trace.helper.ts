import * as fs from 'fs';
import * as path from 'path';

type HeaderMap = Record<string, string | string[] | undefined>;

export interface E2eFlowStep {
  stepId: number;
  actionStep: string;
  testName: string;
  suiteName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  response?: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
  error?: {
    message: string;
    body?: unknown;
  };
}

let flowStepCounter = 0;
let flowSteps: E2eFlowStep[] = [];
const traceFilePath = path.resolve(process.cwd(), '..', 'test-results', '.e2e-flow-steps.ndjson');

function ensureTraceDir(): void {
  const dir = path.dirname(traceFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function stringifyValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

function normalizeHeaders(headers?: HeaderMap): Record<string, string> | undefined {
  if (!headers) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (key.toLowerCase() === 'authorization') {
      normalized[key] = 'Bearer ***';
      continue;
    }
    normalized[key] = stringifyValue(value);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function safeBody(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    return value.length > 3000 ? `${value.substring(0, 3000)}...` : value;
  }
  try {
    const json = JSON.stringify(value);
    if (json.length <= 3000) return value;
    return `${json.substring(0, 3000)}...`;
  } catch {
    return String(value);
  }
}

export function resetE2eFlowTrace(): void {
  flowStepCounter = 0;
  flowSteps = [];
  ensureTraceDir();
  fs.writeFileSync(traceFilePath, '', 'utf-8');
}

export function getE2eFlowTrace(): E2eFlowStep[] {
  if (flowSteps.length > 0) {
    return [...flowSteps];
  }
  if (!fs.existsSync(traceFilePath)) {
    return [];
  }
  const fileContent = fs.readFileSync(traceFilePath, 'utf-8').trim();
  if (!fileContent) {
    return [];
  }
  const parsed = fileContent
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as E2eFlowStep;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is E2eFlowStep => entry !== null);
  flowSteps = parsed;
  return [...flowSteps];
}

export function getCurrentJestContext(): { testName: string; suiteName: string } {
  const fallback = { testName: 'unknown', suiteName: 'unknown' };
  const expectGlobal = (globalThis as { expect?: { getState?: () => { currentTestName?: string; testPath?: string } } }).expect;
  if (!expectGlobal?.getState) return fallback;
  const state = expectGlobal.getState();
  const testName = state.currentTestName ?? 'unknown';
  const suiteName = state.testPath ? state.testPath.split(/[\\/]/).pop() ?? 'unknown' : 'unknown';
  return { testName, suiteName };
}

export function beginE2eFlowStep(input: {
  method: string;
  url: string;
  headers?: HeaderMap;
  body?: unknown;
  testName?: string;
  suiteName?: string;
}): {
  stepId: number;
  startedAt: Date;
  request: E2eFlowStep['request'];
  testName: string;
  suiteName: string;
} {
  const current = getCurrentJestContext();
  return {
    stepId: ++flowStepCounter,
    startedAt: new Date(),
    request: {
      method: input.method,
      url: input.url,
      headers: normalizeHeaders(input.headers),
      body: safeBody(input.body),
    },
    testName: input.testName ?? current.testName,
    suiteName: input.suiteName ?? current.suiteName,
  };
}

export function finishE2eFlowStep(
  started: ReturnType<typeof beginE2eFlowStep>,
  output: {
    status?: number;
    headers?: HeaderMap;
    body?: unknown;
    errorMessage?: string;
    errorBody?: unknown;
  },
): void {
  const finishedAt = new Date();
  const entry: E2eFlowStep = {
    stepId: started.stepId,
    actionStep: `${started.request.method.toUpperCase()} ${started.request.url}`,
    testName: started.testName,
    suiteName: started.suiteName,
    startedAt: started.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - started.startedAt.getTime(),
    request: started.request,
  };

  if (output.errorMessage) {
    entry.error = {
      message: output.errorMessage,
      body: safeBody(output.errorBody),
    };
  }

  if (output.status !== undefined) {
    entry.response = {
      status: output.status,
      headers: normalizeHeaders(output.headers),
      body: safeBody(output.body),
    };
  }

  flowSteps.push(entry);
  try {
    ensureTraceDir();
    fs.appendFileSync(traceFilePath, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch {
    // Keep tests running even if trace persistence fails
  }
}
