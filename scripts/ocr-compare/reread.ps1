param(
  # JSON array: [{ id, path, box: {x, y, w, h, pw, ph} }] — box in the pixels of the first OCR pass.
  [Parameter(Mandatory)] [string]$In,
  # Output JSON array: [{ id, text }]
  [Parameter(Mandatory)] [string]$Out
)
# Second look at a suspected spot: renders just that line, much larger, and reads it
# again. A misread usually changes; a real typo reads the same both times.
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

$items = Get-Content -LiteralPath $In -Raw -Encoding UTF8 | ConvertFrom-Json
$results = New-Object System.Collections.Generic.List[object]
$docs = @{}
foreach ($it in $items) {
  try {
    if (-not $docs.ContainsKey($it.path)) {
      $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($it.path)) ([Windows.Storage.StorageFile])
      $docs[$it.path] = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
    }
    $page = $docs[$it.path].GetPage(0)
    $k = $page.Size.Width / $it.box.pw
    $pad = $it.box.h * 0.6
    $x = [Math]::Max(0, ($it.box.x - $pad) * $k); $y = [Math]::Max(0, ($it.box.y - $pad) * $k)
    $w = [Math]::Min($page.Size.Width - $x, ($it.box.w + 2 * $pad) * $k)
    $h = [Math]::Min($page.Size.Height - $y, ($it.box.h + 2 * $pad) * $k)
    $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $opts.SourceRect = New-Object Windows.Foundation.Rect($x, $y, $w, $h)
    # Aim for letters about 60 px tall.
    $scale = [Math]::Min(4000 / $w, 60 / [Math]::Max(1, $it.box.h * $k))
    $opts.DestinationWidth = [uint32][Math]::Max(200, [Math]::Min(4000, $w * [Math]::Max(1, $scale)))
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    AwaitAction ($page.RenderToStreamAsync($stream, $opts))
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $results.Add([ordered]@{ id = $it.id; text = (($res.Lines | ForEach-Object { $_.Text }) -join ' ') })
    $stream.Dispose(); $bmp.Dispose()
  } catch {
    $results.Add([ordered]@{ id = $it.id; error = $_.Exception.Message })
  }
}
[IO.File]::WriteAllText($Out, ($results | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
Write-Host "다시 읽음: $($results.Count)"
