const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const source = path.resolve(
  __dirname,
  "..",
  "performance",
  "membership-v8-profile.cjs",
);

function implementation() {
  assert.ok(
    fs.existsSync(source),
    "Native profile analysis must exist before comparative profiling",
  );
  return require(source);
}

function fixture() {
  const frame = (functionName, url, lineNumber = 0) => ({
    functionName,
    url,
    lineNumber,
    columnNumber: 0,
    scriptId: "1",
  });
  return {
    nodes: [
      { id: 1, callFrame: frame("(root)", ""), children: [2, 3] },
      { id: 2, callFrame: frame("validate", "file:///app/dist/schema.js", 12) },
      { id: 3, callFrame: frame("(idle)", "") },
    ],
    startTime: 100,
    endTime: 50130,
    samples: [2, 2, 3],
    timeDeltas: [10, 50000, 10],
  };
}

function comparisonFixture(directory) {
  const protocol = require("../performance/membership-protocol.json");
  const save = (name, data) =>
    fs.writeFileSync(path.join(directory, name), JSON.stringify(data));
  const roles = ["candidate", "baseline", "baseline", "candidate"];
  const rows = roles.map((role, index) => {
    const spans = [];
    const append = (operation, phase, cycle = null) => {
      const start = BigInt(index * 100000000 + spans.length * 2000 + 1000000);
      spans.push({
        requestIndex: spans.length + 1,
        operation,
        phase,
        cycle,
        startNs: String(start),
        endNs: String(start + 1000n),
        ms: 1,
        status: 200,
        succeeded: true,
      });
    };
    for (const operation of ["version", "fixture", "fixture", "fixture"])
      append(operation, "lifecycle");
    for (let cycle = 0; cycle < 1100; cycle++) {
      for (const operation of ["add", "populatedRead", "remove", "emptyRead"])
        append(
          operation,
          cycle < 100 ? "warmup" : "measured",
          cycle < 100 ? cycle : cycle - 100,
        );
    }
    for (const operation of ["finalVersion", "cleanup", "cleanup"])
      append(operation, "lifecycle");
    save(`round-${index + 1}-${role}.json`, {
      complete: true,
      diagnosticOnly: true,
      traceClock: "process.hrtime.bigint",
      spans,
    });
    return {
      role,
      version: protocol[role].version,
      image: protocol[role].image,
      imageId: `sha256:${(role === "baseline" ? "a" : "b").repeat(64)}`,
      status: "PASS",
      complete: true,
      diagnosticOnly: true,
      cpuMax: "50000 100000",
      cpuLimit: 0.5,
      memoryLimit: 1073741824,
      requestCount: 4407,
      appContainerId: (role === "baseline" ? "c" : "d").repeat(64),
      samples: Object.fromEntries(
        ["add", "populatedRead", "remove", "emptyRead"].map((op) => [
          op,
          Array(1000).fill(1),
        ]),
      ),
    };
  });
  for (const role of ["baseline", "candidate"]) {
    const profile = fixture();
    profile.endTime = 10000000;
    save(`profile-${role}.cpuprofile`, profile);
    save(`profile-${role}-meta.json`, {
      diagnosticOnly: true,
      admissionEligible: false,
      nodeVersion: "v24.20.0",
      clock: "process.hrtime.bigint",
      bootstrapNs: "100000",
    });
    save(`profile-${role}-status.json`, {
      diagnosticOnly: true,
      admissionEligible: false,
      workComplete: true,
      captureStatus: "COMPLETE",
      failureStage: null,
      exitCode: 0,
      filesCollected: true,
      containerId: rows.find((row) => row.role === role).appContainerId,
    });
  }
  save("rounds.json", rows);
  save("privacy.json", {
    contractAssertions: 66,
    checkedRows: 200,
    rawLogsExported: false,
    passed: true,
  });
  save("cleanup.json", { containersAbsent: true, networksAbsent: true });
  save("../protocol.json", protocol);
  save(
    "../images.json",
    ["baseline", "candidate"].map((role) => ({
      role,
      reference: protocol[role].image,
      version: protocol[role].version,
      nodeVersion: "v24.20.0",
      id: rows.find((row) => row.role === role).imageId,
    })),
  );
  return { save, rows };
}

