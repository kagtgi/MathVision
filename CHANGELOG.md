# Lịch sử phiên bản

## 1.1.0

**Nhãn "Câu N." giờ là số đánh tự động của Word, không phải chữ gõ ra.**
Copy định dạng một dòng câu bằng `Ctrl+Shift+C` rồi dán sang dòng khác bằng
`Ctrl+Shift+V` là ra "Câu 2" — trước đây không được vì nhãn chỉ là chữ, không có
counter nào. Mỗi dãy câu liên tiếp có một counter riêng nên đề restart số theo
từng PHẦN và đề đánh liên tục qua PHẦN đều ra đúng. Dãy nào đề gốc in số trùng
hoặc số có `0` đứng đầu thì giữ nguyên nhãn dạng chữ, không tự sửa số của đề.

**Định dạng VDC lấy lại nhãn "Câu N."** Bản 1.0 bỏ hẳn nhãn này vì đo sai: phép
đo cũ đọc phần chữ trong `document.xml`, mà nhãn nằm ở `numbering.xml` nên không
thấy và kết luận là "chuẩn VDC không có nhãn Câu". Đo lại hai file mẫu của nhóm
thì cả hai đều có. Kèm theo:

- nền xanh lá nhạt `C5E0B3` phủ khối đề (đoạn câu, các dòng nối và các ý a)–d)),
  không phủ lời giải;
- ô **Số câu bắt đầu** để đánh tiếp dải của tuần trước — nhập 65 thì file 4 câu
  ra Câu 65–68, mục đáp án cũng về 65.

**Chọn font trước khi chạy.** Ba lựa chọn: Palatino Linotype 11.5, Myriad Pro
11.5, Times New Roman 12. Không chọn thì theo font mặc định của định dạng.
Windows không có sẵn Myriad Pro, máy chưa cài sẽ bị Word thay font khi mở.

**Tự cập nhật.** Có thêm bản cài `MathVision-Setup-x.y.z.exe`: app tự kiểm bản
mới, tải ngầm rồi hiện nút "Khởi động lại để cập nhật". Bản portable vẫn được
phát hành nhưng không tự thay file được (exe đang bị Windows khoá khi chạy), nên
chỉ báo có bản mới kèm link tải. Số phiên bản đang chạy hiện ở góc trên bên phải.

**Dự án mở cho người khác góp code.** Thêm `LICENSE` (MIT — trước đây khai MIT ở
hai chỗ mà thiếu file), `CONTRIBUTING.md`, `SECURITY.md`, mẫu issue/PR,
CODEOWNERS, Dependabot, và CI chạy trên mỗi Pull Request. Nhánh `main` yêu cầu
PR được duyệt mới merge.

Việc kiểm: thêm `verify-numbering.mjs` và `verify-update.mjs`, sửa hai tiêu chí
trong `verify-vdc.mjs` vốn đang khoá đúng cái hành vi sai. `verify-docx.mjs` vẫn
giữ nguyên bảo chứng 25/25 file trùng từng ký tự với bộ sinh docx gốc.

## 1.0.0

Bản đầu tiên: Ảnh → Word và PDF → Word cho đề thi toán THPT, tự giải đề bằng
Gemini, dựng lại hình bằng TikZ, hai định dạng đầu ra, đóng gói portable.
