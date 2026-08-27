/**
 * Route-decorator BINDING gate.
 *
 * ORIGIN (2026-08-27, high severity): the P2 credential-caps change inserted two
 * private helper methods BETWEEN `@Post(':endpointId/credentials')` and the
 * `createCredential` method it was meant to decorate. TypeScript attaches a
 * decorator to whatever declaration follows it, so the route bound to
 * `registeredCapDefault(flag: string)` instead. That method has no parameter
 * decorators, so Nest invoked it with `undefined`, it returned `undefined`, and
 * every POST answered `201 Created` with an EMPTY BODY. Credential creation was
 * completely dead, and the failure shape was a SUCCESS status.
 *
 * WHY NOTHING CAUGHT IT - this is the part worth keeping:
 *
 *   Controller unit tests call `controller.createCredential(...)` as an ordinary
 *   method. Routing is never exercised, so an orphaned route decorator is
 *   invisible to a unit test BY CONSTRUCTION - not by omission. Adding more unit
 *   tests could never have found this. The API E2E suite would have caught it,
 *   but E2E is not part of pre-push, so the break was committed and pushed.
 *
 *   That leaves a permanent gap: the binding between a decorator and its handler
 *   is a structural property of the SOURCE, and the cheapest place to check a
 *   structural property is statically. This spec runs in the unit suite (and so
 *   in pre-push) and needs no app, no database and no HTTP.
 *
 * The two checks are deliberately the two ENDS of the same defect:
 *
 *   B-T1  no HTTP decorator may land on a private/protected method
 *         (catches the decorator arriving somewhere wrong)
 *   B-T2  no method carrying parameter decorators may lack an HTTP decorator
 *         (catches the handler being left with nothing)
 *
 * The orphaning event trips BOTH, from opposite directions. Either alone would
 * have found it; having both means a future variant that only moves one side
 * still trips something.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// src/modules/scim/controllers -> src
const apiSrc = join(__dirname, '..', '..', '..');

const HTTP_DECORATOR = /^@(Get|Post|Put|Patch|Delete|All|Head|Options|Search)\s*\(/;
const PARAM_DECORATOR = /@(Param|Body|Query|Headers|Req|Request|Res|Response|Ip|Session|UploadedFile)\s*\(/;

function controllerFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) controllerFiles(full, acc);
    else if (entry.endsWith('.controller.ts')) acc.push(full);
  }
  return acc;
}

/** True for lines that may legally sit between a decorator and its declaration. */
function isInterstitial(line: string): boolean {
  const t = line.trim();
  return (
    t === '' ||
    t.startsWith('//') ||
    t.startsWith('/*') ||
    t.startsWith('*') ||
    t.startsWith('@') // stacked decorators (@HttpCode, @UseGuards, ...)
  );
}

interface Finding {
  file: string;
  line: number;
  detail: string;
}

/**
 * Walks a controller source and reports both defect shapes.
 *
 * Exported so the negative controls below can drive it over synthetic source
 * rather than trusting that it works because the real tree happens to be clean.
 * A checker that has only ever been run against passing input is not evidence.
 */