for (const scenario of [
  "complete",
  "wrong-image",
  "wrong-runtime",
  "partial-work",
  "changed-sample",
  "clock-coverage",
  "missing-cleanup",
  "failed-privacy",
]) {
  test(`actual native comparison CLI enforces immutable provenance and non-admission: ${scenario}`, () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "scim-profile-analysis-"),
    );
    const directory = path.join(root, "ab-baab");
    fs.mkdirSync(directory);
    try {
      const { save, rows } = comparisonFixture(directory);
      if (scenario === "wrong-image") {
        rows[0].image = rows[1].image;
        save("rounds.json", rows);
      }
      if (scenario === "changed-sample") {
        rows[0].samples.add[0] = 2;
        save("rounds.json", rows);
      }
      if (scenario === "wrong-runtime") {
        const name = "profile-baseline-meta.json";
        const metadata = JSON.parse(
          fs.readFileSync(path.join(directory, name)),
        );
        metadata.nodeVersion = "v99.0.0";
        save(name, metadata);
      }
      if (scenario === "partial-work") {
        const name = "profile-baseline-status.json";
        const status = JSON.parse(fs.readFileSync(path.join(directory, name)));
        status.workComplete = false;
        save(name, status);
      }
      if (scenario === "clock-coverage") {
        const profile = fixture();
        save("profile-baseline.cpuprofile", profile);
      }
      if (scenario === "missing-cleanup")
        fs.unlinkSync(path.join(directory, "cleanup.json"));
      if (scenario === "failed-privacy")
        save("privacy.json", {
          passed: false,
          contractAssertions: 66,
          checkedRows: 200,
          rawLogsExported: false,
        });
      const result = spawnSync(
        process.execPath,
        [source, "analyze", directory],
        { encoding: "utf8" },
      );
      assert.equal(
        result.status,
        scenario === "complete" ? 0 : 1,
        result.stdout + result.stderr,
      );
      const output = path.join(directory, "native-functions.json");
      assert.equal(fs.existsSync(output), scenario === "complete");
      if (scenario === "wrong-image") {
        assert.match(result.stderr, /Round must use the pinned role image/);
      }
      if (scenario === "complete") {
        const receipt = JSON.parse(fs.readFileSync(output));
        assert.equal(receipt.diagnosticOnly, true);
        assert.equal(receipt.admissionEligible, false);
        assert.equal(receipt.requestSpans, 17628);
        assert.equal(receipt.measuredSamples, 16000);
        assert.deepEqual(
          receipt.profiles.map((item) => [item.role, item.totalSamples]),
          [
            ["baseline", 3],
            ["candidate", 3],
          ],
        );
        assert.ok(
          receipt.limitations.some((item) =>
            /whole process lifetime/.test(item),
          ),
        );
        assert.ok(
          receipt.profiles.every(
            (item) =>
              item.functions.find((f) => f.functionName === "validate")
                .samples === 2,
          ),
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true });
    }
  });
}

