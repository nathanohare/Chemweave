<#
Renders PDF pages to PNG pictures with Windows' own PDF engine (Windows.Data.Pdf), for looking at the
Office samplers' PDFs side by side (docs/developers.md, "The Office samplers"):
  powershell -File scripts/office-sampler-render.ps1 -Pdf <file.pdf> -Out <folder> [-Pages 1,3] [-Width 1000]
writes <folder>\<file>-p<N>.png. Only reads the PDF.
#>
param(
  [Parameter(Mandatory = $true)][string]$Pdf,
  [Parameter(Mandatory = $true)][string]$Out,
  # page numbers, such as 2,3 (all when left out)
  [string]$Pages,
  [int]$Width = 1000
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$asTaskOp = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asTaskAction = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Wait-Op($op, [type]$type) { $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function Wait-Action($a) { $t = $asTaskAction.Invoke($null, @($a)); $t.Wait(-1) | Out-Null }
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
[void][Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]

New-Item -ItemType Directory -Force $Out | Out-Null
$file = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Pdf).Path)) ([Windows.Storage.StorageFile])
$doc = Wait-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$folder = Wait-Op ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync((Resolve-Path $Out).Path)) ([Windows.Storage.StorageFolder])
$base = [IO.Path]::GetFileNameWithoutExtension($Pdf)
$list = if ($Pages) { $Pages -split '[,\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ } } else { 1..$doc.PageCount }
foreach ($n in $list) {
  if ($n -lt 1 -or $n -gt $doc.PageCount) { continue }
  $page = $doc.GetPage($n - 1)
  $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opts.DestinationWidth = $Width
  $target = Wait-Op ($folder.CreateFileAsync("$base-p$n.png", [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $stream = Wait-Op ($target.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
  Wait-Action ($page.RenderToStreamAsync($stream, $opts))
  $stream.Dispose(); $page.Dispose()
  Write-Host "$base-p$n.png"
}
