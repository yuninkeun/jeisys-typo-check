param(
  # Text file with one PDF/.ai path per line.
  [Parameter(Mandatory)] [string]$List,
  # Output: one JSON object per line {path, w, h, lines:[{t, x, y, w, h}]}.
  [Parameter(Mandatory)] [string]$Out,
  # Render width in pixels (Windows OCR reads up to 10000 px a side).
  [int]$Width = 7000
)
# Reads page 1 of each file with Windows' own PDF renderer and Korean OCR.
# Everything stays on this PC: no AI, no upload, no cost.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$ext = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTask = $ext | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asAction = $ext | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function AwaitAction($op) { $task = $asAction.Invoke($null, @($op)); $task.Wait(-1) | Out-Null }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ko'))
if (-not $engine) { throw 'Windows 한국어 OCR을 쓸 수 없습니다(언어 팩 확인).' }

$paths = Get-Content -LiteralPath $List -Encoding UTF8 | Where-Object { $_.Trim() }
$writer = New-Object IO.StreamWriter($Out, $false, (New-Object Text.UTF8Encoding $false))
$i = 0
foreach ($p in $paths) {
  $i++
  # [string]: Get-Content lines carry PowerShell metadata that would bloat the JSON.
  $row = [ordered]@{ path = [string]$p }
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
    $pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
    $page = $pdf.GetPage(0)
    $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $w = [Math]::Min($Width, [Math]::Max(2000, $page.Size.Width * 4))
    # Keep the long side inside the OCR limit.
    if ($page.Size.Height / $page.Size.Width * $w -gt 9800) { $w = 9800 * $page.Size.Width / $page.Size.Height }
    $opts.DestinationWidth = [uint32]$w
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    AwaitAction ($page.RenderToStreamAsync($stream, $opts))
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $row.w = $bmp.PixelWidth; $row.h = $bmp.PixelHeight
    $row.lines = @(foreach ($ln in $res.Lines) {
      $rs = $ln.Words | ForEach-Object { $_.BoundingRect }
      $x1 = ($rs | Measure-Object X -Minimum).Minimum; $y1 = ($rs | Measure-Object Y -Minimum).Minimum
      $x2 = ($rs | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
      $y2 = ($rs | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
      [ordered]@{ t = $ln.Text; x = [int]$x1; y = [int]$y1; w = [int]($x2 - $x1); h = [int]($y2 - $y1) }
    })
    $stream.Dispose(); $bmp.Dispose()
  } catch {
    $row.error = $_.Exception.Message
  }
  $writer.WriteLine(($row | ConvertTo-Json -Compress -Depth 5))
  $writer.Flush()
  if ($i % 10 -eq 0) { Write-Host "$i / $($paths.Count)" }
}
$writer.Close()
Write-Host "끝: $i 개"
