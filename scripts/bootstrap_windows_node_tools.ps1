[CmdletBinding()]
param(
  [switch] $VerifyOnly
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

function Invoke-CheckedNative {
  param([string] $Name, [scriptblock] $Command)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

function Get-CheckedNativeOutput {
  param([string] $Name, [scriptblock] $Command)
  $output = (& $Command | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
  return $output
}

function Get-NormalizedWindowsPath {
  param([string] $Path)
  return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar).ToLowerInvariant()
}

function Assert-PathUnderRunnerTemp {
  param([string] $Name, [string] $Path, [string] $ExpectedPath)
  if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { throw "RUNNER_TEMP is required for private Node tooling" }
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "$Name is required" }
  $normalizedRunnerTemp = Get-NormalizedWindowsPath $env:RUNNER_TEMP
  $normalizedPath = Get-NormalizedWindowsPath $Path
  $runnerTempPrefix = "$normalizedRunnerTemp$([System.IO.Path]::DirectorySeparatorChar)"
  if (-not $normalizedPath.StartsWith($runnerTempPrefix)) { throw "$Name must resolve under RUNNER_TEMP; found $Path" }
  if ($normalizedPath -ne (Get-NormalizedWindowsPath $ExpectedPath)) { throw "$Name must match its reviewed private location; found $Path" }
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Name directory is missing: $Path" }
  return $normalizedPath
}

function Assert-PrivateToolCommand {
  param([string] $Name, [string] $ToolRoot)
  $commands = @(Get-Command $Name -CommandType Application -All -ErrorAction Stop)
  if ($commands.Count -eq 0) { throw "$Name is not available" }
  $selected = $commands[0]
  $source = [string] $selected.Path
  if ([string]::IsNullOrWhiteSpace($source)) { throw "$Name effective command has no executable path" }
  $normalizedSource = Get-NormalizedWindowsPath $source
  $normalizedToolRoot = Get-NormalizedWindowsPath $ToolRoot
  $toolRootPrefix = "$normalizedToolRoot$([System.IO.Path]::DirectorySeparatorChar)"
  if ($normalizedSource -ne $normalizedToolRoot -and -not $normalizedSource.StartsWith($toolRootPrefix)) {
    $discovered = @($commands | Select-Object -First 4 | ForEach-Object { [string] $_.Path }) -join "`n- "
    throw "$Name effective command is outside the private tool root:`neffective: $source`ndiscovered candidates:`n- $discovered"
  }
  return $source
}

function Assert-PinnedNode {
  $expectedNode = "v$env:NODE_VERSION"
  $actualNode = Get-CheckedNativeOutput "node --version" { node --version }
  if ($actualNode -ne $expectedNode) { throw "Expected Node $expectedNode but found $actualNode" }
  return $actualNode
}

function Assert-CorepackVersion {
  param([string] $CorepackPath)
  $corepackVersion = Get-CheckedNativeOutput "corepack --version" { & $CorepackPath --version }
  if ($corepackVersion -ne $env:COREPACK_VERSION) { throw "Expected Corepack $env:COREPACK_VERSION but found $corepackVersion" }
  return $corepackVersion
}

function Assert-PnpmRuntimeNode {
  param([string] $ToolRoot, [string] $PnpmPath)
  $guardPath = Join-Path $ToolRoot "assert-pnpm-node-runtime.cjs"
  @'
const expected = process.env.NIAN_PASS_EXPECTED_NODE_VERSION;
if (process.version !== `v${expected}`) {
  throw new Error(`pnpm is running under ${process.version}; expected v${expected}`);
}
'@ | Set-Content -LiteralPath $guardPath -Encoding utf8
  $previousNodeOptions = $env:NODE_OPTIONS
  $previousExpectedNode = $env:NIAN_PASS_EXPECTED_NODE_VERSION
  try {
    $env:NIAN_PASS_EXPECTED_NODE_VERSION = $env:NODE_VERSION
    $env:NODE_OPTIONS = "--require=$guardPath"
    Invoke-CheckedNative "pnpm runtime Node guard" { & $PnpmPath --version | Out-Null }
  } finally {
    if ($null -eq $previousNodeOptions) { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue } else { $env:NODE_OPTIONS = $previousNodeOptions }
    if ($null -eq $previousExpectedNode) { Remove-Item Env:NIAN_PASS_EXPECTED_NODE_VERSION -ErrorAction SilentlyContinue } else { $env:NIAN_PASS_EXPECTED_NODE_VERSION = $previousExpectedNode }
    Remove-Item -LiteralPath $guardPath -Force -ErrorAction SilentlyContinue
  }
}

function Assert-PnpmVersion {
  param([string] $PnpmPath)
  $pnpmVersion = Get-CheckedNativeOutput "pnpm --version" { & $PnpmPath --version }
  if ($pnpmVersion -ne $env:PNPM_VERSION) { throw "Expected pnpm $env:PNPM_VERSION but found $pnpmVersion" }
  return $pnpmVersion
}

function Assert-PrivateToolchain {
  param([string] $ToolRoot)
  $nodeVersion = Assert-PinnedNode
  $corepackPath = Assert-PrivateToolCommand "corepack" $ToolRoot
  $corepackVersion = Assert-CorepackVersion $corepackPath
  $pnpmPath = Assert-PrivateToolCommand "pnpm" $ToolRoot
  Assert-PnpmRuntimeNode $ToolRoot $pnpmPath
  $pnpmVersion = Assert-PnpmVersion $pnpmPath
  return [PSCustomObject]@{ NodeVersion = $nodeVersion; CorepackVersion = $corepackVersion; PnpmVersion = $pnpmVersion; CorepackCommand = $corepackPath; PnpmCommand = $pnpmPath }
}

function Set-WorkflowEnvironment {
  param([string] $Name, [string] $Value)
  if ([string]::IsNullOrWhiteSpace($env:GITHUB_ENV)) { throw "GITHUB_ENV is required to persist $Name" }
  Add-Content -LiteralPath $env:GITHUB_ENV -Value "$Name=$Value"
}

function Add-WorkflowPath {
  param([string] $Path)
  if ([string]::IsNullOrWhiteSpace($env:GITHUB_PATH)) { throw "GITHUB_PATH is required to persist the private Node tool path" }
  Add-Content -LiteralPath $env:GITHUB_PATH -Value $Path
}

if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { throw "RUNNER_TEMP is required for private Node tooling" }
$toolRoot = Join-Path $env:RUNNER_TEMP "nian-pass-node-tools"
$corepackHome = Join-Path $env:RUNNER_TEMP "nian-pass-corepack-home"

if ($VerifyOnly) {
  if ([string]::IsNullOrWhiteSpace($env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT)) { throw "NIAN_PASS_WINDOWS_NODE_TOOL_ROOT is required for VerifyOnly" }
  Assert-PathUnderRunnerTemp "NIAN_PASS_WINDOWS_NODE_TOOL_ROOT" $env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT $toolRoot | Out-Null
  Assert-PathUnderRunnerTemp "COREPACK_HOME" $env:COREPACK_HOME $corepackHome | Out-Null
  $toolchain = Assert-PrivateToolchain $env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT
  Write-Host "WINDOWS_NODE_VERIFY=PASS"
  Write-Host "WINDOWS_NODE_VERSION=$($toolchain.NodeVersion)"
  Write-Host "WINDOWS_COREPACK_VERSION=$($toolchain.CorepackVersion)"
  Write-Host "WINDOWS_PNPM_VERSION=$($toolchain.PnpmVersion)"
  Write-Host "WINDOWS_COREPACK_COMMAND=$($toolchain.CorepackCommand)"
  Write-Host "WINDOWS_PNPM_COMMAND=$($toolchain.PnpmCommand)"
  Write-Host "WINDOWS_PNPM_RUNTIME_NODE=$($toolchain.NodeVersion)"
} else {
  Assert-PinnedNode | Out-Null
  Remove-Item -LiteralPath $toolRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $corepackHome -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $corepackHome -Force | Out-Null
  $env:COREPACK_HOME = $corepackHome
  Invoke-CheckedNative "private Corepack install" { npm install --global --prefix $toolRoot "corepack@$env:COREPACK_VERSION" }

  # Corepack writes its pnpm shim into this reviewed directory, never into a
  # runner-global npm prefix such as C:\npm\prefix.
  $env:Path = "$toolRoot;$env:Path"
  $corepackPath = Assert-PrivateToolCommand "corepack" $toolRoot
  Invoke-CheckedNative "private Corepack enable" { & $corepackPath enable --install-directory $toolRoot }
  Invoke-CheckedNative "private pnpm activation" { & $corepackPath prepare "pnpm@$env:PNPM_VERSION" --activate }
  $toolchain = Assert-PrivateToolchain $toolRoot
  Set-WorkflowEnvironment "COREPACK_HOME" $corepackHome
  Set-WorkflowEnvironment "NIAN_PASS_WINDOWS_NODE_TOOL_ROOT" $toolRoot
  Add-WorkflowPath $toolRoot
  Write-Host "WINDOWS_NODE_VERSION=$($toolchain.NodeVersion)"
  Write-Host "WINDOWS_COREPACK_VERSION=$($toolchain.CorepackVersion)"
  Write-Host "WINDOWS_PNPM_VERSION=$($toolchain.PnpmVersion)"
  Write-Host "WINDOWS_COREPACK_COMMAND=$($toolchain.CorepackCommand)"
  Write-Host "WINDOWS_PNPM_COMMAND=$($toolchain.PnpmCommand)"
  Write-Host "WINDOWS_NODE_TOOL_ROOT=$toolRoot"
  Write-Host "WINDOWS_PNPM_RUNTIME_NODE=$($toolchain.NodeVersion)"
}
