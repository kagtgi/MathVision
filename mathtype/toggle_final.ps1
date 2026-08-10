# toggle_final.ps1 — BẢN CUỐI.
#
# Hai lỗi đã gặp và cách xử lý:
#   (a) "equation đủ nhưng ô TRỐNG": chạy 25 file trong MỘT phiên Word thì sau vài
#       file Word/MathType ngừng sinh ảnh cache -> object còn, ảnh mất.
#       => MỖI FILE MỘT PHIÊN WORD RIÊNG (mở, làm, lưu, Quit, giết cả MathType).
#   (b) Toggle từng công thức theo offset ký tự thì BỎ SÓT (offset của Range không
#       khớp 1-1 với Range.Text ở ô bảng) -> vẫn còn '$'.
#       => Giữ cách TOGGLE THEO ĐOẠN (duyệt ngược, MoveEnd(1,-1)) vốn chuyển hết.
#
# Sau mỗi file kiểm 4 điều, sai thì làm lại (tối đa 3 lượt):
#   hết '$' | không có <m:oMath> | số ảnh >= số equation + số hình | equation > 0
$ErrorActionPreference = 'Stop'
$base = Split-Path $PSScriptRoot -Parent
$log = Join-Path $PSScriptRoot 'toggle_final_log.txt'
Set-Content $log "start $(Get-Date -Format 'HH:mm:ss')" -Encoding UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Inspect([string]$docx) {
    $tmp = Join-Path $env:TEMP ("insp_" + [Guid]::NewGuid().ToString('N') + ".docx")
    Copy-Item $docx $tmp -Force
    $zip = [IO.Compression.ZipFile]::OpenRead($tmp)
    try {
        $e = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
        $sr = New-Object IO.StreamReader($e.Open()); $x = $sr.ReadToEnd(); $sr.Close()
        $media = @($zip.Entries | Where-Object { $_.FullName -like 'word/media/*' }).Count
    } finally { $zip.Dispose(); Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    [pscustomobject]@{
        Dollar = ([regex]::Matches($x, '\$')).Count
        Eq     = ([regex]::Matches($x, 'ProgID="Equation')).Count
        Media  = $media
        Fig    = ([regex]::Matches($x, '<pic:pic')).Count
        Omml   = ([regex]::Matches($x, '<m:oMath')).Count
    }
}
function Kill-Office {
    Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {} }
    Get-Process -Name 'MathType*' -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {} }
    Start-Sleep -Seconds 2
}
function New-Word {
    $w = New-Object -ComObject Word.Application
    $w.Visible = $true
    $w.DisplayAlerts = 0
    $ad = $null
    for ($k = 0; $k -lt 40; $k++) {
        try { $ad = $w.AddIns; if ($ad -ne $null) { $null = $ad.Count; break } } catch { $ad = $null }
        Start-Sleep -Seconds 1
    }
    if ($ad -eq $null) { throw 'Word COM chưa sẵn sàng' }
    $have = $false
    foreach ($a in $ad) { if ($a.Name -like 'MathType*') { $have = $true; if (-not $a.Installed) { $a.Installed = $true } } }
    if (-not $have) { $ad.Add("C:\Program Files (x86)\MathType\Office Support\64\MathType Commands 2016.dotm", $true) | Out-Null }
    return $w
}

$files = @(Get-ChildItem (Join-Path $base 'WORD KTGK') -Filter *.docx) + @(Get-ChildItem (Join-Path $base 'WORD KTTX') -Filter *.docx)
Add-Content $log "tổng: $($files.Count) file"
$i = 0
foreach ($f in $files) {
    $i++; $t0 = Get-Date; $attempt = 0; $good = $false
    while (-not $good -and $attempt -lt 3) {
        $attempt++
        Kill-Office
        $word = $null
        try {
            $word = New-Word
            $doc = $word.Documents.Open([string]$f.FullName, [ref]$false, [ref]$false)
            $done = 0; $skip = 0
            for ($p = $doc.Paragraphs.Count; $p -ge 1; $p--) {
                try {
                    $rng = $doc.Paragraphs.Item($p).Range
                    if ($rng.Text -notmatch '\$') { continue }
                    $rng.MoveEnd(1, -1) | Out-Null
                    $rng.Select()
                    $word.Run('MTCommand_TeXToggle')
                    $done++
                    Start-Sleep -Milliseconds 40
                } catch { $skip++ }
            }
            $doc.Save(); $doc.Close([ref]$false)
            try { $word.Quit() } catch {}
        } catch {
            Add-Content $log "  [$i] lượt $attempt LỖI: $($_.Exception.Message)"
        } finally {
            if ($word) { try { [Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {} }
            Kill-Office
        }
        $st = Inspect $f.FullName
        $good = ($st.Dollar -eq 0 -and $st.Omml -eq 0 -and $st.Eq -gt 0 -and $st.Media -ge ($st.Eq + $st.Fig))
        Add-Content $log "  [$i] lượt ${attempt}: para=$done skip=$skip -> `$=$($st.Dollar) eq=$($st.Eq) ảnh=$($st.Media) hình=$($st.Fig) $(if($good){'ĐẠT'}else{'CHƯA ĐẠT'})"
        if (-not $good -and $attempt -lt 3) {
            # làm lại từ bản sạch để không chồng equation lên nhau
            Add-Content $log "  [$i] dựng lại docx từ .mmd rồi thử tiếp"
            $mmdDir = if ($f.FullName -like '*WORD KTGK*') { Join-Path $base 'MMD KTGK' } else { Join-Path $base 'MMD KTTX' }
            $mmd = Join-Path $mmdDir ($f.BaseName + '.mmd')
            Push-Location $PSScriptRoot
            & node mmd2docx.js $mmd $f.FullName *> $null
            Pop-Location
        }
    }
    $st = Inspect $f.FullName
    $v = if ($good) { 'OK  ' } else { 'LỖI ' }
    Add-Content $log "[$i/$($files.Count)] $v $($f.Name) eq=$($st.Eq) ảnh=$($st.Media) hình=$($st.Fig) `$=$($st.Dollar) $([int]((Get-Date)-$t0).TotalSeconds)s"
}
Add-Content $log "DONE $(Get-Date -Format 'HH:mm:ss')"
