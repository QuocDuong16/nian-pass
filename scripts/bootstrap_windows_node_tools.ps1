[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

function Invoke-CheckedNative {
  param(
    [string] $Name,
    [scriptblock] $Command
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

function Get-NormalizedWindowsPath {
  param([string] $Path)

  return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar).ToLowerInvariant()
}

function Assert-PrivateToolCommand {
  param(
    [string] $Name,
    [string] $ToolRoot
  )

  $source = (Get-Command $Name -CommandType Application -ErrorAction Stop).Source
  $normalizedSource = Get-NormalizedWindowsPath $source
  $normalizedToolRoot = Get-NormalizedWindowsPath $ToolRoot
  $toolRootPrefix = "$normalizedToolRoot$([System.IO.Path]::DirectorySeparatorChar)"
  if (
    $normalizedSource -ne $normalizedToolRoot -and
    -not $normalizedSource.StartsWith($toolRootPrefix)
  ) {
    throw "$Name must resolve under the private tool root; found $source"
  }
  return $source
}

function Set-WorkflowEnvironment {
  param(
    [string] $Name,
    [string] $Value
  )

  if ([string]::IsNullOrWhiteSpace($env:GITHUB_ENV)) {
    throw "GITHUB_ENV is required to persist $Name"
  }
  Add-Content -LiteralPath $env:GITHUB_ENV -Value "$Name=$Value"
}

function Add-WorkflowPath {
  param([string] $Path)

  if ([string]::IsNullOrWhiteSpace($env:GITHUB_PATH)) {
    throw "GITHUB_PATH is required to persist the private Node tool path"
  }
  Add-Content -LiteralPath $env:GITHUB_PATH -Value $Path
}

$expectedNode = "v$env:NODE_VERSION"
Invoke-CheckedNative "node --version" { node --version | Out-Null }
$actualNode = (node --version).Trim()
if ($actualNode -ne $expectedNode) {
  throw "Expected Node $expectedNode but found $actualNode"
}
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  throw "RUNNER_TEMP is required for private Node tooling"
}

$toolRoot = Join-Path $env:RUNNER_TEMP "nian-pass-node-tools"
$corepackHome = Join-Path $env:RUNNER_TEMP "nian-pass-corepack-home"
Remove-Item -LiteralPath $toolRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $corepackHome -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
New-Item -ItemType Directory -Path $corepackHome -Force | Out-Null

$env:COREPACK_HOME = $corepackHome
Invoke-CheckedNative "private Corepack install" {
  npm install --global --prefix $toolRoot "corepack@$env:COREPACK_VERSION"
}

# Corepack writes its pnpm shim into this reviewed directory, never into a
# runner-global npm prefix such as C:\npm\prefix.
$env:Path = "$toolRoot;$env:Path"
$corepackPath = Assert-PrivateToolCommand "corepack" $toolRoot
Invoke-CheckedNative "corepack --version" { & $corepackPath --version | Out-Null }
$corepackVersion = (& $corepackPath --version).Trim()
if ($corepackVersion -ne $env:COREPACK_VERSION) {
  throw "Expected Corepack $env:COREPACK_VERSION but found $corepackVersion"
}

Invoke-CheckedNative "private Corepack enable" {
  & $corepackPath enable --install-directory $toolRoot
}
Invoke-CheckedNative "private pnpm activation" {
  & $corepackPath prepare "pnpm@$env:PNPM_VERSION" --activate
}
$pnpmPath = Assert-PrivateToolCommand "pnpm" $toolRoot

$guardPath = Join-Path $toolRoot "assert-pnpm-node-runtime.cjs"
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
  Invoke-CheckedNative "pnpm runtime Node guard" { & $pnpmPath --version | Out-Null }
  $pnpmVersion = (& $pnpmPath --version).Trim()
  if ($pnpmVersion -ne $env:PNPM_VERSION) {
    throw "Expected pnpm $env:PNPM_VERSION but found $pnpmVersion"
  }
} finally {
  if ($null -eq $previousNodeOptions) {
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  } else {
    $env:NODE_OPTIONS = $previousNodeOptions
  }
  if ($null -eq $previousExpectedNode) {
    Remove-Item Env:NIAN_PASS_EXPECTED_NODE_VERSION -ErrorAction SilentlyContinue
  } else {
    $env:NIAN_PASS_EXPECTED_NODE_VERSION = $previousExpectedNode
  }
  Remove-Item -LiteralPath $guardPath -Force -ErrorAction SilentlyContinue
}

Set-WorkflowEnvironment "COREPACK_HOME" $corepackHome
Set-WorkflowEnvironment "NIAN_PASS_WINDOWS_NODE_TOOL_ROOT" $toolRoot
Add-WorkflowPath $toolRoot

Write-Host "WINDOWS_NODE_VERSION=$actualNode"
Write-Host "WINDOWS_COREPACK_VERSION=$corepackVersion"
Write-Host "WINDOWS_PNPM_VERSION=$pnpmVersion"
Write-Host "WINDOWS_NODE_TOOL_ROOT=$toolRoot"
Write-Host "WINDOWS_PNPM_RUNTIME_NODE=$expectedNode"
