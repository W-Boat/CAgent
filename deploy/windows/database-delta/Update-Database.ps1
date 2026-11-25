[CmdletBinding()]
param([string]$InstallRoot, [string[]]$KnowledgeBase, [switch]$PreviewOnly, [switch]$Yes)
$ErrorActionPreference = 'Stop'
function Test-Installation([string]$Directory) {
    ((Test-Path -LiteralPath (Join-Path $Directory 'data\config.json') -PathType Leaf) -or (Test-Path -LiteralPath (Join-Path $Directory '.env') -PathType Leaf)) -and
        (Test-Path -LiteralPath (Join-Path $Directory 'apps\api\node_modules\@prisma\client') -PathType Container)
}

if (-not $InstallRoot) {
    $parent = Split-Path -Parent $PSScriptRoot
    foreach ($candidate in @($parent, (Join-Path $parent 'CAgent'))) {
        if (Test-Installation $candidate) { $InstallRoot = $candidate; break }
    }
}
if (-not $InstallRoot) { $InstallRoot = (Read-Host 'Existing CAgent installation directory (contains data\config.json or .env)').Trim('"') }
if (-not $InstallRoot) { throw 'Select an existing installation directory.' }
$root = (Resolve-Path -LiteralPath $InstallRoot).Path
if (-not (Test-Installation $root)) {
    throw 'The selected directory is not an installed CAgent Windows package.'
}
$node = @('runtime\node\node.exe', 'runtime\node.exe') | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $node) {
    $installedNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $installedNode) { throw 'Node.js 22 was not found in the installation or on PATH.' }
    $node = $installedNode.Source
}
$script = Join-Path $PSScriptRoot 'update.cjs'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$catalogJson = & $node $script '--list'
if ($LASTEXITCODE -ne 0) { throw 'Could not read the package knowledge catalog.' }
$catalog = @($catalogJson | ConvertFrom-Json)
if (-not $KnowledgeBase -and -not $PreviewOnly -and -not $Yes) {
    for ($i = 0; $i -lt $catalog.Count; $i++) {
        Write-Host ('{0}. {1} ({2})' -f ($i + 1), $catalog[$i].name, $catalog[$i].count)
    }
    $choice = (Read-Host 'Enter numbers separated by commas, ALL for every library, or Enter to cancel').Trim()
    if (-not $choice) { Write-Host 'Cancelled.'; return }
    if ($choice -ne 'ALL') {
        $KnowledgeBase = @($choice -split '[,，\s]+' | ForEach-Object {
            $number = 0
            if (-not [int]::TryParse($_, [ref]$number) -or $number -lt 1 -or $number -gt $catalog.Count) {
                throw "Invalid library number: $_"
            }
            $catalog[$number - 1].id
        })
    }
}
$json = & $node $script $root '--preview' @KnowledgeBase
if ($LASTEXITCODE -ne 0) { throw 'Database preview failed.' }
$report = $json | ConvertFrom-Json
Write-Host "Installation: $root"
foreach ($source in $report.counts.PSObject.Properties) {
    $part = $source.Value
    $label = ($catalog | Where-Object {$_.id -eq $source.Name}).name
    Write-Host ('{0}: add {1}, existing {2}, blocked {3}, new library {4}' -f $label, $part.add, $part.exists, $part.blocked, $part.newBase)
}
if ($report.rows -eq 0 -and $report.bases -eq 0) { Write-Host 'No changes needed.'; return }
if ($PreviewOnly) { return }
if (-not $Yes -and (Read-Host 'Type ADD to insert only the missing records') -cne 'ADD') { Write-Host 'Cancelled.'; return }
$resultJson = & $node $script $root '--apply' $report.token @KnowledgeBase
if ($LASTEXITCODE -ne 0) { throw 'Database delta failed.' }
$result = ($resultJson | ConvertFrom-Json).inserted
Write-Host ('Database delta applied: {0} new libraries, {1} new knowledge entries, {2} new guide records.' -f $result.bases,$result.entries,$result.guide)
Write-Host 'Restart CAgent when convenient to reload its in-memory search index.'
