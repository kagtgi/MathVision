# Lịch sử phiên bản

## 1.2.0

**Hình vẽ lại đúng hơn, và không còn âm thầm mất hình.**

Đo thật năng lực bộ dựng hình (trang `/probe-tikz.html`, 38 ca) và phát hiện prompt
cũ sai cả hai chiều. Nó **cấm oan** `\foreach`, `\draw plot`, `\pgfmathparse`,
`\pgfmathsetmacro` — bốn thứ đều chạy tốt và đều cần cho đồ thị hàm số. Còn thứ
**thật sự làm chết hình** thì không chặn: một byte có dấu tiếng Việt ở bất cứ đâu,
kể cả trong dòng chú thích, là mất trọn 30 giây rồi rơi hình mà không báo gì. Vì
prompt của app viết bằng tiếng Việt nên model rất hay chú thích tiếng Việt trong mã
— rất có thể đây là nguyên nhân mất hình khi dùng thật. Giờ có bộ lọc chặn hết, và
kết quả đo được chốt thành file để prompt sinh từ đó, không lệch được nữa.

Mỗi loại hình có luật vẽ riêng thay vì dùng chung một prompt nói "hình học":

- **bảng biến thiên** kẻ tay bằng TikZ, ba hàng, mũi tên chéo, bắt buộc nhất quán
  thứ tự mốc `x` → dấu `f'(x)` → chiều `f(x)`;
- **đồ thị hàm số** phân tích nghiệm/cực trị/tiệm cận trước rồi mới vẽ;
- **hình không gian** tự đặt toạ độ oblique, đáy vẽ thành hình bình hành;
- **mô hình vật thật** trừu tượng hoá thành nét, bỏ chi tiết trang trí;
- **bảng số liệu** không vẽ nữa mà gõ thành bảng Word sửa được.

Bản vẽ lại giờ được **chấm điểm cạnh ảnh cắt gốc** trước khi thay; thua hoặc phân
vân thì giữ ảnh cắt. Trước đây chỉ cần mã dựng được là thay, mà bước soát lại không
bao giờ nhìn ảnh mình vừa dựng. Thêm phép đo mức mực để loại hình trắng trơn — hình
rỗng vốn vẫn thành PNG trắng hợp lệ và đi thẳng vào file Word. Nhãn hình cũng hết
sai font: 140 rule `@font-face` của bộ dựng trỏ sai đường dẫn nên không tải được
file nào, mà sửa đường dẫn vẫn chưa đủ vì ảnh SVG bị chặn tài nguyên ngoài — nay
font được nhúng thẳng vào ảnh.

**Lịch sử chuyển đổi.** Mỗi lần chuyển xong được lưu lại; mở lại là xuất Word được
ngay **không tốn thêm lượt gọi API nào**. Giữ đủ MMD, hình, kết quả kiểm, định dạng
và font đã chọn. Sửa chữ trong MMD được ghi lại sau 3 giây mà không ghi lại hình.
Trần 40 mục / 250 MB, cũ nhất bị dọn trước.

**Key được mã hoá.** API key chuyển từ `localStorage` dạng chữ thường sang
`secrets.json` mã hoá bằng kho khoá của Windows. Key cũ tự chuyển sang theo luật
ghi-trước-xoá-sau. Máy không có kho khoá thì app **nói thật** là đang lưu chữ
thường chứ không giả vờ đã mã hoá. Thêm ngăn **Cài đặt** có nút **Kiểm tra key**.

**Sửa lỗi 429 khoá cả app.** Trước đây hết hạn mức hoặc mạng chớp một nhịp là bị
báo "key không dùng được" và **không vào được app**. Giờ chỉ key sai thật mới bị
chặn; hết hạn mức chỉ cảnh báo. Chuỗi model đã dò cũng được lưu lại — trước đây mỗi
lần mở app lại dò từ đầu, và tài khoản không có model đầu chuỗi thì mỗi trang OCR
tốn một vòng gọi phí.

**Dán ảnh bằng Ctrl+V** ở chế độ Ảnh → Word: chụp Win+Shift+S rồi dán thẳng.

Sửa thêm bốn lỗi có sẵn: cảnh báo "hai lượt giải khác nhau" của tài liệu trước rò
sang tài liệu mới; thả file quá dung lượng không hiện câu báo nào; khung xem trước
không cập nhật khi đổi font hay số câu bắt đầu; và chế độ ảnh không dọn kết quả
kiểm của lượt chạy trước.

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