export function findBindingDefects(source: string, file = '<inline>'): Finding[] {
  const lines = source.split('\n');
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (HTTP_DECORATOR.test(trimmed)) {
      // Consume any multi-line decorator argument list, then the interstitials.
      let depth = (lines[i].match(/\(/g) ?? []).length - (lines[i].match(/\)/g) ?? []).length;
      let j = i + 1;
      while (j < lines.length && depth > 0) {
        depth += (lines[j].match(/\(/g) ?? []).length - (lines[j].match(/\)/g) ?? []).length;
        j++;
      }
      while (j < lines.length && isInterstitial(lines[j])) j++;

      if (j < lines.length && /^(private|protected)\s/.test(lines[j].trim())) {
        findings.push({
          file,
          line: i + 1,
          detail:
            `B-T1: "${trimmed}" binds to "${lines[j].trim()}", which is ${/^private/.test(lines[j].trim()) ? 'private' : 'protected'}. ` +
            `A route handler must be public - a decorator sitting above a helper means it was separated ` +
            `from the method it was written for, and the real handler is now unrouted.`,
        });
      }
      continue;
    }

    // B-T2: a method signature carrying parameter decorators, with no HTTP
    // decorator anywhere in the decorator block immediately above it.
    const isMethodSig = /^(public\s+)?(async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(trimmed);
    if (!isMethodSig || trimmed.startsWith('constructor')) continue;

    // Gather the signature (may span lines) and look for parameter decorators.
    let sig = lines[i];
    let depth = (lines[i].match(/\(/g) ?? []).length - (lines[i].match(/\)/g) ?? []).length;
    let k = i + 1;
    while (k < lines.length && depth > 0) {
      sig += '\n' + lines[k];
      depth += (lines[k].match(/\(/g) ?? []).length - (lines[k].match(/\)/g) ?? []).length;
      k++;
    }
    if (!PARAM_DECORATOR.test(sig)) continue;

    // Walk backwards over the decorator block above this signature.
    let p = i - 1;
    let hasHttp = false;
    while (p >= 0 && isInterstitial(lines[p])) {
      if (HTTP_DECORATOR.test(lines[p].trim())) hasHttp = true;
      p--;
    }
    // A multi-line decorator ends on a `)` line, which isInterstitial rejects.
    // Accept a closing-paren line and keep walking so `@Post(\n  '...',\n)` counts.
    while (p >= 0 && /^\)/.test(lines[p].trim())) {
      let d = 0;
      while (p >= 0) {
        d += (lines[p].match(/\)/g) ?? []).length - (lines[p].match(/\(/g) ?? []).length;
        if (HTTP_DECORATOR.test(lines[p].trim())) hasHttp = true;
        if (d <= 0) break;
        p--;
      }
      p--;
      while (p >= 0 && isInterstitial(lines[p])) {
        if (HTTP_DECORATOR.test(lines[p].trim())) hasHttp = true;
        p--;
      }
    }

    if (!hasHttp) {
      findings.push({
        file,
        line: i + 1,
        detail:
          `B-T2: "${trimmed}" takes decorated parameters (@Param/@Body/@Query/...) but has no ` +
          `HTTP route decorator above it. Nest will never call it, so the endpoint it implements ` +
          `does not exist. This is what an orphaned decorator looks like from the handler's side.`,
      });
    }
  }

  return findings;
}

describe('Controller route-decorator binding', () => {
  const files = controllerFiles(apiSrc);

  it('B-T0: the scan actually finds controllers (guards against a gate that cannot fail)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('B-T1 + B-T2: every controller binds its routes to a reachable public handler', () => {
    const findings = files.flatMap(f =>
      findBindingDefects(readFileSync(f, 'utf8'), f.replace(/.*[\\/]api[\\/]/, 'api/')),
    );

    if (findings.length > 0) {
      throw new Error(
        `Route-decorator binding defects:\n\n` +
        findings.map(f => `  ${f.file}:${f.line}\n    ${f.detail}`).join('\n\n'),
      );
    }
  });

  describe('negative controls - the checker must fail on known-bad source', () => {
    it('NC-1: detects an HTTP decorator that landed on a private helper', () => {
      // This is the EXACT shape of the 2026-08-27 defect.
      const bad = [
        'class C {',
        "  @Post(':endpointId/credentials')",
        '  /** doc comment */',
        '  private registeredCapDefault(flag: string): number | undefined {',
        '    return 1;',
        '  }',
        '}',
      ].join('\n');
      const found = findBindingDefects(bad);
      expect(found.some(f => f.detail.startsWith('B-T1'))).toBe(true);
    });

    it('NC-2: detects a handler left with parameter decorators and no route', () => {
      const bad = [
        'class C {',
        '  async createCredential(',
        "    @Param('endpointId') endpointId: string,",
        '    @Body() dto: CreateCredentialDto,',
        '  ): Promise<void> {}',
        '}',
      ].join('\n');
      const found = findBindingDefects(bad);
      expect(found.some(f => f.detail.startsWith('B-T2'))).toBe(true);
    });

    it('NC-3: does NOT flag a correctly bound handler (guards against crying wolf)', () => {
      const good = [
        'class C {',
        "  @Post(':endpointId/credentials')",
        '  @HttpCode(201)',
        '  /** doc */',
        '  async createCredential(',
        "    @Param('endpointId') endpointId: string,",
        '    @Body() dto: CreateCredentialDto,',
        '  ): Promise<void> {}',
        '}',
      ].join('\n');
      expect(findBindingDefects(good)).toEqual([]);
    });

    it('NC-4: does NOT flag a private helper that takes ordinary parameters', () => {
      const good = [
        'class C {',
        '  private helper(flag: string): number { return 1; }',
        '}',
      ].join('\n');
      expect(findBindingDefects(good)).toEqual([]);
    });
  });
});
