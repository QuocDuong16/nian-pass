$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Checked([string] $Program, [string[]] $Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

function Get-CheckedOutput([string] $Program, [string[]] $Arguments) {
    $output = (& $Program @Arguments | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
    return $output
}

function Get-NormalizedWindowsPath([string] $Path) {
    return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar).ToLowerInvariant()
}

function Assert-PrivateNodeToolCommand([string] $Name, [string] $ToolRoot) {
    $source = (Get-Command $Name -CommandType Application -ErrorAction Stop).Source
    $normalizedSource = Get-NormalizedWindowsPath $source
    $normalizedToolRoot = Get-NormalizedWindowsPath $ToolRoot
    $toolRootPrefix = "$normalizedToolRoot$([System.IO.Path]::DirectorySeparatorChar)"
    if ($normalizedSource -ne $normalizedToolRoot -and -not $normalizedSource.StartsWith($toolRootPrefix)) {
        throw "$Name must resolve under NIAN_PASS_WINDOWS_NODE_TOOL_ROOT; found $source"
    }
    return $source
}

function Set-ReleaseOutput([string] $Name, [string] $Value) {
    if ($env:GITHUB_OUTPUT) {
        Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "$Name=$Value" -Encoding utf8
    }
}

function Convert-PeStackReserve([ValidateSet("dumpbin", "llvm-readobj")] [string] $Source, [string] $Value) {
    $decoded = (& node "scripts/pe_stack_reserve.mjs" $Source $Value | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not ($decoded -match '^[0-9]+$')) {
        throw "Could not parse $Source SizeOfStackReserve '$Value'"
    }
    return [Convert]::ToUInt64($decoded, 10)
}

function Get-PeStackReserve([string] $Binary) {
    $dumpbin = Get-Command "dumpbin.exe" -ErrorAction SilentlyContinue
    if ($dumpbin) {
        $headers = (& $dumpbin.Source /headers $Binary 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) { throw "dumpbin /headers failed with exit code $LASTEXITCODE" }
        $match = [regex]::Match($headers, '(?im)^\s*([0-9a-f]+)\s+size of stack reserve\s*$')
        if ($match.Success) { return Convert-PeStackReserve "dumpbin" $match.Groups[1].Value }
        throw "dumpbin /headers did not report SizeOfStackReserve for $Binary"
    }

    $llvmReadobj = Get-Command "llvm-readobj.exe" -ErrorAction SilentlyContinue
    if (-not $llvmReadobj) { $llvmReadobj = Get-Command "llvm-readobj" -ErrorAction SilentlyContinue }
    if (-not $llvmReadobj) { throw "Neither dumpbin nor llvm-readobj is available to inspect the Windows PE header" }
    $headers = (& $llvmReadobj.Source --file-headers $Binary 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "llvm-readobj --file-headers failed with exit code $LASTEXITCODE" }
    $match = [regex]::Match($headers, '(?im)^\s*SizeOfStackReserve:\s*(0x[0-9a-f]+|[0-9]+)\s*$')
    if (-not $match.Success) { throw "llvm-readobj --file-headers did not report SizeOfStackReserve for $Binary" }
    return Convert-PeStackReserve "llvm-readobj" $match.Groups[1].Value
}

function Format-WindowsExitCode([int] $ExitCode) {
    $raw = [BitConverter]::ToUInt32([BitConverter]::GetBytes($ExitCode), 0)
    return "decimal $ExitCode (0x$($raw.ToString('X8')))"
}

function Stop-DesktopAfterFailedShutdown([System.Diagnostics.Process] $Process) {
    $Process.Refresh()
    if (-not $Process.HasExited) {
        Write-Host "Windows desktop graceful shutdown timed out; process diagnostics:"
        Get-Process -Id $Process.Id -ErrorAction SilentlyContinue | Format-List * | Out-String | Write-Host
        Stop-Process -Id $Process.Id -ErrorAction SilentlyContinue
        Wait-Process -Id $Process.Id -ErrorAction SilentlyContinue
    }
}

function Start-DesktopAndRequireStartup([string] $Binary) {
    $process = Start-Process -FilePath $Binary -PassThru
    Start-Sleep -Seconds 8
    if ($process.HasExited) {
        $formatted = Format-WindowsExitCode $process.ExitCode
        $raw = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int] $process.ExitCode), 0)
        if ($raw -eq 0xC00000FD) {
            throw "Windows desktop startup failed with STATUS_STACK_OVERFLOW (0xC00000FD); exit code $formatted"
        }
        throw "Windows desktop startup failed unexpectedly; exit code $formatted"
    }

    return $process
}

