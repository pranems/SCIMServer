<#
.SYNOPSIS
    Pre-push gate runner that mirrors every CI gate that runs before a PR
    can merge to master. Designed to be invoked by .git/hooks/pre-push but
    also runnable standalone.

.DESCRIPTION
    Three modes, from cheapest to most thorough:

      Fast (default for the hook)         ~9-10 min
        - api npm run build (TS compile)
        - api npm run lint
        - web npx tsc --noEmit
        - web npm run build
        - docs/infra/supply-chain static gates (mermaid, LTS, doc
          freshness, doc claims, lockfile provenance, RFC corpus)
        - api npm test (unit)              ~93s / 4,824 tests
        - api npm run test:e2e             ~195s / 1,430 tests
          (inmemory backend, maxWorkers=2, same excludes as CI)

        The two test gates were promoted here from Validate on
        2026-08-27. Until then the default mode ran NO tests at all -
        only static checks - which is how a completely dead route
        (an orphaned @Post decorator that still answered 201) was
        committed and pushed with every gate green.

      Validate (mirrors CI .github/workflows/build-test.yml validate job)
                                          ~11-14 min
        - Everything in Fast, plus:
        - api npx prisma generate (required before lint + tests)
        - api migration linter (npx ts-node lint-migrations.ts)
        - web npm test (vitest)

      Full                                ~18-22 min
        - Everything in Validate, plus:
        - docker build (mirrors build-and-push.yml build step)
        - trivy image scan (mirrors HIGH+CRITICAL gating)

    CI gates NOT covered locally (intentionally):
      - CodeQL security-extended scan      (requires GitHub Advanced Security)
      - GHCR push                          (requires registry credentials)
      - Container app deploy + live test   (out of scope for pre-push)

    For those, rely on the GitHub Actions runs against the pushed branch
    and on scripts/run-all-gates.ps1 (full Stage 0-6 walker) before
    opening / promoting a PR.

.PARAMETER Mode
    Fast | Validate | Full. Defaults to Fast.

.PARAMETER FailFast
    Stop on first failed gate (default). Pass -FailFast:$false to run
    every gate even after a failure so the summary shows all problems.

.EXAMPLE
    .\scripts\pre-push-checks.ps1
    Default Fast mode. Returns exit 0 on green, non-zero on any failure.

.EXAMPLE
    .\scripts\pre-push-checks.ps1 -Mode Validate
    Mirror the CI validate job. Run this before opening / promoting a PR.

.EXAMPLE
    $env:PREPUSH_MODE = 'validate'; git push
    The hook honors $env:PREPUSH_MODE to escalate from Fast to Validate /
    Full without editing the hook file.

.NOTES
    Standing rules honored:
      - No em-dash anywhere (uses hyphen)
      - Returns non-zero on failure so git refuses to push
      - Bypass only via `git push --no-verify` (which is itself banned
        by the standing rule, but the mechanism stays for emergencies)
#>

[CmdletBinding()]
param(
    [ValidateSet('Fast', 'Validate', 'Full')]
    [string]$Mode = 'Fast',

    [switch]$FailFast = $true
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$results = [System.Collections.Generic.List[object]]::new()
$overallStart = Get-Date

function Invoke-Gate {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [scriptblock]$Action,
        [string]$WorkingDir = $repoRoot
    )

    Write-Host ""
    Write-Host ("=== [{0}] {1} ===" -f $Mode, $Name) -ForegroundColor Cyan
    $start = Get-Date
    $status = 'PASS'
    $exitCode = 0
    $err = $null

    try {
        Push-Location $WorkingDir
        & $Action
        $exitCode = $LASTEXITCODE
        if ($null -ne $exitCode -and $exitCode -ne 0) {
            $status = 'FAIL'
        }
    }
    catch {
        $status = 'FAIL'
        $err = $_.Exception.Message
        Write-Host $err -ForegroundColor Red
    }
    finally {
        Pop-Location
    }

    $duration = (Get-Date) - $start
    $results.Add([pscustomobject]@{
        Gate     = $Name
        Status   = $status
        Seconds  = [math]::Round($duration.TotalSeconds, 1)
        ExitCode = $exitCode
        Error    = $err
    })

    if ($status -eq 'FAIL') {
        Write-Host ("--> {0} FAILED in {1}s (exit {2})" -f $Name, [math]::Round($duration.TotalSeconds, 1), $exitCode) -ForegroundColor Red
        if ($FailFast) {
            Show-Summary
            exit 1
        }
    }
    else {
        Write-Host ("--> {0} OK in {1}s" -f $Name, [math]::Round($duration.TotalSeconds, 1)) -ForegroundColor Green
    }
}

