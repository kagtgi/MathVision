# verify_docx.ps1 — kiểm tra thành phẩm .docx (đọc thẳng document.xml, không tin log):
#   1. Còn "$" nào chưa toggle không (kèm ngữ cảnh)
#   2. Phần trắc nghiệm: mỗi câu có đúng 1 dòng "Chọn X" highlight xanh lá,
#      và chữ cái đó khớp phương án được gạch chân
#   3. Phần trả lời ngắn: có "Đáp số" highlight
#   4. Phần tự luận: KHÔNG có highlight nào
#   5. Header đúng nội dung, có page break trước ĐÁP ÁN CHI TIẾT
$ErrorActionPreference = 'Stop'
$base = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $env:TEMP 'docxverify'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null

$files = @(Get-ChildItem (Join-Path $base 'WORD KTGK') -Filter *.docx) + @(Get-ChildItem (Join-Path $base 'WORD KTTX') -Filter *.docx)
$totalIssues = 0

foreach ($f in $files) {
    $d = Join-Path $tmp $f.BaseName
    Expand-Archive -Path $f.FullName -DestinationPath $d -Force
    $xml = Get-Content (Join-Path $d 'word\document.xml') -Raw -Encoding UTF8
    $issues = New-Object 'System.Collections.Generic.List[string]'

    # --- header ---
    $hdrFile = Get-ChildItem (Join-Path $d 'word') -Filter 'header*.xml' -ErrorAction SilentlyContinue | Select-Object -First 1
    $hdrTxt = if ($hdrFile) { (([regex]::Matches((Get-Content $hdrFile.FullName -Raw -Encoding UTF8), '<w:t[^>]*>([^<]*)</w:t>') | ForEach-Object { $_.Groups[1].Value }) -join '') } else { '' }
    if ($hdrTxt -notmatch 'Group 11 Bhp 2027') { $issues.Add("header sai: '$hdrTxt'") }
    if ($hdrTxt -notmatch 'Team Trợ giảng 11 Bhp') { $issues.Add('header thiếu Team Trợ giảng 11 Bhp') }

    # --- page break trước ĐÁP ÁN CHI TIẾT ---
    if ($xml -notmatch '<w:pageBreakBefore') { $issues.Add('thiếu page break trước ĐÁP ÁN CHI TIẾT') }

    # --- duyệt paragraph ---
    $paras = [regex]::Matches($xml, '<w:p\b[\s\S]*?</w:p>')
    $inAnswer = $false
    $section = ''          # TN | DS | TLN | TL
    $curQuestion = $null
    $qHasChon = $false
    $qUnderlined = $null
    $chonLetter = $null
    $stats = @{ TN = 0; chon = 0; TLN = 0; dapso = 0; TLhl = 0 }
    $dollars = New-Object 'System.Collections.Generic.List[string]'

    function Close-Question {
        if ($script:curQuestion -and $script:section -eq 'TN') {
            $script:stats.TN++
            if (-not $script:qHasChon) { $script:issues.Add("câu $($script:curQuestion) ($($script:section)): THIẾU highlight 'Chọn'") }
            elseif ($script:qUnderlined -and $script:chonLetter -and $script:qUnderlined -ne $script:chonLetter) {
                $script:issues.Add("câu $($script:curQuestion): Chọn $($script:chonLetter) nhưng gạch chân $($script:qUnderlined)")
            }
        }
        $script:curQuestion = $null; $script:qHasChon = $false; $script:qUnderlined = $null; $script:chonLetter = $null
    }

    foreach ($p in $paras) {
        $t = (([regex]::Matches($p.Value, '<w:t[^>]*>([^<]*)</w:t>') | ForEach-Object { $_.Groups[1].Value }) -join '').Trim()
        if (-not $t) { continue }
        $hasHl = $p.Value -match '<w:highlight w:val="green"'
        if ($t -match '\$') { $dollars.Add(($t.Substring(0, [Math]::Min(90, $t.Length)))) }

        if ($t -match '^ĐÁP ÁN CHI TIẾT') { Close-Question; $inAnswer = $true; continue }
        if (-not $inAnswer) { continue }

        if ($t -match '^PHẦN\s') {
            Close-Question
            $section = if ($t -match 'NHIỀU PHƯƠNG ÁN') { 'TN' } elseif ($t -match 'ĐÚNG SAI') { 'DS' } elseif ($t -match 'TRẢ LỜI NGẮN') { 'TLN' } elseif ($t -match 'TỰ LUẬN') { 'TL' } else { '' }
            continue
        }
        if ($t -match '^Câu\s+(\d+)') {
            Close-Question
            $curQuestion = $Matches[1]
            if ($section -eq 'TLN') { $stats.TLN++ }
            continue
        }
        # Phương án gạch chân = đáp án đúng. LƯU Ý: 4 phương án nằm CHUNG một đoạn
        # (ngăn bằng tab), nên phải soi từng <w:r> để tìm run vừa có <w:u> vừa chứa "X."
        # — nếu lấy chữ cái đầu đoạn thì luôn ra "A" (từng bị dương tính giả).
        if ($t -match '^[A-D]\.') {
            foreach ($rm in [regex]::Matches($p.Value, '<w:r>[\s\S]*?</w:r>')) {
                if ($rm.Value -notmatch '<w:u\b') { continue }
                $rt = (([regex]::Matches($rm.Value, '<w:t[^>]*>([^<]*)</w:t>') | ForEach-Object { $_.Groups[1].Value }) -join '')
                $um = [regex]::Match($rt, '^\s*([A-D])\.')
                if ($um.Success) { $qUnderlined = $um.Groups[1].Value; break }
            }
        }
        if ($t -match '^Chọn\s+([A-D?])') {
            if ($hasHl) { $qHasChon = $true; $stats.chon++; $chonLetter = $Matches[1] }
            else { $issues.Add("câu $curQuestion : 'Chọn' KHÔNG có highlight") }
            continue
        }
        if ($t -match '^Đáp số') {
            if ($hasHl) { $stats.dapso++ } else { $issues.Add("câu $curQuestion : 'Đáp số' KHÔNG có highlight") }
            continue
        }
        if ($section -eq 'TL' -and $hasHl) { $stats.TLhl++ }
    }
    Close-Question

    if ($stats.TLhl -gt 0) { $issues.Add("phần TỰ LUẬN có $($stats.TLhl) highlight thừa") }
    if ($stats.TLN -gt 0 -and $stats.dapso -eq 0) { $issues.Add("phần TRẢ LỜI NGẮN ($($stats.TLN) câu) không có 'Đáp số' highlight nào") }
    foreach ($dd in $dollars) { $issues.Add("CÒN `$: $dd") }

    $flag = if ($issues.Count) { 'LỖI ' } else { 'OK  ' }
    Write-Host ("{0}{1,-28} TN={2}/chọn={3}  TLN={4}/đápsố={5}" -f $flag, $f.Name, $stats.TN, $stats.chon, $stats.TLN, $stats.dapso)
    foreach ($x in $issues) { Write-Host "       - $x" }
    $totalIssues += $issues.Count
}
Write-Host ""
Write-Host "$($files.Count) file, $totalIssues vấn đề."