test("actual native diagnostic selection skips controls and never invokes the admission evaluator", () => {
  const runner = path.resolve(
    __dirname,
    "..",
    "performance",
    "run-membership-qualification.ps1",
  );
  const result = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `
    $ErrorActionPreference = 'Stop'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
      '${runner.replaceAll("'", "''")}', [ref]$null, [ref]$null)
    $loop = $ast.Find({ param($item)
      $item -is [System.Management.Automation.Language.ForEachStatementAst] -and
      $item.Variable.VariablePath.UserPath -eq 'block'
    }, $true)
    $TraceDiagnostic = $false
    $ProfileDiagnostic = $true
    $nativeProfile = 'native function analysis'
    $protocol = Get-Content (Join-Path (Split-Path '${runner.replaceAll("'", "''")}') 'membership-protocol.json') -Raw | ConvertFrom-Json
    $summary = @{ Blocks = @(); AdmissionEligible = $false }
    $script:attempts = 0
    function Assert-WithinDeadline {}
    function Invoke-Block {
      param($Block)
      if ($Block.name -cne 'ab-baab' -or $Block.sameImage) { throw 'Wrong native diagnostic block' }
      $script:attempts++
      return 'owned profile block'
    }
    function node {
      if ($args[0] -cne $nativeProfile -or $args[1] -cne 'analyze') { throw 'Native diagnostic reached admission evaluator' }
      $global:LASTEXITCODE = 0
    }
    . ([scriptblock]::Create($loop.Extent.Text))
    if ($script:attempts -ne 1 -or $summary.Blocks.Count -ne 1 -or
        $summary.Blocks[0].AdmissionEligible -ne $false -or $summary.AdmissionEligible -ne $false) {
      throw 'Native diagnostic resumed later blocks or became admission'
    }
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const scenario of [
  "capture-only",
  "work-only",
  "work-and-capture",
  "work-and-cleanup",
  "work-and-receipt",
]) {
  test(`actual block preserves primary work error and collects both profiles before cleanup: ${scenario}`, () => {
    const runner = path.resolve(
      __dirname,
      "..",
      "performance",
      "run-membership-qualification.ps1",
    );
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "scim-profile-finally-"),
    );
    try {
      const result = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-Command",
          `
      $ErrorActionPreference = 'Stop'
      $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        '${runner.replaceAll("'", "''")}', [ref]$null, [ref]$null)
      $function = $ast.Find({ param($item)
        $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Invoke-Block'
      }, $true)
      $outer = $function.Body.Find({ param($item)
        $item -is [System.Management.Automation.Language.TryStatementAst]
      }, $true)
      $ProfileDiagnostic = $true
      $profileTargets = @{ baseline = ('a' * 64); candidate = ('b' * 64) }
      $workComplete = $false
      $workFailure = $null
      $scenario = '${scenario}'
      $directory = '${directory.replaceAll("'", "''")}'
      $run = 'owned-test-run'
      $network = 'owned-test-network'
      $containers = [System.Collections.Generic.List[string]]::new()
      $containers.Add($profileTargets.baseline); $containers.Add($profileTargets.candidate)
      $script:captures = [System.Collections.Generic.List[string]]::new()
      $script:removed = 0
      function Assert-Owned {}
      function Set-Content {
        param([Parameter(Position=0)]$Path, [Parameter(ValueFromPipeline)]$Value)
        process {
          if ($scenario -eq 'work-and-receipt' -and $Path.EndsWith('finalization.json')) {
            throw 'Synthetic finalization receipt write failure'
          }
          Microsoft.PowerShell.Management\\Set-Content -Path $Path -Value $Value
        }
      }
      function Save-NativeProfile {
        param($ContainerId, $Directory, $Role, $WorkComplete)
        if ($script:removed -ne 0 -or $WorkComplete) { throw 'Capture followed removal or fabricated successful work' }
        $script:captures.Add($Role)
        if ($Role -eq 'baseline' -and $scenario -ne 'work-only') { throw 'Synthetic failed native capture' }
      }
      function Invoke-Docker {
        if ($args[0] -eq 'rm') {
          $script:removed++
          if ($scenario -eq 'work-and-cleanup') { throw 'Synthetic cleanup failure' }
          return
        }
        if ($args[0] -eq 'ps') { return }
        if ($args[0] -eq 'network' -and $args[1] -eq 'ls') { return }
        throw 'Unexpected native cleanup command'
      }
      $work = if ($scenario -eq 'capture-only') { '' } else { "throw 'Synthetic primary work failure'" }
      $clauses = ($outer.CatchClauses | ForEach-Object { $_.Extent.Text }) -join ' '
      $execution = 'try { ' + $work + ' } ' + $clauses + ' finally ' + $outer.Finally.Extent.Text
      $expectedError = if ($scenario -eq 'capture-only') {
        'Native profile capture failed; partial receipts retained after exact cleanup.'
      } else { 'Synthetic primary work failure' }
      try {
        . ([scriptblock]::Create($execution))
        throw 'Required failure was swallowed'
      } catch {
        if ($_.Exception.Message -cne $expectedError) { throw }
      }
      if (($script:captures -join ',') -cne 'baseline,candidate' -or
          ($scenario -ne 'work-and-cleanup' -and $script:removed -ne 2)) {
        throw 'Independent capture failure prevented other evidence or exact cleanup'
      }
      if ($scenario -ne 'work-and-cleanup') {
        $cleanup = Get-Content (Join-Path $directory 'cleanup.json') -Raw | ConvertFrom-Json
        if (!$cleanup.containersAbsent -or !$cleanup.networksAbsent) { throw 'Missing native cleanup outcome' }
      }
      if ($scenario -eq 'work-and-receipt') { exit 0 }
      $finalization = Get-Content (Join-Path $directory 'finalization.json') -Raw | ConvertFrom-Json
      if ($finalization.primaryWorkFailed -ne ($scenario -ne 'capture-only') -or
          $finalization.captureFailed -ne ($scenario -ne 'work-only') -or
          $finalization.cleanupComplete -ne ($scenario -ne 'work-and-cleanup')) {
        throw 'Primary/secondary failure evidence was not retained'
      }
    `,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
}

test("actual native launch instruments only the opted-in app, not migration or ordinary qualification", () => {
  const runner = path.resolve(
    __dirname,
    "..",
    "performance",
    "run-membership-qualification.ps1",
  );
  const result = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `
    $ErrorActionPreference = 'Stop'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
      '${runner.replaceAll("'", "''")}', [ref]$null, [ref]$null)
    $launch = $ast.Find({ param($item)
      $item -is [System.Management.Automation.Language.IfStatementAst] -and
      $item.Extent.Text.Contains("'scimserver.profile=native-function'")
    }, $true)
    if (!$launch) { throw 'Missing actual native launch' }
    foreach ($enabled in @($false, $true)) {
      $ProfileDiagnostic = $enabled
      $profileBootstrap = 'owned absolute bootstrap'
      $profileArguments = @()
      $appCommand = 'ordinary app'
      . ([scriptblock]::Create($launch.Extent.Text))
      if (!$enabled) {
        if ($profileArguments.Count -or $appCommand -cne 'ordinary app') { throw 'Ordinary qualification was instrumented' }
        continue
      }
      if (($profileArguments -join ' ') -notmatch 'scimserver.profile=native-function' -or
          ($profileArguments -join ' ') -notmatch 'SCIM_BENCH_PROFILE=1' -or
          ($profileArguments -join ' ') -notmatch 'readonly' -or
          ($profileArguments -join ' ') -match 'NODE_OPTIONS|tmpfs') { throw 'Invalid native-only container opt-in' }
      $commands = $appCommand -split ' && '
      if ($commands.Count -ne 2 -or $commands[0] -cne 'node node_modules/prisma/build/index.js migrate deploy >/dev/null' -or
          $commands[1] -cne 'exec node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=membership.cpuprofile --require /tmp/profile-bootstrap.cjs dist/main.js') {
        throw 'Profiler did not isolate the real app from the migration process'
      }
    }
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const mode of ["qualification", "timeline", "profile"]) {
  test(`actual ${mode}-only source hash output records exact instrumentation bytes`, () => {
    const runner = path.resolve(
      __dirname,
      "..",
      "performance",
      "run-membership-qualification.ps1",
    );
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "scim-profile-hashes-"),
    );
    try {
      const result = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-Command",
          `
        $ErrorActionPreference = 'Stop'
        $runner = '${runner.replaceAll("'", "''")}'
        $PSScriptRoot = Split-Path $runner
        $sourceDirectory = $PSScriptRoot
        $PSCommandPath = $runner
        $root = Split-Path (Split-Path $PSScriptRoot)
        $OutputDirectory = '${directory.replaceAll("'", "''")}'
        $protocolPath = Join-Path $PSScriptRoot 'membership-protocol.json'
        $evaluator = Join-Path $PSScriptRoot 'assess-membership.cjs'
        $clientScript = Join-Path $PSScriptRoot 'benchmark-membership.cjs'
        $cpuTrace = Join-Path $PSScriptRoot 'membership-cpu-trace.cjs'
        $nativeProfile = Join-Path $PSScriptRoot 'membership-v8-profile.cjs'
        $profileBootstrap = Join-Path $PSScriptRoot 'membership-profile-bootstrap.cjs'
        $TraceDiagnostic = '${mode}' -ceq 'timeline'
        $ProfileDiagnostic = '${mode}' -ceq 'profile'
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($runner, [ref]$null, [ref]$null)
        $main = @($ast.EndBlock.Statements | Where-Object {
          $_ -is [System.Management.Automation.Language.TryStatementAst]
        })[0]
        $statements = @($main.Body.Statements)
        $first = -1; $last = -1
        for ($i = 0; $i -lt $statements.Count; $i++) {
          if ($statements[$i].Extent.Text.StartsWith('$sourceHashes =')) { $first = $i }
          if ($statements[$i].Extent.Text.Contains("'source-hashes.json'")) { $last = $i; break }
        }
        if ($first -lt 0 -or $last -le $first) { throw 'Missing actual source provenance block' }
        $fragment = ($statements[$first..$last].Extent.Text -join "\`n").
          Replace('$PSCommandPath', '$runner').Replace('$PSScriptRoot', '$sourceDirectory')
        . ([scriptblock]::Create($fragment))
        $hashes = Get-Content (Join-Path $OutputDirectory 'source-hashes.json') -Raw | ConvertFrom-Json -AsHashtable
        $files = @($protocolPath, $evaluator, $clientScript, $runner,
          (Join-Path $root 'scripts\\live-test-sections\\minimal-group-members.ps1'))
        if ($TraceDiagnostic) {
          $files += @($cpuTrace, (Join-Path $PSScriptRoot 'membership-cpu-observer.ps1'))
        }
        if ($ProfileDiagnostic) {
          $files += @($nativeProfile, $profileBootstrap, $cpuTrace,
            (Join-Path $PSScriptRoot 'membership-v8-profile.ps1'))
        }
        if ($hashes.Count -ne $files.Count) { throw 'Mode-only source provenance omits instrumentation' }
        foreach ($file in $files) {
          $key = [IO.Path]::GetFileName($file)
          if ($hashes[$key] -cne (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash) {
            throw 'Mode-only source provenance records incorrect bytes'
          }
        }
      `,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
}

test("native workflow is bounded, read-only and serialized with existing qualification", () => {
  const workflow = fs.readFileSync(
    path.resolve(
      __dirname,
      "..",
      "..",
      ".github",
      "workflows",
      "membership-function-diagnostic.yml",
    ),
    "utf8",
  );
  const caps = [...workflow.matchAll(/timeout-minutes:\s*(\d+)/g)].map(
    (match) => Number(match[1]),
  );
  assert.deepEqual(caps, [30, 2, 3, 20, 4]);
  assert.ok(caps.slice(1).reduce((sum, n) => sum + n, 0) < caps[0]);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /group: membership-performance-qualification/);
  assert.match(workflow, /-ProfileDiagnostic/);
  assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(
    workflow,
    /azure\/login|promote-to-prod|deploy-azure|write-all/,
  );
  for (const name of [
    "performance-qualification.yml",
    "membership-cpu-diagnostic.yml",
    "membership-function-diagnostic.yml",
  ]) {
    const participant = fs.readFileSync(
      path.resolve(__dirname, "..", "..", ".github", "workflows", name),
      "utf8",
    );
    assert.match(
      participant,
      /concurrency:\r?\n\s+group: membership-performance-qualification\r?\n\s+cancel-in-progress: false\r?\n\s+queue: max/,
      `${name} must retain every waiting run, not replace the previous pending diagnostic`,
    );
  }
});

test("native analysis retains signed producer timestamp reorder without weighting or discarding samples", () => {
  const profile = fixture();
  profile.timeDeltas = [100, -2, 100];
  const result = implementation().summarizeProfile(profile);
  assert.equal(result.totalSamples, 3);
  assert.equal(result.outOfOrderSamples, 1);
  assert.equal(result.maximumBackwardStepMicroseconds, 2);
  assert.equal(result.maximumSampleGapMicroseconds, 100);
  assert.equal(
    result.functions.find((item) => item.functionName === "validate").samples,
    2,
  );
  assert.equal(
    result.functions.find((item) => item.functionName === "(idle)").samples,
    1,
  );
  assert.equal(result.admissionEligible, false);
  for (const invalid of [
    [-1, 100, 100],
    [100, -101, 100],
    [100, 50031, -101],
  ]) {
    assert.throws(
      () =>
        implementation().summarizeProfile({ ...profile, timeDeltas: invalid }),
      /outside native profile span/,
    );
  }
});

test("native analysis counts function observations rather than assigning scheduler gaps as CPU time", () => {
  const result = implementation().summarizeProfile(fixture());
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.admissionEligible, false);
  assert.equal(result.totalSamples, 3);
  assert.equal(result.profileWallMicroseconds, 50030);
  assert.equal(result.maximumSampleGapMicroseconds, 50000);
  const validation = result.functions.find(
    (item) => item.functionName === "validate",
  );
  assert.equal(validation.samples, 2);
  assert.equal(validation.samplePercent, (100 * 2) / 3);
  assert.equal(
    result.functions.find((item) => item.functionName === "(idle)").samples,
    1,
  );
  assert.equal(
    result.functions.reduce((sum, item) => sum + item.samples, 0),
    3,
  );
  assert.ok(
    result.functions.every((item) => !Object.hasOwn(item, "cpuMicroseconds")),
  );
  assert.match(result.interpretation, /not CPU time/);
});