function Show-Summary {
    $overallDuration = (Get-Date) - $overallStart
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host (" PRE-PUSH SUMMARY [Mode: {0}] - total {1}s" -f $Mode, [math]::Round($overallDuration.TotalSeconds, 1)) -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Yellow
    $results | Format-Table Gate, Status, Seconds, ExitCode -AutoSize | Out-String | Write-Host
    $failed = ($results | Where-Object Status -eq 'FAIL').Count
    if ($failed -gt 0) {
        Write-Host ("FAILED: {0} gate(s). Push blocked." -f $failed) -ForegroundColor Red
    }
    else {
        Write-Host "All gates GREEN. Push allowed." -ForegroundColor Green
    }
}

# -------------------------------------------------------------------------
# Fast gates (always run)
# -------------------------------------------------------------------------

Invoke-Gate -Name 'api: tsc build' -WorkingDir (Join-Path $repoRoot 'api') -Action {
    npm run build 2>&1 | Out-Host
}

Invoke-Gate -Name 'api: eslint' -WorkingDir (Join-Path $repoRoot 'api') -Action {
    npm run lint 2>&1 | Out-Host
}

Invoke-Gate -Name 'web: tsc --noEmit' -WorkingDir (Join-Path $repoRoot 'web') -Action {
    # Web tsc baseline tolerance: project has 96 known errors (87 test / 9 prod)
    # per .github/copilot-instructions.md Stage 1.4. Count must NOT regress upward.
    $tscOut = npx tsc --noEmit 2>&1
    $tscErrorCount = ($tscOut | Select-String -Pattern "error TS" | Measure-Object).Count
    Write-Host ("web tsc error count: {0} (baseline: 96, must not regress)" -f $tscErrorCount)
    if ($tscErrorCount -gt 96) {
        Write-Host ("REGRESSION: web tsc errors above 96 baseline. Output:") -ForegroundColor Red
        $tscOut | Out-Host
        $global:LASTEXITCODE = 1
    }
    else {
        $global:LASTEXITCODE = 0
    }
}

Invoke-Gate -Name 'web: vite production build' -WorkingDir (Join-Path $repoRoot 'web') -Action {
    npm run build 2>&1 | Out-Host
}

# Docs: every ```mermaid block must RENDER in a real browser - which is exactly
# what the VS Code Markdown preview (a webview) and GitHub do. Parsing alone is
# NOT enough: a diagram can pass the grammar check and still fail to render, and
# a render failure is what the operator actually sees as a blank/error box. The
# gate deliberately pins the same Mermaid version the VS Code extension bundles
# (see the version-drift guard inside the script) - running a different version
# is how two broken diagrams stayed green on 2026-07-27. Skips (does not fail)
# when the tooling deps are absent, so a fresh clone is not blocked.
Invoke-Gate -Name 'docs: mermaid diagrams render' -WorkingDir $repoRoot -Action {
    if (-not (Test-Path (Join-Path $repoRoot 'node_modules/mermaid'))) {
        Write-Host "Skipped (run 'npm install' at the repo root to enable this gate)" -ForegroundColor Yellow
        $global:LASTEXITCODE = 0
        return
    }
    node scripts/render-mermaid.mjs 2>&1 | Out-Host
}

# Infra: base images must sit on an Active/Maintenance LTS Node line. Trivy scans
# for CVEs, never for SUPPORT STATUS, so an EOL runtime with no CVE filed yet is
# invisible to it - which is how the shipped image ran EOL Node 25 for ~2 months
# on 2026-07-29 with every gate green.
Invoke-Gate -Name 'infra: base images on LTS' -WorkingDir $repoRoot -Action {
    pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts/audit-base-images.ps1') -Quiet 2>&1 | Out-Host
}

# Infra: the canonical deployment doc must stay true. Any infra change (Dockerfile,
# compose, Bicep, workflow, deploy/promote script) must update
# docs/DEPLOYMENT_INFRASTRUCTURE_AND_FORM_FACTORS.md in the same change. Compares
# against the upstream ref so the commits BEING PUSHED are what gets checked - at
# pre-push the working tree is clean, so a HEAD-only comparison could never fire.
Invoke-Gate -Name 'infra: deployment doc current' -WorkingDir $repoRoot -Action {
    $upstream = git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
    $script = Join-Path $repoRoot 'scripts/audit-deployment-doc.ps1'
    if ($LASTEXITCODE -eq 0 -and $upstream) {
        pwsh -NoProfile -ExecutionPolicy Bypass -File $script -BaseRef $upstream 2>&1 | Out-Host
    } else {
        # No upstream yet (new branch): fall back to uncommitted-only comparison.
        pwsh -NoProfile -ExecutionPolicy Bypass -File $script 2>&1 | Out-Host
    }
}

