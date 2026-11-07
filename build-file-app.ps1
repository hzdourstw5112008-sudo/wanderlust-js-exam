$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$moduleFiles = @(
  "api.js",
  "currency.js",
  "dashboard.js",
  "event.js",
  "holidays.js",
  "long-weekends.js",
  "plans.js",
  "router.js",
  "sun-times.js",
  "weather.js",
  "main.js"
)
$bundle = "window.__WanderlustModules = window.__WanderlustModules || {};`r`n"

foreach ($file in $moduleFiles) {
  $module = [IO.Path]::GetFileNameWithoutExtension($file)
  $sourcePath = Join-Path $root "src\js\$file"
  $source = [IO.File]::ReadAllText($sourcePath, [Text.Encoding]::UTF8)

  $source = [regex]::Replace(
    $source,
    '(?m)^import\s+\{\s*([^}]+)\s*\}\s+from\s+"\./([^"]+)";\s*\r?\n',
    {
      param($match)
      $names = $match.Groups[1].Value.Trim()
      $dependency = [IO.Path]::GetFileNameWithoutExtension($match.Groups[2].Value)
      "const { $names } = window.__WanderlustModules['$dependency'];`r`n"
    }
  )
  $source = [regex]::Replace(
    $source,
    '(?m)^import\s+(\w+)\s+from\s+"\./([^"]+)";\s*\r?\n',
    {
      param($match)
      $name = $match.Groups[1].Value
      $dependency = [IO.Path]::GetFileNameWithoutExtension($match.Groups[2].Value)
      "const $name = window.__WanderlustModules['$dependency'].default;`r`n"
    }
  )

  $exportNames = @(
    [regex]::Matches($source, '(?m)^export\s+(?:async\s+)?function\s+(\w+)') |
      ForEach-Object { $_.Groups[1].Value }
  )
  $source = [regex]::Replace(
    $source,
    '(?m)^export\s+(async\s+function|function)\s+(\w+)',
    '$1 $2'
  )

  $className = $null
  if ($source -match '(?m)^export\s+default\s+class\s+(\w+)') {
    $className = $Matches[1]
    $source = [regex]::Replace(
      $source,
      '(?m)^export\s+default\s+class\s+(\w+)',
      'class $1'
    )
  }

  if ($source -match '(?m)^\s*(?:import|export)\b') {
    throw "Unsupported module syntax in $file."
  }

  $bundle += "(() => {`r`n$source`r`nwindow.__WanderlustModules['$module'] = {"
  if ($exportNames.Count -gt 0) {
    $properties = @($exportNames | ForEach-Object { "'$_': $_" })
    $bundle += ($properties -join ", ")
  }
  if ($className) {
    if ($exportNames.Count -gt 0) { $bundle += ", " }
    $bundle += "default: $className"
  }
  $bundle += "};`r`n})();`r`n"
}

$outputPath = Join-Path $root "src\js\file-app.js"
[IO.File]::WriteAllText($outputPath, $bundle, [Text.UTF8Encoding]::new($false))
Write-Output "Generated $outputPath"