test("exclusive function grouping preserves source location and counts repeated call-tree nodes", () => {
  const profile = fixture();
  profile.nodes[1].children = [4, 5];
  profile.nodes.push(
    { id: 4, callFrame: { ...profile.nodes[1].callFrame } },
    { id: 5, callFrame: { ...profile.nodes[1].callFrame, lineNumber: 50 } },
  );
  profile.samples = [2, 4, 5];
  const result = implementation().summarizeProfile(profile);
  const groups = result.functions.filter(
    (item) => item.functionName === "validate",
  );
  assert.equal(groups.length, 2);
  assert.equal(groups.find((item) => item.lineNumber === 12).samples, 2);
  assert.equal(groups.find((item) => item.lineNumber === 12).callTreeNodes, 2);
  assert.equal(groups.find((item) => item.lineNumber === 50).samples, 1);
  assert.equal(
    result.modules.find((item) => item.url === "file:///app/dist/schema.js")
      .samples,
    3,
  );
});

test("incomplete, unsafe and internally inconsistent native profile data fails explicitly", () => {
  const { summarizeProfile } = implementation();
  const mutations = [
    (p) => {
      p.samples = [];
      p.timeDeltas = [];
    },
    (p) => p.samples.push(99),
    (p) => {
      p.samples[0] = 99;
    },
    (p) => {
      p.timeDeltas[1] = -11;
    },
    (p) => {
      p.timeDeltas[1] = Infinity;
    },
    (p) => {
      p.endTime = p.startTime;
    },
    (p) => {
      p.endTime = p.startTime + 20;
    },
    (p) => {
      p.nodes.push(p.nodes[1]);
    },
    (p) => {
      p.nodes[1].callFrame.url = null;
    },
    (p) => {
      p.nodes[0].children = [999];
    },
  ];
  for (const mutate of mutations) {
    const profile = fixture();
    mutate(profile);
    assert.throws(() => summarizeProfile(profile));
  }
});