# Docs: the user-facing set must still describe what ships. Every other gate in
# this repo checks whether the CODE is correct; none checked whether the DOCS
# still match it, which is how 12 user-facing guides kept advertising v0.53.0
# while the product shipped 0.55.1 with every test green. Generalizes the
# single-doc deployment audit to the whole set via docs/.doc-manifest.json.
# Compares against the upstream ref so the COMMITS BEING PUSHED are checked.
Invoke-Gate -Name 'docs: user-facing docs current' -WorkingDir $repoRoot -Action {
    $upstream = git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
    $script = Join-Path $repoRoot 'scripts/audit-doc-freshness.ps1'
    if ($LASTEXITCODE -eq 0 -and $upstream) {
        pwsh -NoProfile -ExecutionPolicy Bypass -File $script -BaseRef $upstream -Quiet 2>&1 | Out-Host
    } else {
        pwsh -NoProfile -ExecutionPolicy Bypass -File $script -Quiet 2>&1 | Out-Host
    }
}

# Docs: what the docs CLAIM must match what the source CONTAINS. The freshness
# gate above checks currency MARKERS - version header, provenance date, links -
# and none of that reads the prose. A doc can pass every one of those while
# telling the reader there are 86 route handlers when there are 117, and a
# freshly stamped document asserting a wrong number is worse than an obviously
# stale one because the stamp invites trust. Measured 2026-07-31: 22 route
# handlers undocumented, a phantom setting that exists nowhere in the source,
# and a retired FQDN offered as "Azure (live production)".
Invoke-Gate -Name 'docs: doc claims match source' -WorkingDir $repoRoot -Action {
    node scripts/audit-doc-content.mjs 2>&1 | Out-Host
}

# Supply chain: no lockfile entry may carry corporate-feed-proxy provenance. A
# Microsoft corp-managed device redirects npm to a feed proxy that serves only a
# legacy shasum, so any entry npm rewrites there comes back with an internal
# `resolved` host and a sha1 integrity among 725 sha512 siblings. That leaks an
# internal endpoint from a public repo AND weakens the lockfile's own
# tamper-evidence, and it is invisible to every other gate we own. Measured
# 2026-07-30; see docs/strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md Section 5.
Invoke-Gate -Name 'supply chain: lockfile provenance' -WorkingDir $repoRoot -Action {
    node scripts/check-lockfile-provenance.mjs 2>&1 | Out-Host
}

# Docs: the pattern catalog's category pie must match the patterns actually in
# the file. A stale pie renders perfectly - Mermaid has no idea what the numbers
# mean - so the render gate passes on any integers. Two branches that each
# appended patterns produced a merge where BOTH sides' counts were wrong
# (22 and 14, against a real 24). The doc is consulted at the start of planning
# and design, so an understated count hides accumulated experience.
Invoke-Gate -Name 'docs: patterns pie matches catalog' -WorkingDir $repoRoot -Action {
    node scripts/check-patterns-pie.mjs 2>&1 | Out-Host
}

# D3 (2026-09-03): the prune retained the newest N revisions by creation time,
# which only means "serving + rollback target" while those revisions run
# DIFFERENT images. An interrupted promote left a same-image orphan, so the two
# newest were both the new version and the prune deactivated the only revision
# worth rolling back to - with every check green. Deploy tooling gets no
# feedback from the app's own test suites, so its selector is gated here.
Invoke-Gate -Name 'deploy: revision retention selector' -WorkingDir $repoRoot -Action {
    pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts/test-prune-revisions.ps1') 2>&1 | Out-Host
}

# Offline-only checks (C1-C5): coverage, SHA-256 integrity, update/obsolete
# closure, freshness and README linkage. The network checks (O1-O3) are NOT run
# here on purpose - pre-push must stay deterministic and work offline. They run
# monthly in .github/workflows/rfc-currency.yml and on demand via
# `npm run rfcs:check:online`.
Invoke-Gate -Name 'docs: RFC corpus current + intact' -WorkingDir $repoRoot -Action {    pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts/sync-rfcs.ps1') -Quiet 2>&1 | Out-Host
}