function Test-DesktopGracefulShutdown([System.Diagnostics.Process] $Process) {
    if (-not $Process.CloseMainWindow()) {
        Stop-DesktopAfterFailedShutdown $Process
        throw "Windows desktop graceful shutdown could not request main-window close"
    }
    if (-not $Process.WaitForExit(5000)) {
        Stop-DesktopAfterFailedShutdown $Process
        throw "Windows desktop graceful shutdown timed out after 5 seconds"
    }
    if ($Process.ExitCode -ne 0) {
        $formatted = Format-WindowsExitCode $Process.ExitCode
        throw "Windows desktop graceful shutdown failed unexpectedly; exit code $formatted"
    }
}

function Show-PostBuildSourceDiagnostics {
    $status = (& git status --porcelain=v1 --untracked-files=all | Out-String).TrimEnd()
    if ($LASTEXITCODE -ne 0) {
        throw "git status failed with exit code $LASTEXITCODE"
    }
    if ([string]::IsNullOrWhiteSpace($status)) { return }

    Write-Host "Post-build source diagnostics (working tree is dirty):"
    Write-Host $status
    & git diff --name-status
    if ($LASTEXITCODE -ne 0) { throw "git diff --name-status failed with exit code $LASTEXITCODE" }
    & git diff --numstat
    if ($LASTEXITCODE -ne 0) { throw "git diff --numstat failed with exit code $LASTEXITCODE" }
    & git ls-files --eol apps/desktop/src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw "git ls-files --eol failed with exit code $LASTEXITCODE" }
    if ($status -match '(?m)^.. apps/desktop/src-tauri/Cargo\.toml$') {
        Write-Host "Post-build apps/desktop/src-tauri/Cargo.toml diff:"
        & git diff -- apps/desktop/src-tauri/Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw "git diff Cargo.toml failed with exit code $LASTEXITCODE" }
    }
}

$windowsPfxBase64 = $env:NIAN_PASS_WINDOWS_PFX_BASE64
$windowsPfxPassword = $env:NIAN_PASS_WINDOWS_PFX_PASSWORD
Remove-Item Env:NIAN_PASS_WINDOWS_PFX_BASE64 -ErrorAction SilentlyContinue
Remove-Item Env:NIAN_PASS_WINDOWS_PFX_PASSWORD -ErrorAction SilentlyContinue

$expectedNode = "v$((Get-Content -LiteralPath ".node-version" -Raw).Trim())"
$expectedPnpm = ((Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json).packageManager -replace "^pnpm@", "")
if ((Get-CheckedOutput "node" @("--version")) -ne $expectedNode) { throw "Pinned Node $expectedNode is required" }
if ([string]::IsNullOrWhiteSpace($env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT)) { throw "NIAN_PASS_WINDOWS_NODE_TOOL_ROOT is required" }
if (-not (Test-Path -LiteralPath $env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT -PathType Container)) { throw "NIAN_PASS_WINDOWS_NODE_TOOL_ROOT directory is missing" }
$corepackPath = Assert-PrivateNodeToolCommand "corepack" $env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT
$pnpmPath = Assert-PrivateNodeToolCommand "pnpm" $env:NIAN_PASS_WINDOWS_NODE_TOOL_ROOT
if ((Get-CheckedOutput $corepackPath @("--version")) -ne "0.35.0") { throw "Pinned Corepack 0.35.0 is required" }
if ((Get-CheckedOutput $pnpmPath @("--version")) -ne $expectedPnpm) { throw "Pinned pnpm $expectedPnpm is required" }
$expectedRust = Get-CheckedOutput "node" @("scripts/release_toolchain.mjs", ".mise.toml")
if ([string]::IsNullOrWhiteSpace($expectedRust)) { throw "Could not read the pinned Rust version" }
if (((rustc --version) -split ' ')[1] -ne $expectedRust) { throw "Pinned Rust $expectedRust is required" }
Invoke-Checked "pnpm" @("install", "--frozen-lockfile")
Invoke-Checked "node" @("scripts/check_release_source.mjs", "--clean", "--tag")
$env:NIAN_PASS_COMMIT = (git rev-parse HEAD).Trim()
$env:RELEASE_COMMIT = $env:NIAN_PASS_COMMIT
$env:RELEASE_VERSION = (Get-Content -LiteralPath "VERSION" -Raw).Trim()
Invoke-Checked "pnpm" @("--filter", "@nian-pass/desktop", "tauri", "build", "--ci", "--bundles", "nsis", "--target", "x86_64-pc-windows-msvc")
Invoke-Checked "cargo" @("build", "--locked", "--release", "--target", "x86_64-pc-windows-msvc", "-p", "nian-pass-browser-host")

