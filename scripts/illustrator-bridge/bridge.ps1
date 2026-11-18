# ---------------------------------------------------------------------------
# Jeisys 오타 검증 - Illustrator 연결 도우미
# 웹 화면(폴더 탐색)의 «Illustrator에서 바로 수정» 요청을 받아, 이 PC의
# Illustrator가 파일을 열고 글자를 고친 뒤 원본이름_날짜.ai 로 저장하게 한다.
# 이 PC 안(localhost)에서만 받고, 오타 검증 사이트에서 온 요청만 처리한다.
# 끄려면 창을 닫는다.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$Version = '1'
$Port = 47811
$Allowed = @('https://my-app-xi-ten-51.vercel.app', 'http://localhost:3000')

$dataDir = Join-Path $env:APPDATA 'JeisysTypoBridge'
New-Item -ItemType Directory -Force $dataDir | Out-Null
$rootsFile = Join-Path $dataDir 'roots.json'
$script:roots = @{}
if (Test-Path $rootsFile) {
  try {
    (Get-Content $rootsFile -Raw -Encoding UTF8 | ConvertFrom-Json).psobject.Properties |
      ForEach-Object { $script:roots[$_.Name] = [string]$_.Value }
  } catch {}
}
function Save-Roots {
  $script:roots | ConvertTo-Json | Set-Content $rootsFile -Encoding UTF8
}

# 이 도우미가 저장한 완성본만 웹 화면이 다시 읽어 갈 수 있다(수정 전·후 비교용).
$script:saved = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)

$skip = @('$RECYCLE.BIN', 'System Volume Information', 'Windows', 'Program Files', 'Program Files (x86)',
  'ProgramData', 'AppData', 'node_modules', '.git')

