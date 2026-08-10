# verify_media.ps1 — PHÉP KIỂM QUYẾT ĐỊNH: mỗi equation phải có MỘT ảnh hiển thị riêng.
#
# Vì sao cần: Word lưu equation dưới 2 phần — object OLE (word/embeddings, để sửa
# được) và ẢNH CACHE (word/media, để HIỂN THỊ). Nếu MathType lỗi giữa chừng, Word
# vẫn lưu object nhưng KHÔNG sinh đủ ảnh -> mở file thấy Ô TRỐNG dù đếm equation
# vẫn đủ. Mọi phép kiểm trước (còn '$' không, có <v:imagedata> không) đều PASS.
# Chỉ so media vs embeddings mới bắt được.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$base = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $env:TEMP 'mediachk'
New-Item -ItemType Directory -Force $tmp | Out-Null

$rows = @()
foreach ($dir in @('WORD KTGK', 'WORD KTTX')) {
    foreach ($f in Get-ChildItem (Join-Path $base $dir) -Filter *.docx) {
        # file có thể đang mở trong Word -> làm việc trên bản sao
        $work = Join-Path $tmp $f.Name
        try { Copy-Item $f.FullName $work -Force } catch { Write-Host "BỎ QUA (khoá): $($f.Name)"; continue }
        $zip = [IO.Compression.ZipFile]::OpenRead($work)
        try {
            $media = @($zip.Entries | Where-Object { $_.FullName -like 'word/media/*' })
            $emb = @($zip.Entries | Where-Object { $_.FullName -like 'word/embeddings/*' })
            $e = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
            $sr = New-Object IO.StreamReader($e.Open()); $x = $sr.ReadToEnd(); $sr.Close()
        } finally { $zip.Dispose() }
        Remove-Item $work -Force -ErrorAction SilentlyContinue

        $eq = ([regex]::Matches($x, 'ProgID="Equation')).Count
        # Hình TikZ cũng nằm trong word/media. LƯU Ý: một hình dùng ở 2 chỗ (đề +
        # đáp án) vẫn chỉ là MỘT file trong media -> KHÔNG được lấy số lần chèn
        # <pic:pic>/<w:drawing> để trừ, sẽ báo lỗi giả. Chỉ cần: mỗi equation phải
        # có ảnh riêng => media >= eq.
        $figs = ([regex]::Matches($x, '<pic:pic')).Count
        $eqMedia = $media.Count
        $ok = ($media.Count -ge $eq)
        $rows += [pscustomobject]@{
            File = $f.BaseName; EQ = $eq; Embed = $emb.Count; Media = $media.Count
            Hinh = $figs; AnhEQ = $eqMedia; Thieu = [Math]::Max(0, $eq - $eqMedia); OK = $ok
        }
    }
}
$rows | Format-Table -AutoSize | Out-String -Width 110 | Write-Host
$bad = @($rows | Where-Object { -not $_.OK })
Write-Host "`n$($rows.Count) file | HỎNG (thiếu ảnh equation): $($bad.Count)"
if ($bad.Count) { $bad | ForEach-Object { Write-Host "   $($_.File): $($_.EQ) equation nhưng chỉ $($_.AnhEQ) ảnh -> thiếu $($_.Thieu)" } }
