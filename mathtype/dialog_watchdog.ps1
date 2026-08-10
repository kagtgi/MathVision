# dialog_watchdog.ps1 (v4) — nền: tự đóng mọi hộp thoại chặn batch MathType.
#
#   A) MathType "Convert To Display Style?" -> chọn "Create Inline Style Equation"
#      Đây là VBA UserForm (class ThunderDFrame); các nút KHÔNG phải HWND riêng và
#      UI Automation không thấy -> PostMessage WM_LBUTTONDOWN/UP vào ô con
#      "F3 Server ..." tại toạ độ TỈ LỆ (3 nút xếp dọc đều nhau, Inline là nút GIỮA).
#      Dùng tỉ lệ nên không phụ thuộc DPI; KHÔNG di chuyển chuột thật của user.
#   B) Hộp thoại lỗi Word/MathType (#32770, "Error N ...") -> bấm nút đầu (OK)
#
# LƯU Ý (đã từng sai): gán biến bên trong delegate EnumWindows phải dùng
# List<T> (capture theo tham chiếu). Gán `$script:x` KHÔNG ghi được vào biến
# cục bộ của hàm bao ngoài -> pane luôn rỗng và watchdog im lặng không click.
#
# Dừng: xoá file watchdog.running
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class WD4 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
}
"@
$flag = Join-Path $PSScriptRoot 'watchdog.running'
Set-Content $flag 'run' -Encoding UTF8
$log = Join-Path $PSScriptRoot 'watchdog_log.txt'
Add-Content $log "watchdog v4 start $(Get-Date -Format 'HH:mm:ss')"

function Get-Cls($h) { $sb = New-Object Text.StringBuilder 256; [WD4]::GetClassName($h, $sb, 256) | Out-Null; $sb.ToString() }
function Get-Txt($h) { $sb = New-Object Text.StringBuilder 512; [WD4]::GetWindowText($h, $sb, 512) | Out-Null; $sb.ToString() }

# Liệt kê con của 1 cửa sổ -> List các @{H;C;T}
function Get-Kids($parent) {
    $kids = New-Object 'System.Collections.Generic.List[object]'
    $cb = [WD4+EnumWindowsProc]{
        param($c, $l)
        $kids.Add(@{ H = $c; C = (Get-Cls $c); T = (Get-Txt $c) })
        return $true
    }
    [WD4]::EnumChildWindows($parent, $cb, [IntPtr]::Zero) | Out-Null
    return $kids
}

while (Test-Path $flag) {
    $wins = New-Object 'System.Collections.Generic.List[object]'
    $cbTop = [WD4+EnumWindowsProc]{
        param($h, $l)
        if ([WD4]::IsWindowVisible($h)) {
            $c = Get-Cls $h
            if ($c -eq 'ThunderDFrame' -or $c -eq '#32770' -or $c -eq 'NUIDialog') { $wins.Add(@{ H = $h; C = $c; T = (Get-Txt $h) }) }
        }
        return $true
    }
    [WD4]::EnumWindows($cbTop, [IntPtr]::Zero) | Out-Null

    foreach ($w in $wins) {
        # A) UserForm MathType: Display / Inline / Cancel -> nút GIỮA (Inline)
        if ($w.C -eq 'ThunderDFrame' -and $w.T -match 'Display Style|Inline') {
            $pane = ((Get-Kids $w.H) | Where-Object { $_.C -like 'F3 Server*' } | Select-Object -First 1)
            if ($pane) {
                $r = New-Object WD4+RECT
                if ([WD4]::GetWindowRect($pane.H, [ref]$r)) {
                    $x = [int](0.50 * ($r.R - $r.L)); $y = [int](0.62 * ($r.B - $r.T))
                    $lp = [IntPtr](($y -shl 16) -bor $x)
                    [WD4]::PostMessage($pane.H, 0x0200, [IntPtr]0, $lp) | Out-Null
                    [WD4]::PostMessage($pane.H, 0x0201, [IntPtr]1, $lp) | Out-Null
                    Start-Sleep -Milliseconds 60
                    [WD4]::PostMessage($pane.H, 0x0202, [IntPtr]0, $lp) | Out-Null
                    Start-Sleep -Milliseconds 400
                    Add-Content $log "$(Get-Date -Format 'HH:mm:ss') INLINE click ($x,$y) closed=$(-not [WD4]::IsWindow($w.H))"
                }
            } else {
                Add-Content $log "$(Get-Date -Format 'HH:mm:ss') WARN: không tìm thấy pane F3 Server trong '$($w.T)'"
            }
            continue
        }
        # A2) Word hỏi "Convert Equation to Office Math" -> tick "Apply to all" rồi Cancel
        #     (giữ nguyên equation định dạng MathType như file mẫu, không đổi sang OMML).
        #     NUIDialog dùng NetUI: nút là control ảo -> điều khiển bằng UI Automation.
        if ($w.C -eq 'NUIDialog' -and $w.T -match 'Convert Equation') {
            try {
                $root = [System.Windows.Automation.AutomationElement]::FromHandle($w.H)
                $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                foreach ($e in $all) {
                    if ($e.Current.ControlType.ProgrammaticName -eq 'ControlType.CheckBox' -and $e.Current.Name -match 'Apply to all') {
                        $tp = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
                        if ($tp.Current.ToggleState -ne 'On') { $tp.Toggle() }
                    }
                }
                Start-Sleep -Milliseconds 200
                foreach ($e in $all) {
                    if ($e.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $e.Current.Name -eq 'Cancel') {
                        $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
                        Add-Content $log "$(Get-Date -Format 'HH:mm:ss') OFFICEMATH-Cancel (apply to all)"
                        break
                    }
                }
            } catch {
                Add-Content $log "$(Get-Date -Format 'HH:mm:ss') WARN NUIDialog: $($_.Exception.Message)"
            }
            continue
        }
        # B) Hộp thoại lỗi -> OK
        if ($w.C -eq '#32770') {
            $kids = Get-Kids $w.H
            $statics = ($kids | Where-Object { $_.C -eq 'Static' -and $_.T }) | ForEach-Object { $_.T }
            $btn = ($kids | Where-Object { $_.C -eq 'Button' } | Select-Object -First 1)
            # Mã lỗi có thể ÂM ("Error -2147467259 occurred, Method 'Object' of object
            # 'OLEFormat' failed") -> regex phải cho phép dấu trừ, và bắt cả 'failed'.
            if ($btn -and (($statics -join ' ') -match 'Error\s+-?\d+|occurred|failed|cannot|không thể')) {
                [WD4]::SendMessage($btn.H, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
                Add-Content $log "$(Get-Date -Format 'HH:mm:ss') ERROR-OK: $($statics -join ' | ')"
            }
        }
    }
    Start-Sleep -Milliseconds 700
}
Add-Content $log "watchdog v4 stop $(Get-Date -Format 'HH:mm:ss')"