# 폴더 이름으로 이 PC에서 그 폴더를 찾는다(드라이브·바탕 화면·OneDrive 아래 4단계까지).
function Find-Folders([string]$name) {
  $bases = New-Object System.Collections.Generic.List[string]
  foreach ($d in [IO.DriveInfo]::GetDrives()) {
    if ($d.IsReady -and ($d.DriveType -eq 'Fixed' -or $d.DriveType -eq 'Network' -or $d.DriveType -eq 'Removable')) { $bases.Add($d.RootDirectory.FullName) }
  }
  foreach ($p in @($env:OneDriveCommercial, $env:OneDrive, [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'), $env:USERPROFILE)) {
    if ($p -and (Test-Path $p)) { $bases.Add($p) }
  }
  $found = New-Object System.Collections.Generic.List[string]
  $level = @($bases | Select-Object -Unique)
  for ($depth = 0; $depth -lt 4 -and $level.Count -gt 0; $depth++) {
    $next = New-Object System.Collections.Generic.List[string]
    foreach ($dir in $level) {
      try { $subs = [IO.Directory]::GetDirectories($dir) } catch { continue }
      foreach ($sub in $subs) {
        $leaf = [IO.Path]::GetFileName($sub)
        if ($leaf -eq $name) { $found.Add($sub) }
        elseif ($skip -notcontains $leaf -and -not $leaf.StartsWith('.')) { $next.Add($sub) }
      }
    }
    if ($found.Count -gt 0) { break }
    $level = $next
  }
  return ,$found
}

function Pick-Folder([string]$name) {
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = "웹 화면에서 연 '$name' 폴더가 이 PC 어디에 있는지 골라 주세요."
  $dlg.ShowNewFolderButton = $false
  try { if ($dlg.ShowDialog($owner) -eq 'OK') { return $dlg.SelectedPath } } finally { $owner.Dispose() }
  return $null
}

# 웹 화면의 폴더 이름 + 그 안의 상대 경로 → 이 PC의 실제 파일 경로.
function Resolve-Target([string]$base, [string]$rel, $size) {
  $parts = @($rel -split '/')
  if (-not $base) { $base = $parts[0]; $parts = @($parts | Select-Object -Skip 1) }
  $relWin = ($parts -join '\')
  $ok = {
    param($dir)
    if (-not $dir) { return $null }
    $f = Join-Path $dir $relWin
    if (Test-Path -LiteralPath $f -PathType Leaf) { return $f }
    return $null
  }
  $hit = & $ok $script:roots[$base]
  if ($hit) { return $hit }
  Write-Host "  '$base' 폴더를 찾는 중..."
  $hits = @()
  foreach ($dir in (Find-Folders $base)) { $f = & $ok $dir; if ($f) { $hits += , @($dir, $f) } }
  if ($size) {
    $same = @($hits | Where-Object { (Get-Item -LiteralPath $_[1]).Length -eq [long]$size })
    if ($same.Count -gt 0) { $hits = $same }
  }
  if ($hits.Count -gt 0) {
    $script:roots[$base] = $hits[0][0]; Save-Roots
    return $hits[0][1]
  }
  $picked = Pick-Folder $base
  $f = & $ok $picked
  if ($f) { $script:roots[$base] = $picked; Save-Roots }
  return $f
}

function Test-Illustrator {
  return [bool](Get-Item 'Registry::HKEY_CLASSES_ROOT\Illustrator.Application' -ErrorAction SilentlyContinue)
}

function Send($res, [int]$code, $obj) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 5))
  $res.StatusCode = $code
  $res.ContentType = 'application/json; charset=utf-8'
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch {
  Write-Host ''
  Write-Host '연결 도우미가 이미 켜져 있거나 포트를 쓸 수 없습니다. 이 창은 닫아도 됩니다.' -ForegroundColor Yellow
  return
}
Write-Host ''
Write-Host ' Jeisys 오타 검증 - Illustrator 연결 도우미가 켜졌습니다.' -ForegroundColor Green
Write-Host ' 웹 화면(폴더 탐색)에서 «Illustrator에서 바로 수정»을 누르면 여기서 처리합니다.'
Write-Host ' 쓰는 동안 이 창을 열어 두세요. 끄려면 창을 닫으면 됩니다.'
if (-not (Test-Illustrator)) { Write-Host ' ※ 이 PC에서 Illustrator를 찾지 못했습니다.' -ForegroundColor Yellow }
Write-Host ''

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  $origin = $req.Headers['Origin']
  $trusted = $origin -and ($Allowed -contains $origin)
  if ($trusted) {
    $res.AddHeader('Access-Control-Allow-Origin', $origin)
    $res.AddHeader('Access-Control-Allow-Headers', 'content-type')
    $res.AddHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
    $res.AddHeader('Vary', 'Origin')
  }
  try {
    if ($req.HttpMethod -eq 'OPTIONS') { $res.StatusCode = 204; $res.Close(); continue }
    if (-not $trusted) { Send $res 403 @{ ok = $false; reason = 'origin'; message = '허용되지 않은 사이트입니다.' }; continue }
    $route = $req.Url.AbsolutePath
    if ($req.HttpMethod -eq 'GET' -and $route -eq '/ping') {
      Send $res 200 @{ ok = $true; version = $Version; illustrator = (Test-Illustrator) }
    }
    elseif ($req.HttpMethod -eq 'POST' -and $route -eq '/fix') {
      $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $body = $reader.ReadToEnd() | ConvertFrom-Json
      Write-Host (" [{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $body.fileName)
      $path = Resolve-Target $body.base $body.path $body.size
      if (-not $path) {
        Send $res 200 @{ ok = $false; reason = 'not_found'; message = "이 PC에서 '$($body.fileName)' 파일을 찾지 못했습니다. 웹에서 연 폴더와 같은 폴더인지 확인해 주세요." }
        continue
      }
      Write-Host "  파일: $path"
      $lit = ($path | ConvertTo-Json)
      $ai = New-Object -ComObject Illustrator.Application
      try { $out = [string]$ai.DoJavaScript("var TARGET_PATH = $lit;`n" + $body.script) }
      finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ai) }
      $mark = "`n@@JEISYS@@`n"
      $split = $out.IndexOf($mark)
      $savedPath = ''; $report = $out
      if ($split -ge 0) { $savedPath = $out.Substring(0, $split); $report = $out.Substring($split + $mark.Length) }
      if ($savedPath) { [void]$script:saved.Add($savedPath); Write-Host "  저장: $savedPath" -ForegroundColor Green }
      else { Write-Host '  저장한 파일 없음' -ForegroundColor Yellow }
      Send $res 200 @{ ok = $true; file = $path; saved = $savedPath; report = $report }
    }
    elseif ($req.HttpMethod -eq 'GET' -and $route -eq '/saved') {
      # QueryString decodes with the system code page, which garbles Korean; decode as UTF-8.
      $p = $null
      foreach ($kv in $req.Url.Query.TrimStart('?') -split '&') {
        $pair = $kv -split '=', 2
        if ($pair[0] -eq 'path' -and $pair.Count -eq 2) { $p = [Uri]::UnescapeDataString($pair[1].Replace('+', ' ')) }
      }
      if (-not $p -or -not $script:saved.Contains($p) -or -not (Test-Path -LiteralPath $p)) {
        Send $res 404 @{ ok = $false; message = '파일이 없습니다.' }; continue
      }
      $bytes = [IO.File]::ReadAllBytes($p)
      $res.StatusCode = 200
      $res.ContentType = 'application/pdf'
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
    }
    else { Send $res 404 @{ ok = $false; message = '없는 요청입니다.' } }
  } catch {
    Write-Host ("  오류: " + $_.Exception.Message) -ForegroundColor Red
    try { Send $res 200 @{ ok = $false; reason = 'error'; message = $_.Exception.Message } } catch {}
  }
}
