# Chuyển `$...$` thành equation MathType

File Word do MathVision xuất ra giữ công thức ở dạng chữ `$...$`. Muốn thành equation
MathType thật (sửa được, in đẹp) thì chạy Toggle TeX. Các script ở đây tự động hoá việc
đó qua Word COM — dùng khi có nhiều file, làm tay từng file cũng được (chọn cả tài liệu
rồi `Alt+\`).

## Yêu cầu

- Microsoft Word (bản desktop) và MathType đã cài.
- Chạy PowerShell ở thư mục này.

## Cách chạy

Mở **hai** cửa sổ PowerShell.

Cửa sổ 1 — bộ gác hộp thoại (phải bật TRƯỚC, để nó tự tắt các hộp thoại MathType bung ra
giữa lúc chạy):

```powershell
powershell -ExecutionPolicy Bypass -File .\dialog_watchdog.ps1
```

Cửa sổ 2 — chuyển đổi cả thư mục chứa file .docx:

```powershell
powershell -ExecutionPolicy Bypass -File .\toggle_final.ps1 -Dir "D:\duong\dan\thu\muc\word"
```

Xong thì kiểm tra:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_media.ps1 -Dir "D:\duong\dan\thu\muc\word"
```

## Vì sao phải có bước kiểm tra

Có một lỗi rất khó thấy: chạy nhiều file trong **một** phiên Word thì sau vài file
Word/MathType ngừng sinh ảnh cache cho equation. File vẫn có đủ đối tượng equation, vẫn
hết dấu `$`, đếm số công thức vẫn khớp — nhưng **mở ra thì ô công thức trống**. Mọi phép
kiểm dựa trên dấu `$` hay số lượng equation đều báo PASS.

`verify_media.ps1` là phép kiểm duy nhất bắt được: nó so số ảnh trong `word/media` với số
đối tượng equation. `toggle_final.ps1` đã phòng bằng cách mở một phiên Word riêng cho
từng file, nhưng vẫn nên chạy bước kiểm tra.

Cũng đừng tin mắt nhìn lúc Word đang chạy: chỗ trống thấy trên màn hình thường chỉ là
Word chưa vẽ lại, file lưu ra vẫn đủ. Muốn chắc thì xuất PDF rồi xem.
