param([string]$In, [string]$OutDir)
# Saves each suspected spot as <id>.png, so the report can show the actual artwork
# next to what OCR read — a person decides in a second.
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$ext = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTask = $ext | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asAction = $ext | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function AwaitAction($op) { $task = $asAction.Invoke($null, @($op)); $task.Wait(-1) | Out-Null }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync((Resolve-Path $OutDir).Path)) ([Windows.Storage.StorageFolder])
foreach ($it in (Get-Content -LiteralPath $In -Raw -Encoding UTF8 | ConvertFrom-Json)) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($it.path)) ([Windows.Storage.StorageFile])
  $pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  $page = $pdf.GetPage(0)
  $k = $page.Size.Width / $it.box.pw
  $pad = $it.box.h * 1.5
  $x = [Math]::Max(0, ($it.box.x - $pad) * $k); $y = [Math]::Max(0, ($it.box.y - $pad) * $k)
  $w = [Math]::Min($page.Size.Width - $x, ($it.box.w + 2 * $pad) * $k)
  $h = [Math]::Min($page.Size.Height - $y, ($it.box.h + 2 * $pad) * $k)
  $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opts.SourceRect = New-Object Windows.Foundation.Rect($x, $y, $w, $h)
  $opts.DestinationWidth = [uint32][Math]::Min(1400, [Math]::Max(600, $w * 6))
  $out = Await ($folder.CreateFileAsync("$($it.id).png", [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $stream = Await ($out.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
  AwaitAction ($page.RenderToStreamAsync($stream, $opts))
  $stream.Dispose()
}
"saved"
