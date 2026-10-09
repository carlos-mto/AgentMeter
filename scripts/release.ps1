#Requires -Version 7
# Publishes a GitHub Release: tests, NSIS build, tag, push, installer + SHA-256.
param(
  [switch]$DryRun,
  [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path -Parent $PSScriptRoot)
# Take a scriptblock so the parameter binder never touches native args like `--` or `-a`.
function Exec([scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "'$("$Command".Trim())' failed with exit code $LASTEXITCODE" }
}
# Same, but returns the trimmed output instead of printing it.
function Capture([scriptblock]$Command) {
  $out = & $Command
  if ($LASTEXITCODE -ne 0) { throw "'$("$Command".Trim())' failed with exit code $LASTEXITCODE" }
  return "$out".Trim()
}

$version = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
$installerName = "AgentMeter_${version}_x64-setup.exe"
$installer = Join-Path (Get-Location) "src-tauri/target/release/bundle/nsis/$installerName"
Write-Host "Releasing AgentMeter $version ($tag)$(if ($DryRun) { ' [dry run]' })"

# Preconditions
foreach ($cmd in 'git', 'npm', 'cargo', 'gh') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Required command not found: $cmd" }
}
Exec { gh auth status }
$branch = Capture { git rev-parse --abbrev-ref HEAD }
if ($branch -ne 'main') { throw "Releases must be cut from 'main' (current branch: $branch)." }
if (Capture { git status --porcelain }) { throw 'Working tree is not clean; commit or stash your changes first.' }
Exec { git fetch origin }
if ((Capture { git rev-parse HEAD }) -ne (Capture { git rev-parse origin/main })) {
  throw 'Local HEAD differs from origin/main; push (or pull) before releasing.'
}
if (Capture { git tag --list $tag }) { throw "Tag $tag already exists locally." }
if (Capture { git ls-remote --tags origin $tag }) { throw "Tag $tag already exists on origin." }
& gh release view $tag *> $null
if ($LASTEXITCODE -eq 0) { throw "GitHub release $tag already exists." }

if (-not $SkipTests) {
  Exec { npm test }
  Exec { cargo test --locked --manifest-path src-tauri/Cargo.toml }
}

# A running dev/release build locks the exe and breaks the bundling step.
$releaseDir = Join-Path (Get-Location) 'src-tauri\target\release'
Get-Process agentmeter -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($releaseDir, [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object {
    Write-Host "Stopping running agentmeter process (PID $($_.Id)): $($_.Path)"
    if (-not $DryRun) { Stop-Process -Id $_.Id -Force }
  }

Remove-Item $installer -ErrorAction SilentlyContinue
Exec { npm run tauri -- build --bundles nsis -- --locked }
if (-not (Test-Path $installer)) { throw "Installer not found after build: $installer" }
$sha = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Installer: $installerName`nSHA-256:   $sha"

$notes = @"
Requires Windows 10/11 and the WebView2 Runtime.

The installer is not code-signed; Windows SmartScreen may warn.

- ``$installerName``
- SHA-256: ``$sha``
"@

if ($DryRun) {
  Write-Host "[dry run] git tag -a $tag -m `"AgentMeter $version`"`n[dry run] git push origin $tag"
  Write-Host "[dry run] gh release create $tag `"$installerName`" --title `"AgentMeter $version`" --generate-notes --notes <below>`n$notes"
  return
}

Exec { git tag -a $tag -m "AgentMeter $version" }
Exec { git push origin $tag }
Exec { gh release create $tag $installer --title "AgentMeter $version" --generate-notes --notes $notes }
Write-Host "Release published: $(Capture { gh release view $tag --json url --jq .url })"