# -------------------------------------------------------------------------
# API test gates - ALWAYS RUN (promoted from Validate on 2026-08-27)
# -------------------------------------------------------------------------
# Origin: v0.55.15. A change orphaned `@Post(':endpointId/credentials')` onto a
# private helper, so credential creation was completely dead - and it answered
# `201 Created`. It was committed AND pushed with all 12 gates green, because
# every gate in the default mode was STATIC. No test of any kind ran at push
# time, so `credential-lifecycle.e2e-spec.ts` - which fails instantly on that
# defect - never got the chance.
#
# Unit tests are included alongside E2E deliberately: running E2E while skipping
# the faster, broader suite would be incoherent. Measured 2026-08-27 on the dev
# machine: unit 93s (4,824 tests), e2e 195s (1,430 tests).
#
# E2E runs against the INMEMORY backend, exactly as CI does, so pre-push needs no
# database, no Docker and no network - it stays deterministic and works offline.

Invoke-Gate -Name 'api: unit tests (jest)' -WorkingDir (Join-Path $repoRoot 'api') -Action {
    npm test 2>&1 | Out-Host
}

Invoke-Gate -Name 'api: e2e tests (inmemory, maxWorkers=2)' -WorkingDir (Join-Path $repoRoot 'api') -Action {
    # Match CI exactly: same env vars, same excludes, same worker count. Verified
    # byte-for-byte against .github/workflows build-test.yml rather than assumed.
    #
    # OPEN FINDING (2026-08-27, deliberately NOT acted on here): the two
    # --testPathIgnorePatterns below are UNDOCUMENTED and run in no automated
    # gate anywhere, so 55 tests are permanently dark. Measured this session:
    # they pass in isolation (2 suites / 55 tests) AND in the full suite with
    # nothing excluded (92 suites / 1,485 tests / 133s). The exclusion looks
    # stale. It is left in place because two green runs are not enough evidence
    # to re-enable a previously-quarantined pair - if they are intermittently
    # flaky, enabling them here would make every push flaky, which is a worse
    # failure than the gap. Re-enabling belongs in its own change, in CI and
    # pre-push together, after several consecutive green runs.
    $env:PERSISTENCE_BACKEND = 'inmemory'
    $env:SCIM_SHARED_SECRET = 'ci-shared-secret-not-for-production'
    $env:JWT_SECRET = 'ci-jwt-secret-not-for-production'
    $env:OAUTH_CLIENT_SECRET = 'ci-oauth-secret-not-for-production'
    npm run test:e2e -- --maxWorkers=2 --testPathIgnorePatterns 'endpoint-scoped-logs.e2e-spec.ts' --testPathIgnorePatterns 'log-config.e2e-spec.ts' 2>&1 | Out-Host
}

# -------------------------------------------------------------------------
# Validate gates (mirror CI validate job)
# -------------------------------------------------------------------------

if ($Mode -in @('Validate', 'Full')) {

    Invoke-Gate -Name 'api: prisma generate' -WorkingDir (Join-Path $repoRoot 'api') -Action {
        npx prisma generate 2>&1 | Out-Host
    }

    Invoke-Gate -Name 'api: migration linter (additive-only)' -WorkingDir (Join-Path $repoRoot 'api') -Action {
        npx ts-node --transpile-only src/scripts/lint-migrations.ts 2>&1 | Out-Host
    }

    Invoke-Gate -Name 'web: vitest' -WorkingDir (Join-Path $repoRoot 'web') -Action {
        npm test 2>&1 | Out-Host
    }
}

# -------------------------------------------------------------------------
# Full gates (mirror build-and-push.yml docker steps)
# -------------------------------------------------------------------------

if ($Mode -eq 'Full') {

    Invoke-Gate -Name 'docker: build image (linux/amd64)' -Action {
        $tag = "scimserver:prepush-$(Get-Date -Format 'yyyyMMddHHmmss')"
        $env:_PREPUSH_DOCKER_TAG = $tag
        docker build -t $tag -f Dockerfile . 2>&1 | Out-Host
    }

    Invoke-Gate -Name 'trivy: HIGH+CRITICAL scan (matches CI)' -Action {
        $tag = $env:_PREPUSH_DOCKER_TAG
        if (-not $tag) {
            Write-Host "Skipped (no docker tag from previous gate)" -ForegroundColor Yellow
            $global:LASTEXITCODE = 0
            return
        }
        $trivyExe = Get-Command trivy -ErrorAction SilentlyContinue
        if (-not $trivyExe) {
            Write-Host "trivy not installed locally. Skipping (CI still enforces this gate)." -ForegroundColor Yellow
            $global:LASTEXITCODE = 0
            return
        }
        trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed --vuln-type os,library --ignorefile .trivyignore $tag 2>&1 | Out-Host
    }
}

# -------------------------------------------------------------------------
# Summary + exit
# -------------------------------------------------------------------------

Show-Summary
$failedCount = ($results | Where-Object Status -eq 'FAIL').Count
if ($failedCount -gt 0) {
    exit 1
}
exit 0
