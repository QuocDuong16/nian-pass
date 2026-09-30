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

function Assert-PnpmVersion {
  param([string] $PnpmPath)
  $pnpmVersion = Get-CheckedNativeOutput "pnpm --version" { & $PnpmPath --version }
  if ($pnpmVersion -ne $env:PNPM_VERSION) { throw "Expected pnpm $env:PNPM_VERSION but found $pnpmVersion" }
  return $pnpmVersion
}

function Assert-PrivateToolchain {
  param([string] $ToolRoot)
  $nodeVersion = Assert-PinnedNode
  $pnpmPath = Assert-PrivateToolCommand "pnpm" $ToolRoot
  $pnpmVersion = Assert-PnpmVersion $pnpmPath
  return [PSCustomObject]@{ NodeVersion = $nodeVersion; PnpmVersion = $pnpmVersion; PnpmCommand = $pnpmPath }
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

if ($VerifyOnly) {
  if ([string]::IsNullOrWhiteSpace($env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT)) { throw "NIAN_PASS_WINDOWS_NODE_TOOL_ROOT is required for VerifyOnly" }
  Assert-PathUnderRunnerTemp "NIAN_PASS_WINDOWS_NODE_TOOL_ROOT" $env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT $toolRoot | Out-Null
  $toolchain = Assert-PrivateToolchain $env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT
  Write-Host "WINDOWS_NODE_VERIFY=PASS"
  Write-Host "WINDOWS_NODE_VERSION=$($toolchain.NodeVersion)"
  Write-Host "WINDOWS_PNPM_VERSION=$($toolchain.PnpmVersion)"
  Write-Host "WINDOWS_PNPM_COMMAND=$($toolchain.PnpmCommand)"
} else {
  Assert-PinnedNode | Out-Null
  Remove-Item -LiteralPath $toolRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
  Invoke-CheckedNative "private pnpm install" { npm install --global --prefix $toolRoot "pnpm@$env:PNPM_VERSION" }

  # Keep the pnpm executable and npm shim inside the reviewed private directory.
  $env:Path = "$toolRoot;$env:Path"
  $toolchain = Assert-PrivateToolchain $toolRoot
  Set-WorkflowEnvironment "NIAN_PASS_WINDOWS_NODE_TOOL_ROOT" $toolRoot
  Add-WorkflowPath $toolRoot
  Write-Host "WINDOWS_NODE_VERSION=$($toolchain.NodeVersion)"
  Write-Host "WINDOWS_PNPM_VERSION=$($toolchain.PnpmVersion)"
  Write-Host "WINDOWS_PNPM_COMMAND=$($toolchain.PnpmCommand)"
  Write-Host "WINDOWS_NODE_TOOL_ROOT=$toolRoot"
}