test("diagnostic bootstrap preserves real native output and records only runtime clock identity", () => {
  const bootstrap = path.resolve(
    __dirname,
    "..",
    "performance",
    "membership-profile-bootstrap.cjs",
  );
  assert.ok(
    fs.existsSync(bootstrap),
    "Diagnostic profile bootstrap must exist",
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "scim-native-profile-"),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--cpu-prof",
        `--cpu-prof-dir=${directory}`,
        "--cpu-prof-name=profile.cpuprofile",
        "--require",
        bootstrap,
        "-e",
        'const end=performance.now()+30;while(performance.now()<end)JSON.parse("{\\"n\\":1}");process.emit("SIGUSR2");',
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SCIM_BENCH_PROFILE: "1",
          SCIM_BENCH_PROFILE_DIRECTORY: directory,
        },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const metadata = JSON.parse(
      fs.readFileSync(
        path.join(directory, "membership-profile-meta.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      Object.keys(metadata).sort(),
      [
        "diagnosticOnly",
        "admissionEligible",
        "nodeVersion",
        "clock",
        "bootstrapNs",
      ].sort(),
    );
    assert.equal(metadata.diagnosticOnly, true);
    assert.equal(metadata.admissionEligible, false);
    assert.equal(metadata.nodeVersion, process.version);
    assert.equal(metadata.clock, "process.hrtime.bigint");
    assert.match(metadata.bootstrapNs, /^\d+$/);
    const profile = JSON.parse(
      fs.readFileSync(path.join(directory, "profile.cpuprofile"), "utf8"),
    );
    assert.ok(
      BigInt(metadata.bootstrapNs) >= BigInt(profile.startTime) * 1000n,
    );
    assert.ok(BigInt(metadata.bootstrapNs) <= BigInt(profile.endTime) * 1000n);
    assert.equal(
      implementation().summarizeProfile(profile).admissionEligible,
      false,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

for (const scenario of ["not-opted-in", "relative-directory"]) {
  test(`diagnostic bootstrap rejects unsafe invocation: ${scenario}`, () => {
    const bootstrap = path.resolve(
      __dirname,
      "..",
      "performance",
      "membership-profile-bootstrap.cjs",
    );
    assert.ok(
      fs.existsSync(bootstrap),
      "Diagnostic profile bootstrap must exist",
    );
    const result = spawnSync(
      process.execPath,
      ["--require", bootstrap, "-e", "process.exit(0)"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SCIM_BENCH_PROFILE: scenario === "not-opted-in" ? "" : "1",
          SCIM_BENCH_PROFILE_DIRECTORY: "relative-directory",
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      scenario === "not-opted-in"
        ? /explicit diagnostic opt-in/
        : /absolute profile directory/,
    );
  });
}

for (const scenario of [
  "complete",
  "signal-failure",
  "signal-race",
  "signal-reinspection-failure",
  "shutdown-inspection-failure",
  "nonzero-exit",
  "already-stopped",
  "copy-failure",
  "profile-copy-failure",
  "metadata-copy-failure",
  "shutdown-timeout",
  "missing-profile-marker",
]) {
  test(`actual native profile capture preserves evidence before cleanup: ${scenario}`, () => {
    const helper = path.resolve(
      __dirname,
      "..",
      "performance",
      "membership-v8-profile.ps1",
    );
    assert.ok(fs.existsSync(helper), "Owned native profile capture must exist");
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "scim-profile-capture-"),
    );
    try {
      const result = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-Command",
          `
        $ErrorActionPreference = 'Stop'
        . '${helper.replaceAll("'", "''")}'
        $directory = '${directory.replaceAll("'", "''")}'
        $scenario = '${scenario}'
        $owned = 'a' * 64
        $script:ownerChecked = $false
        $script:waits = 0
        $script:signalled = $false
        $script:copies = [System.Collections.Generic.List[string]]::new()
        $script:inspections = 0
        $script:exited = $false
        $script:sourceFiles = @{
          'membership.cpuprofile' = '{"synthetic":true}'
          'membership-profile-meta.json' = '{"synthetic":true}'
        }
        function Assert-Owned {
          param($Id)
          if ($Id -cne $owned) { throw 'Unowned profile target' }
          $script:ownerChecked = $true
        }
        function Start-Sleep { param($Milliseconds) $script:waits++ }
        function Invoke-Docker {
          if (!$script:ownerChecked) { throw 'Profile operation before ownership guard' }
          if ($args[0] -eq 'kill') {
            if ($scenario -eq 'missing-profile-marker') { throw 'Profile signal bypassed opt-in marker' }
            if ($args[1] -cne '--signal=USR2' -or $args[2] -cne $owned) { throw 'Unexpected profile signal' }
            if ($scenario -in @('signal-failure', 'signal-reinspection-failure')) { throw 'Profile signal rejected' }
            if ($scenario -eq 'signal-race') {
              $script:exited = $true
              throw 'Profile exited before signal'
            }
            if ($scenario -eq 'already-stopped') { throw 'Profile signalled an exited process' }
            $script:signalled = $true
            return $owned
          }
          if ($args[0] -eq 'inspect') {
            if ($args[1] -cne $owned) { throw 'Unexpected profile inspection' }
            $script:inspections++
            if ($script:inspections -gt 1 -and
                $scenario -in @('signal-reinspection-failure', 'shutdown-inspection-failure')) {
              throw 'State inspection rejected'
            }
            $exitCode = if ($scenario -in @('nonzero-exit', 'already-stopped')) { 1 } else { 0 }
            $labels = if ($scenario -eq 'missing-profile-marker') { @{} } else { @{ 'scimserver.profile' = 'native-function' } }
            return ConvertTo-Json -Depth 5 -Compress -InputObject @(
              @{ Config = @{ Labels = $labels }; State = @{
                Running = (!$script:exited -and $scenario -ne 'already-stopped' -and (!$script:signalled -or $scenario -eq 'shutdown-timeout'))
                ExitCode = $exitCode
              } })
          }
          if ($args[0] -eq 'cp') {
            if (!$args[1].StartsWith($owned + ':/tmp/membership')) { throw 'Unexpected profile source' }
            $script:copies.Add($args[1])
            if ($scenario -eq 'copy-failure' -or
                ($scenario -eq 'profile-copy-failure' -and $args[1].EndsWith('.cpuprofile'))) {
              throw 'Profile copy rejected'
            }
            if ($scenario -eq 'metadata-copy-failure' -and $args[1].EndsWith('-meta.json')) {
              throw 'Metadata copy rejected'
            }
            $name = ($args[1] -split '/')[-1]
            if ($scenario -in @('signal-failure', 'signal-reinspection-failure', 'shutdown-inspection-failure', 'shutdown-timeout') -and
                $name -eq 'membership.cpuprofile') { throw 'Profile not flushed' }
            $script:sourceFiles[$name] | Set-Content -LiteralPath $args[2]
            return
          }
          throw 'Unexpected profile operation'
        }
        $failure = $null
        try { Save-NativeProfile -ContainerId $owned -Directory $directory -Role baseline -WorkComplete $true }
        catch { $failure = $_.Exception.Message }
        $script:sourceFiles.Clear()
        if (($scenario -eq 'complete') -ne ($null -eq $failure)) { throw "Wrong native capture outcome: $failure" }
        if ($scenario -eq 'missing-profile-marker' -and
            $failure -cne 'Owned container is not an opted-in native profiler.') { throw 'Missing explicit profiler opt-in rejection' }
        $receipt = Get-Content (Join-Path $directory 'profile-baseline-status.json') -Raw | ConvertFrom-Json
        if ($receipt.diagnosticOnly -ne $true -or $receipt.admissionEligible -ne $false) {
          throw 'Native capture lost non-admission identity'
        }
        if ($scenario -in @('complete', 'nonzero-exit', 'already-stopped')) {
          if (!$receipt.filesCollected -or !(Test-Path (Join-Path $directory 'profile-baseline.cpuprofile'))) {
            throw 'Native evidence lost before exit rejection or cleanup'
          }
        } elseif ($receipt.filesCollected) { throw 'Incomplete capture became complete' }
        if ($scenario -in @('signal-failure', 'signal-race', 'signal-reinspection-failure', 'shutdown-inspection-failure', 'shutdown-timeout')) {
          $expected = "$owned" + ':/tmp/membership.cpuprofile,' + "$owned" + ':/tmp/membership-profile-meta.json'
          if (($script:copies -join ',') -cne $expected) { throw 'Shutdown failure bypassed independent evidence collection' }
          $metadata = Get-Content (Join-Path $directory 'profile-baseline-meta.json') -Raw | ConvertFrom-Json
          if ($metadata.synthetic -ne $true) { throw 'Bootstrap contents did not survive source-container cleanup' }
          $expectedStage = if ($scenario.StartsWith('signal-')) { 'flush-signal' } else { 'shutdown' }
          $expectedFailure = switch ($scenario) {
            'signal-race' { 'Profile exited before signal' }
            'shutdown-timeout' { 'Owned native profile shutdown exceeded ten seconds.' }
            'shutdown-inspection-failure' { 'State inspection rejected' }
            default { 'Profile signal rejected' }
          }
          if ($failure -cne $expectedFailure -or $receipt.failureStage -cne $expectedStage) {
            throw 'Collection overwrote the original lifecycle failure'
          }
          if ($scenario.StartsWith('signal-') -and $script:inspections -ne 2) {
            throw 'Failed signal was not followed by bounded reinspection'
          }
          if ($scenario -eq 'signal-reinspection-failure' -and $receipt.reinspectionFailed -ne $true) {
            throw 'Secondary inspection failure was not recorded'
          }
          if ($scenario -eq 'signal-race') {
            $profile = Get-Content (Join-Path $directory 'profile-baseline.cpuprofile') -Raw | ConvertFrom-Json
            if ($profile.synthetic -ne $true -or $receipt.exitCode -ne 0) { throw 'Exited profile evidence was lost after signal race' }
          } elseif ($null -ne $receipt.exitCode) { throw 'Unknown process exit became a successful exit code' }
        }
        if ($scenario -eq 'missing-profile-marker' -and $script:copies.Count -ne 0) {
          throw 'Evidence copied without profiler authorization'
        }
        if ($scenario -in @('copy-failure', 'profile-copy-failure', 'metadata-copy-failure')) {
          $expected = "$owned" + ':/tmp/membership.cpuprofile,' + "$owned" + ':/tmp/membership-profile-meta.json'
          if (($script:copies -join ',') -cne $expected) { throw 'A failed copy prevented the other evidence attempt' }
          $metadataFailed = $scenario -eq 'metadata-copy-failure'
          $expectedFailure = if ($metadataFailed) { 'Metadata copy rejected' } else { 'Profile copy rejected' }
          $expectedStage = if ($metadataFailed) { 'copy-metadata' } else { 'copy-profile' }
          if ($failure -cne $expectedFailure -or $receipt.failureStage -cne $expectedStage) {
            throw 'Capture did not propagate the first copy failure and stage'
          }
          if ($scenario -eq 'profile-copy-failure' -and
              !(Test-Path (Join-Path $directory 'profile-baseline-meta.json'))) {
            throw 'Available bootstrap metadata was discarded after profile copy failure'
          }
          if ($metadataFailed -and !(Test-Path (Join-Path $directory 'profile-baseline.cpuprofile'))) {
            throw 'Available CPU profile was discarded after metadata copy failure'
          }
          if ($scenario -ne 'copy-failure') {
            $retainedName = if ($metadataFailed) { 'profile-baseline.cpuprofile' } else { 'profile-baseline-meta.json' }
            $retained = Get-Content (Join-Path $directory $retainedName) -Raw | ConvertFrom-Json
            if ($retained.synthetic -ne $true) { throw 'Retained native evidence contents changed' }
          }
        }
        if ($scenario -eq 'shutdown-timeout' -and $script:waits -ne 100) { throw 'Native shutdown budget changed' }
        if ($scenario -in @('nonzero-exit', 'already-stopped') -and $receipt.exitCode -ne 1) { throw 'Native failure exit lost' }
        if ($scenario -ne 'complete' -and $receipt.captureStatus -cne 'FAIL') { throw 'Failed native capture became success' }
        exit 0
      `,
        ],
        { encoding: "utf8" },
      );
      assert.equal(
        result.status,
        0,
        result.error?.message ?? result.stdout + result.stderr,
      );
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
}
