<#
Opens the Office samplers in Word, PowerPoint and Excel (Windows with Microsoft 365), exports each to
PDF and saves Office's own copy, for comparing with Chemweave (docs/developers.md, "The Office
samplers"). Everything is written inside -Folder, never into the repository:

  1. write the samplers out:  OFFICE_SAMPLER_OUT=<folder> npx vitest run tests/office-samplers-
  2. this script:             powershell -File scripts/office-sampler-compare.ps1 -Folder <folder>
       <folder>\pdf\office\<file>.pdf                    the sampler as Office shows it
       <folder>\pdf\office\chemweave-saved\<file>.pdf    Chemweave's save as Office shows it
       <folder>\office-saved\<file>                      Office's own save of the sampler
       <folder>\office-log-office.csv                    each file: opened, time, Office's error
  3. Chemweave's PDFs:        node scripts/office-sampler-pdf.mjs <folder> office-saved   (after npm run build;
                              CHROMIUM_PATH may name Edge or Chrome instead of Playwright's Chromium)
  4. Office -> Chemweave:     OFFICE_SAMPLER_OUT=<folder> OFFICE_RESAVED=<folder>\office-saved npx vitest run tests/office-samplers-
       checks every item on Office's copy and writes Chemweave's save of it to <folder>\office-then-chemweave
  5. this script again with -Stage roundtrip: PDFs of <folder>\office-then-chemweave as Office shows them.
  6. compare:                 node scripts/office-sampler-pdf-compare.mjs <folder>   (item ids page by page)
                              powershell -File scripts/office-sampler-render.ps1 -Pdf <pdf> -Out <folder>   (pages as pictures)

Each file is opened in a separate PowerShell process with a time limit, so a file Office can't open
(a repair prompt, a hang) is logged and skipped. Office programs that were already running when the
script started are left alone: Word and Excel get instances of their own, PowerPoint (which runs
once per user) is quit only when no other presentation is open in it, and after a time-out only
hidden instances started by the script are ended. Best not to open Office while it runs.
#>
param(
  [Parameter(Mandatory = $true)][string]$Folder,
  [ValidateSet('office', 'roundtrip')][string]$Stage = 'office',
  [int]$TimeoutSeconds = 240,
  # internal: convert one file (run by the script itself in a child process)
  [string]$One, [string]$Pdf, [string]$Out
)
$ErrorActionPreference = 'Stop'

