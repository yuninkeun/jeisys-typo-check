# ---------------------------------------------------------------------------
# Jeisys 오타 검증 - Illustrator 연결 도우미
# 웹 화면(폴더 탐색)의 «Illustrator에서 바로 수정» 요청을 받아, 이 PC의
# Illustrator가 파일을 열고 글자를 고친 뒤 원본이름_날짜.ai 로 저장하게 한다.
# 이 PC 안(localhost)에서만 받고, 오타 검증 사이트에서 온 요청만 처리한다.
# 끄려면 창을 닫는다.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$Version = '3'
$Port = 47811
$Allowed = @('https://my-app-xi-ten-51.vercel.app', 'http://localhost:3000', 'http://localhost:3001')

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

# ---- 글자 읽기(OCR): Windows 자체 PDF 렌더러 + 한국어 OCR. 이 PC 안에서만, 비용 없음 ----
$script:ocr = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $wrt = [System.WindowsRuntimeSystemExtensions].GetMethods()
  $script:asTask = $wrt | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $script:asAction = $wrt | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
  $script:ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ko'))
} catch { $script:ocr = $null }
function Await($op, [Type]$t) { $task = $script:asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function AwaitAction($op) { $task = $script:asAction.Invoke($null, @($op)); $task.Wait(-1) | Out-Null }

# PDF(.ai) 바이트의 1페이지를 읽는다. $crop(0~1 비율 x,y,w,h + 줄 높이 lh)이 있으면 그 자리만 크게 다시 읽는다.
function Read-Text([byte[]]$bytes, $crop) {
  $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $io = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForWrite($ras)
  $io.Write($bytes, 0, $bytes.Length); $io.Flush()
  $ras.Seek(0)
  try {
    $pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromStreamAsync($ras)) ([Windows.Data.Pdf.PdfDocument])
    $page = $pdf.GetPage(0)
    $PW = $page.Size.Width; $PH = $page.Size.Height
    $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    if ($crop) {
      $x = [Math]::Max(0, $crop.x * $PW); $y = [Math]::Max(0, $crop.y * $PH)
      $w = [Math]::Min($PW - $x, $crop.w * $PW); $h = [Math]::Min($PH - $y, $crop.h * $PH)
      $opts.SourceRect = New-Object Windows.Foundation.Rect($x, $y, $w, $h)
      # 글자 높이가 60px 쯤 되게.
      $scale = 60 / [Math]::Max(0.5, $crop.lh * $PH)
      $opts.DestinationWidth = [uint32][Math]::Max(200, [Math]::Min(4000, $w * $scale))
    } else {
      $w = [Math]::Min(7000, [Math]::Max(2000, $PW * 4))
      if ($PH / $PW * $w -gt 9800) { $w = 9800 * $PW / $PH }
      $opts.DestinationWidth = [uint32]$w
    }
    $img = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    AwaitAction ($page.RenderToStreamAsync($img, $opts))
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($img)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($script:ocr.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $lines = @(foreach ($ln in $res.Lines) {
      $rs = $ln.Words | ForEach-Object { $_.BoundingRect }
      $x1 = ($rs | Measure-Object X -Minimum).Minimum; $y1 = ($rs | Measure-Object Y -Minimum).Minimum
      $x2 = ($rs | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
      $y2 = ($rs | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
      [ordered]@{ t = $ln.Text; x = [int]$x1; y = [int]$y1; w = [int]($x2 - $x1); h = [int]($y2 - $y1) }
    })
    $out = [ordered]@{ ok = $true; w = $bmp.PixelWidth; h = $bmp.PixelHeight; lines = $lines }
    $img.Dispose(); $bmp.Dispose(); $page.Dispose()
    return $out
  } finally {
    $ras.Dispose()
    # 큰 파일을 여러 개 읽으면 메모리가 쌓여 도우미가 꺼질 수 있어, 매번 정리한다.
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  }
}

function Query($req) {
  # QueryString decodes with the system code page, which garbles Korean; decode as UTF-8.
  $q = @{}
  foreach ($kv in $req.Url.Query.TrimStart('?') -split '&') {
    $pair = $kv -split '=', 2
    if ($pair.Count -eq 2) { $q[$pair[0]] = [Uri]::UnescapeDataString($pair[1].Replace('+', ' ')) }
  }
  return $q
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

function SendRaw($res, [int]$code, [string]$json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $res.StatusCode = $code
  $res.ContentType = 'application/json; charset=utf-8'
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}

function Body($req) {
  $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

# ---- 이 PC의 OCR 저장소: 라벨 1개 = ocr\<내용 해시>.json. DB가 준비되면 웹에서 «DB로 올리기» ----
$storeDir = Join-Path $dataDir 'ocr'
New-Item -ItemType Directory -Force $storeDir | Out-Null
$indexFile = Join-Path $storeDir 'index.tsv'        # 해시 <tab> 분류 <tab> 파일 이름
$uploadedFile = Join-Path $storeDir 'uploaded.txt'  # DB에 올린 해시
$utf8 = New-Object Text.UTF8Encoding $false
$script:uploaded = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $uploadedFile) { foreach ($h in [IO.File]::ReadAllLines($uploadedFile)) { if ($h) { [void]$script:uploaded.Add($h.Trim()) } } }
function Test-Hash([string]$h) { return $h -match '^[0-9a-f]{64}$' }
# 본문의 해시 배열. (PowerShell 5는 JSON 배열을 파이프에서 한 덩어리로 넘기므로 변수에 받은 뒤 하나씩 꺼낸다.)
function Read-Hashes($req) {
  $parsed = (Body $req) | ConvertFrom-Json
  $list = New-Object System.Collections.Generic.List[string]
  foreach ($h in $parsed) { if (Test-Hash ([string]$h)) { $list.Add([string]$h) } }
  return ,$list
}
function Store-Path([string]$h) { return (Join-Path $storeDir "$h.json") }
function Store-Index {
  if (-not (Test-Path $indexFile)) { return @() }
  return @([IO.File]::ReadAllLines($indexFile, $utf8) | Where-Object { $_ } | ForEach-Object { $p = $_ -split "`t"; [pscustomobject]@{ hash = $p[0]; category = $p[1] } })
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
Write-Host ' 웹 화면(폴더 탐색)의 «Illustrator에서 바로 수정»과 «OCR 비교»를 여기서 처리합니다.'
Write-Host ' 쓰는 동안 이 창을 열어 두세요. 끄려면 창을 닫으면 됩니다.'
if (-not (Test-Illustrator)) { Write-Host ' ※ 이 PC에서 Illustrator를 찾지 못했습니다.' -ForegroundColor Yellow }
if (-not $script:ocr) { Write-Host ' ※ Windows 한국어 OCR을 쓸 수 없어 OCR 비교는 꺼집니다.' -ForegroundColor Yellow }
Write-Host ''

$logFile = Join-Path $dataDir 'bridge.log'
function Log([string]$msg) { try { Add-Content -LiteralPath $logFile -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding UTF8 } catch {} }
Log "시작 (버전 $Version, OCR $([bool]$script:ocr))"
trap { Log ("멈춤: " + $_.Exception.ToString()); break }

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { Log ("요청 받기 실패: " + $_.Exception.Message); continue }
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
      Send $res 200 @{ ok = $true; version = $Version; illustrator = (Test-Illustrator); ocr = [bool]$script:ocr }
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
    elseif ($req.HttpMethod -eq 'POST' -and $route -eq '/ocr') {
      # 본문 = 파일(PDF 호환 .ai) 그대로. 파일은 메모리에서만 읽고 어디에도 저장하지 않는다.
      if (-not $script:ocr) { Send $res 200 @{ ok = $false; reason = 'no_ocr'; message = 'Windows 한국어 OCR을 쓸 수 없습니다(설정 > 시간 및 언어 > 언어에서 한국어 추가).' }; continue }
      $ms = New-Object IO.MemoryStream
      $req.InputStream.CopyTo($ms)
      $q = Query $req
      $crop = $null
      if ($q.ContainsKey('x')) {
        $inv = [Globalization.CultureInfo]::InvariantCulture
        $crop = @{ x = [double]::Parse($q.x, $inv); y = [double]::Parse($q.y, $inv); w = [double]::Parse($q.w, $inv); h = [double]::Parse($q.h, $inv); lh = [double]::Parse($q.lh, $inv) }
      }
      $bytes = $ms.ToArray(); $ms.Dispose()
      Send $res 200 (Read-Text $bytes $crop)
    }
    elseif ($req.HttpMethod -eq 'POST' -and $route -eq '/store/get') {
      # 본문: 해시 배열 → 이 PC에 저장된 것만 저장된 JSON 그대로 배열로.
      $hashes = Read-Hashes $req
      $parts = New-Object System.Collections.Generic.List[string]
      foreach ($h in $hashes) {
        if ((Test-Hash $h) -and (Test-Path (Store-Path $h))) { $parts.Add([IO.File]::ReadAllText((Store-Path $h), $utf8)) }
      }
      SendRaw $res 200 ('{"ok":true,"docs":[' + ($parts -join ',') + ']}')
    }
    elseif ($req.HttpMethod -eq 'POST' -and $route -eq '/store/put') {
      # 본문: 라벨 1개 {hash, fileName, filePath, category, w, h, lines, compact}. 이미 있으면 그대로 둔다.
      $text = Body $req
      $doc = $text | ConvertFrom-Json
      if (-not (Test-Hash $doc.hash) -or @('박스', '스티커', '멸균지') -notcontains $doc.category) {
        Send $res 200 @{ ok = $false; message = '저장할 수 없는 형식입니다.' }; continue
      }
      $path = Store-Path $doc.hash
      $saved = $false
      if (-not (Test-Path $path)) {
        [IO.File]::WriteAllText($path, $text, $utf8)
        [IO.File]::AppendAllText($indexFile, ("{0}`t{1}`t{2}`r`n" -f $doc.hash, $doc.category, $doc.fileName), $utf8)
        $saved = $true
      }
      Send $res 200 @{ ok = $true; saved = $saved }
    }
    elseif ($req.HttpMethod -eq 'GET' -and $route -eq '/store/stats') {
      $idx = @(Store-Index)
      $by = @{ '박스' = 0; '스티커' = 0; '멸균지' = 0 }
      $pending = 0
      foreach ($r in $idx) { if ($by.ContainsKey($r.category)) { $by[$r.category]++ }; if (-not $script:uploaded.Contains($r.hash)) { $pending++ } }
      Send $res 200 @{ ok = $true; total = $idx.Count; byCategory = $by; pending = $pending; folder = $storeDir }
    }
    elseif ($req.HttpMethod -eq 'GET' -and $route -eq '/store/pending') {
      # DB에 아직 안 올린 라벨을 limit개까지.
      $limit = 20; $q = Query $req; if ($q.limit) { $limit = [Math]::Min(100, [int]$q.limit) }
      $parts = New-Object System.Collections.Generic.List[string]
      foreach ($r in (Store-Index)) {
        if ($parts.Count -ge $limit) { break }
        if (-not $script:uploaded.Contains($r.hash) -and (Test-Path (Store-Path $r.hash))) { $parts.Add([IO.File]::ReadAllText((Store-Path $r.hash), $utf8)) }
      }
      SendRaw $res 200 ('{"ok":true,"docs":[' + ($parts -join ',') + ']}')
    }
    elseif ($req.HttpMethod -eq 'POST' -and $route -eq '/store/uploaded') {
      $hashes = Read-Hashes $req
      foreach ($h in $hashes) { if ($script:uploaded.Add($h)) { [IO.File]::AppendAllText($uploadedFile, "$h`r`n", $utf8) } }
      Send $res 200 @{ ok = $true; marked = $hashes.Count }
    }
    elseif ($req.HttpMethod -eq 'GET' -and $route -eq '/saved') {
      $p = (Query $req)['path']
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
    Log ("오류 " + $req.Url.AbsolutePath + ": " + $_.Exception.Message)
    try { Send $res 200 @{ ok = $false; reason = 'error'; message = $_.Exception.Message } } catch {}
  }
}
