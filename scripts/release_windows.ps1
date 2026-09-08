$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Checked([string] $Program, [string[]] $Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

function Set-ReleaseOutput([string] $Name, [string] $Value) {
    if ($env:GITHUB_OUTPUT) {
        Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "$Name=$Value" -Encoding utf8
    }
}

$windowsPfxBase64 = $env:NIAN_PASS_WINDOWS_PFX_BASE64
$windowsPfxPassword = $env:NIAN_PASS_WINDOWS_PFX_PASSWORD
Remove-Item Env:NIAN_PASS_WINDOWS_PFX_BASE64 -ErrorAction SilentlyContinue
Remove-Item Env:NIAN_PASS_WINDOWS_PFX_PASSWORD -ErrorAction SilentlyContinue

Invoke-Checked "pnpm" @("install", "--frozen-lockfile")
$expectedNode = "v$((Get-Content -LiteralPath ".node-version" -Raw).Trim())"
$expectedPnpm = ((Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json).packageManager -replace "^pnpm@", "")
$expectedRust = (& node "scripts/release_toolchain.mjs" ".mise.toml").Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($expectedRust)) {
    throw "Could not read the pinned Rust version"
}
if ((node --version).Trim() -ne $expectedNode) { throw "Pinned Node $expectedNode is required" }
if ((pnpm --version).Trim() -ne $expectedPnpm) { throw "Pinned pnpm $expectedPnpm is required" }
if (((rustc --version) -split ' ')[1] -ne $expectedRust) { throw "Pinned Rust $expectedRust is required" }
Invoke-Checked "node" @("scripts/check_release_source.mjs", "--clean", "--tag")
$env:NIAN_PASS_COMMIT = (git rev-parse HEAD).Trim()
Invoke-Checked "pnpm" @("--filter", "@nian-pass/desktop", "tauri", "build", "--ci", "--bundles", "nsis", "--target", "x86_64-pc-windows-msvc")
Invoke-Checked "cargo" @("build", "--locked", "--release", "--target", "x86_64-pc-windows-msvc", "-p", "nian-pass-browser-host")

$hostBinary = Resolve-Path "target/x86_64-pc-windows-msvc/release/nian-pass-browser-host.exe"
Invoke-Checked $hostBinary @("--version")
Set-ReleaseOutput "process_smoke" "PASS"

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
Invoke-Checked "node" @("scripts/stage_release.mjs")
Set-ReleaseOutput "build" "PASS"
