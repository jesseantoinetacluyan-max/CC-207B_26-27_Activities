param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('run','web','apks','check-key')]
  [string]$Action
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (!(Test-Path 'pubspec.yaml') -or !(Test-Path 'lib/main.dart')) {
    throw 'This is not the Unit 8 Profile Flutter project root. pubspec.yaml and lib/main.dart must be beside the CMD files.'
  }
  $flutter = Get-Command flutter -ErrorAction SilentlyContinue
  if (!$flutter) { throw 'Flutter was not found in PATH. Open a new Command Prompt after fixing Flutter PATH.' }
  function Read-RequiredLine([string]$FileName, [string]$Label) {
    $path = Join-Path $root $FileName
    if (!(Test-Path $path)) { throw "$FileName is missing. Create it beside pubspec.yaml and put $Label on its first line." }
    $value = (Get-Content -LiteralPath $path -TotalCount 1 -ErrorAction Stop)
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace($value)) { throw "$FileName is empty. Put $Label on its first line." }
    return ([string]$value).Trim()
  }
  $key = Read-RequiredLine 'omdb-key.txt' 'your OMDb key'
  $cms = Read-RequiredLine 'cms-url.txt' 'your public HTTPS CMS base URL (no /api/picks at the end)'
  if ($cms -notmatch '^https://[^\s]+$') { throw 'cms-url.txt must contain one HTTPS base URL only, for example https://your-service.example. Do not include /api/picks.' }
  switch ($Action) {
    'run' {
      Write-Host 'Launching Flutter in Chrome. The key value itself is not printed by this helper.'
      & flutter run -d chrome "--dart-define=OMDB_KEY=$key" "--dart-define=CMS_URL=$cms"
      if ($LASTEXITCODE -ne 0) { throw "flutter run failed with exit code $LASTEXITCODE." }
    }
    'web' {
      $repo = $root
      while (!(Test-Path (Join-Path $repo '.git'))) {
        $parent = Split-Path -Parent $repo
        if (!$parent -or $parent -eq $repo) { throw 'Cannot find the Git repository above this Flutter project.' }
        $repo = $parent
      }
      $remote = (& git -C $repo remote get-url origin 2>$null | Select-Object -First 1)
      if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remote)) { throw 'Could not read Git remote origin. Verify this is your cloned personal fork.' }
      $repoName = (($remote.Trim() -split '/')[-1] -replace '\.git$','')
      if ([string]::IsNullOrWhiteSpace($repoName)) { throw 'Could not determine the GitHub repository name from origin.' }
      $baseHref = "/$repoName/"
      Write-Host "Building GitHub Pages site with base href $baseHref"
      & flutter build web --release --base-href $baseHref "--dart-define=OMDB_KEY=$key" "--dart-define=CMS_URL=$cms"
      if ($LASTEXITCODE -ne 0) { throw "flutter build web failed with exit code $LASTEXITCODE." }
      if (!(Test-Path 'build/web/main.dart.js')) { throw 'Flutter returned success but build/web/main.dart.js is missing.' }
      Write-Host 'Web release output: build\web'
    }
    'apks' {
      Write-Host 'Building release APK (the exercise permits Flutter default debug signing).'
      & flutter build apk --release "--dart-define=OMDB_KEY=$key" "--dart-define=CMS_URL=$cms"
      if ($LASTEXITCODE -ne 0) { throw "Release APK build failed with exit code $LASTEXITCODE." }
      Write-Host 'Building debug APK...'
      & flutter build apk --debug "--dart-define=OMDB_KEY=$key" "--dart-define=CMS_URL=$cms"
      if ($LASTEXITCODE -ne 0) { throw "Debug APK build failed with exit code $LASTEXITCODE." }
      $apkDir = Join-Path $root 'build/app/outputs/flutter-apk'
      foreach ($name in @('app-release.apk','app-debug.apk')) {
        $file = Join-Path $apkDir $name
        if (!(Test-Path $file)) { throw "Expected APK was not created: $file" }
        $item = Get-Item $file
        '{0}: {1:N2} MB ({2:N0} bytes)' -f $item.Name, ($item.Length / 1MB), $item.Length
      }
      Write-Host 'Release APK: build\app\outputs\flutter-apk\app-release.apk'
      Write-Host 'Debug APK:   build\app\outputs\flutter-apk\app-debug.apk'
    }
    'check-key' {
      $jsPath = Join-Path $root 'build/web/main.dart.js'
      if (!(Test-Path $jsPath)) { throw 'build/web/main.dart.js is missing. Run BUILD_UNIT8_WEB.cmd first.' }
      $js = [System.IO.File]::ReadAllText($jsPath)
      $count = [regex]::Matches($js, [regex]::Escape($key)).Count
      Write-Host "OMDb key occurrence count in build/web/main.dart.js: $count"
      Write-Host 'The key value was not printed. A count above zero demonstrates that a client-side web build exposes the key.'
      if ($count -lt 1) { throw 'The key was not found. Check that the same OMDb key is in omdb-key.txt and rebuild the web app.' }
    }
  }
} finally {
  Pop-Location
}