$desktopBinary = Resolve-Path "target/x86_64-pc-windows-msvc/release/nian-pass-desktop.exe"
$minimumDesktopStackReserve = [UInt64]8388608
$actualDesktopStackReserve = Get-PeStackReserve $desktopBinary
Write-Host "nian-pass-desktop.exe SizeOfStackReserve: $actualDesktopStackReserve bytes"
if ($actualDesktopStackReserve -lt $minimumDesktopStackReserve) {
    throw "nian-pass-desktop.exe SizeOfStackReserve $actualDesktopStackReserve bytes is below required $minimumDesktopStackReserve bytes"
}
Set-ReleaseOutput "desktop_pe_stack_reserve" "PASS"

$desktopProcess = Start-DesktopAndRequireStartup $desktopBinary
Set-ReleaseOutput "desktop_startup_smoke" "PASS"
Test-DesktopGracefulShutdown $desktopProcess
Set-ReleaseOutput "desktop_shutdown_smoke" "PASS"

$hostBinary = Resolve-Path "target/x86_64-pc-windows-msvc/release/nian-pass-browser-host.exe"
Invoke-Checked $hostBinary @("--version")
Set-ReleaseOutput "native_messaging_host_smoke" "PASS"

$signingValues = @(
    $windowsPfxBase64,
    $windowsPfxPassword
)
$configuredSigningValues = @($signingValues | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($configuredSigningValues.Count -eq 0) {
    Set-ReleaseOutput "signing" "NOT CONFIGURED"
} elseif ($configuredSigningValues.Count -ne $signingValues.Count) {
    throw "Windows Authenticode signing configuration is incomplete"
} else {
    $pfxPath = Join-Path $env:RUNNER_TEMP "nian-pass-release-signing.pfx"
    $certificate = $null
    try {
        [IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($windowsPfxBase64))
        $securePassword = ConvertTo-SecureString $windowsPfxPassword -AsPlainText -Force
        $certificate = Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\CurrentUser\My -Password $securePassword -Exportable:$false
        if (-not $certificate.HasPrivateKey) { throw "Imported Authenticode certificate has no private key" }
        $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter signtool.exe -Recurse |
            Sort-Object FullName -Descending | Select-Object -First 1
        if (-not $signtool) { throw "Windows SDK signtool.exe was not found" }
        $targets = @($hostBinary) + @(Get-ChildItem -Recurse -File "target/x86_64-pc-windows-msvc/release/bundle/nsis" -Filter *.exe | Select-Object -ExpandProperty FullName)
        if ($targets.Count -lt 2) { throw "Expected the native host and at least one NSIS installer for signing" }
        foreach ($target in $targets) {
            Invoke-Checked $signtool.FullName @("sign", "/sha1", $certificate.Thumbprint, "/fd", "SHA256", "/tr", "http://timestamp.digicert.com", "/td", "SHA256", $target)
            Invoke-Checked $signtool.FullName @("verify", "/pa", "/v", $target)
        }
        Set-ReleaseOutput "signing" "PASS"
    } finally {
        if ($certificate) { Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force }
        Remove-Item -LiteralPath $pfxPath -Force -ErrorAction SilentlyContinue
        $windowsPfxBase64 = $null
        $windowsPfxPassword = $null
    }
}

Invoke-Checked "node" @("scripts/package_native_host.mjs", "windows-x86_64", $hostBinary)
Show-PostBuildSourceDiagnostics
Invoke-Checked "node" @("scripts/check_release_source.mjs", "--postbuild")
Invoke-Checked "node" @("scripts/stage_release.mjs")
Set-ReleaseOutput "build" "PASS"
