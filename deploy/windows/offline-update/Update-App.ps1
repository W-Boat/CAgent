[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath $InstallRoot).ProviderPath
$root = $root.TrimEnd('\')
$prefix = $root + '\'
$payload = Join-Path $PSScriptRoot 'payload'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'app-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 'cagent-offline-update-v1') { throw 'Unsupported app update package.' }

function Resolve-InstallTree([string]$RelativePath) {
    $target = Join-Path $root $RelativePath
    $item = Get-Item -LiteralPath $target
    if (-not $item.PSIsContainer -or $item.FullName -ne $target) { throw "Unexpected installation path: $target" }
    $part = $item
    while ($part.FullName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        if ($part.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked installation directories are not supported: $($part.FullName)" }
        $part = $part.Parent
    }
    return $target
}
$targets = @{ api = (Resolve-InstallTree 'apps\api\dist'); web = (Resolve-InstallTree 'apps\web\dist') }
$pidFile = Join-Path $root 'data\runtime.pid'
if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
    $running = Get-Content -LiteralPath $pidFile -Raw
    if ($running -match '^\d+$' -and (Get-Process -Id ([int]$running) -ErrorAction SilentlyContinue)) { throw 'Stop the running CAgent instance before updating its application files.' }
}

$manifestPaths = @{}
foreach ($asset in $manifest.files) {
    if ($asset.path -notmatch '^(api|web)/[a-zA-Z0-9_./()-]+$' -or $asset.path -match '(^|/)\.\.?(/|$)' -or $manifestPaths.ContainsKey($asset.path)) {
        throw 'Unexpected file path in the app update manifest.'
    }
    $file = Join-Path $payload $asset.path
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $asset.sha256) { throw "Checksum mismatch: $($asset.path)" }
    $manifestPaths[$asset.path] = $true
}
$present = @(Get-ChildItem -LiteralPath $payload -Recurse -File)
if ($present.Count -ne $manifestPaths.Count) { throw 'The app payload contains unexpected files.' }
foreach ($file in $present) {
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected linked file in the app payload.' }
    $relative = $file.FullName.Substring($payload.Length + 1).Replace('\','/')
    if (-not $manifestPaths.ContainsKey($relative)) { throw "Unexpected file: $relative" }
}
if (-not ($manifestPaths.ContainsKey('api/src/main.js') -and $manifestPaths.ContainsKey('web/index.html'))) { throw 'The package is missing an application entry point.' }

$recovery = Join-Path $root ('.cagent-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $recovery | Out-Null
Write-Host "Preparing update in: $recovery"
$state = @{}
foreach ($app in @('api', 'web')) {
    $staged = Join-Path $recovery ($app + '-staged')
    $old = Join-Path $recovery ($app + '-before')
    # Stage a copy of the installed files first, retaining local map assets and older web chunks.
    Copy-Item -LiteralPath $targets[$app] -Destination $staged -Recurse
    Copy-Item -Path (Join-Path (Join-Path $payload $app) '*') -Destination $staged -Recurse -Force
    if ($app -eq 'web') {
        # Existing per-route pages can retain their own deployment-specific OG metadata.
        $modules = '<(?:script\b[^>]*\bsrc="/assets/[^"<>]+"[^>]*>\s*</script>|link\b[^>]*\bhref="/assets/[^"<>]+"[^>]*>)'
        $newIndex = [IO.File]::ReadAllText((Join-Path $staged 'index.html'))
        $tags = ([regex]::Matches($newIndex, $modules) | ForEach-Object { $_.Value }) -join "`n    "
        if (-not $tags) { throw 'The new frontend has no module assets.' }
        foreach ($route in (Get-ChildItem -LiteralPath $staged -Recurse -Filter 'index.html' -File)) {
            if ($route.DirectoryName -eq $staged) { continue }
            $html = [IO.File]::ReadAllText($route.FullName)
            if ($html -notmatch 'id="app"' -or $html -notmatch '<script\b[^>]*\bsrc="/assets/index-[^"<>]+"') { continue }
            $html = [regex]::Replace([regex]::Replace($html, $modules, ''), '</head>', [Text.RegularExpressions.MatchEvaluator]{ param($match) "$tags`n  $($match.Value)" }, 'IgnoreCase')
            [IO.File]::WriteAllText($route.FullName, $html, [Text.UTF8Encoding]::new($false))
        }
    }
    $state[$app] = @{ staged = $staged; old = $old; originalMoved = $false; installed = $false }
}

try {
    foreach ($app in @('api', 'web')) {
        $change = $state[$app]
        Move-Item -LiteralPath $targets[$app] -Destination $change.old
        $change.originalMoved = $true
        Move-Item -LiteralPath $change.staged -Destination $targets[$app]
        $change.installed = $true
    }
} catch {
    $failure = $_
    foreach ($app in @('web', 'api')) {
        $change = $state[$app]
        if ($change.originalMoved) {
            if ($change.installed) { Move-Item -LiteralPath $targets[$app] -Destination $change.staged }
            Move-Item -LiteralPath $change.old -Destination $targets[$app]
        }
    }
    throw $failure
}
Write-Host 'Application files installed. Start CAgent using your existing startup method.'
Write-Host "Previous files are available at: $recovery"