function Convert-One([string]$path, [string]$pdf, [string]$out) {
  $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($ext -eq '.docx') {
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false; $app.DisplayAlerts = 0
    try {
      # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
      $d = $app.Documents.Open($path, $false, $true, $false)
      $d.ExportAsFixedFormat($pdf, 17)   # wdExportFormatPDF
      if ($out) { $d.SaveAs2([ref]$out, [ref]16) }   # wdFormatXMLDocument
      $d.Close([ref]0)
    } finally { $app.Quit([ref]0); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
  } elseif ($ext -eq '.pptx') {
    # PowerPoint runs once per user: this may be the user's own PowerPoint, so it is quit only when
    # nothing but this script's presentation was open in it
    $app = New-Object -ComObject PowerPoint.Application
    try {
      # Open(FileName, ReadOnly, Untitled, WithWindow)
      $p = $app.Presentations.Open($path, -1, 0, 0)
      if ($out) { $p.SaveCopyAs($out, 24) }   # ppSaveAsOpenXMLPresentation
      $p.SaveAs($pdf, 32)                       # ppSaveAsPDF
      $p.Close()
    } finally { if ($app.Presentations.Count -eq 0 -and -not $app.Visible) { $app.Quit() }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
  } elseif ($ext -eq '.xlsx') {
    $app = New-Object -ComObject Excel.Application
    $app.Visible = $false; $app.DisplayAlerts = $false
    try {
      # Open(FileName, UpdateLinks, ReadOnly)
      $w = $app.Workbooks.Open($path, 0, $true)
      $w.ExportAsFixedFormat(0, $pdf)   # xlTypePDF, every sheet
      if ($out) { $w.SaveCopyAs($out) }
      $w.Close($false)
    } finally { $app.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
  }
}

if ($One) {
  try { Convert-One $One $Pdf $Out; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
}

$Folder = (Resolve-Path $Folder).Path.TrimEnd('\')
# Office's copies are made by Office: they never go into the repository
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
if (($Folder + '\').StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "-Folder ($Folder) is inside the repository; give a folder outside it" }
$sets = if ($Stage -eq 'office') {
  @(@{ dir = $Folder; pdf = 'pdf\office'; save = 'office-saved' }, @{ dir = "$Folder\chemweave-saved"; pdf = 'pdf\office\chemweave-saved'; save = $null })
} else {
  @(@{ dir = "$Folder\office-then-chemweave"; pdf = 'pdf\office\office-then-chemweave'; save = $null })
}
$names = @{ '.docx' = 'WINWORD'; '.pptx' = 'POWERPNT'; '.xlsx' = 'EXCEL' }
$before = @{}; foreach ($n in $names.Values) { $before[$n] = @(Get-Process $n -ErrorAction SilentlyContinue | ForEach-Object Id) }
$log = @()
foreach ($s in $sets) {
  if (-not (Test-Path $s.dir)) { Write-Host "- $($s.dir): not there, skipped"; continue }
  $pdfDir = Join-Path $Folder $s.pdf; New-Item -ItemType Directory -Force $pdfDir | Out-Null
  if ($s.save) { New-Item -ItemType Directory -Force (Join-Path $Folder $s.save) | Out-Null }
  foreach ($f in Get-ChildItem $s.dir -File | Where-Object { $_.Extension -in '.docx', '.pptx', '.xlsx' } | Sort-Object Name) {
    $pdf = Join-Path $pdfDir ($f.BaseName + '.pdf')
    $out = if ($s.save) { Join-Path (Join-Path $Folder $s.save) $f.Name } else { '' }
    $err = [IO.Path]::GetTempFileName()
    $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Folder', $Folder, '-One', $f.FullName, '-Pdf', $pdf)
    if ($out) { $argv += @('-Out', $out) }
    # (Windows PowerShell passes the list as one command line: quote what has spaces)
    $argv = $argv | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
    $t = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process powershell -ArgumentList $argv -PassThru -WindowStyle Hidden -RedirectStandardError $err
    # (without taking the handle now, Windows PowerShell reports no exit code once the process ends)
    $null = $p.Handle
    $status = 'ok'
    if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
      $status = 'timed out'
      $p.Kill()
      # end only the hidden Office instances this script started: started after it, with no window
      # (a program the user opens during the run has one, and is left alone)
      $n = $names[$f.Extension.ToLowerInvariant()]
      Get-Process $n -ErrorAction SilentlyContinue | Where-Object { $before[$n] -notcontains $_.Id -and $_.MainWindowHandle -eq 0 } | Stop-Process -Force
    } elseif ($p.ExitCode -ne 0) { $status = 'failed' }
    $message = (Get-Content $err -Raw -ErrorAction SilentlyContinue); Remove-Item $err -ErrorAction SilentlyContinue
    $message = if ($message) { $message.Trim() -replace '\s+', ' ' } else { '' }
    Write-Host ("- {0}\{1}: {2} ({3:N0} s){4}" -f (Split-Path $s.dir -Leaf), $f.Name, $status, $t.Elapsed.TotalSeconds, $(if ($message) { " $message" } else { '' }))
    $log += [pscustomobject]@{ set = (Split-Path $s.dir -Leaf); file = $f.Name; status = $status; seconds = [math]::Round($t.Elapsed.TotalSeconds); pdf = (Test-Path $pdf); saved = $(if ($out) { Test-Path $out } else { '' }); message = $message }
  }
}
$log | Export-Csv -NoTypeInformation -Encoding UTF8 (Join-Path $Folder "office-log-$Stage.csv")
