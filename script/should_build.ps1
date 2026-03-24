param(
  [string[]]$SourcePaths = @(
    "client/src",
    "server",
    "shared",
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "script/build.ts",
    "script/should_build.ps1"
  ),
  [string[]]$DistPaths = @(
    "dist/index.cjs",
    "dist/public/index.html"
  )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-LatestWriteUtc {
  param([string[]]$Paths)
  $latest = [datetime]::MinValue

  foreach ($path in $Paths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }

    $item = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    if ($null -eq $item) { continue }

    if ($item.PSIsContainer) {
      $candidate = Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
      if ($null -ne $candidate -and $candidate.LastWriteTimeUtc -gt $latest) {
        $latest = $candidate.LastWriteTimeUtc
      }
      continue
    }

    if ($item.LastWriteTimeUtc -gt $latest) {
      $latest = $item.LastWriteTimeUtc
    }
  }

  return $latest
}

$latestSource = Get-LatestWriteUtc -Paths $SourcePaths
$latestDist = Get-LatestWriteUtc -Paths $DistPaths

if ($latestSource -eq [datetime]::MinValue) {
  "build"
  exit 0
}

if ($latestDist -eq [datetime]::MinValue) {
  "build"
  exit 0
}

if ($latestSource -gt $latestDist) {
  "build"
} else {
  "skip"
}
