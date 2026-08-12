# Lịch sử phiên bản

## 1.3.2

**Hết chuyện ảnh chụp chữ đề chen vào chỗ đáng ra là hình.** Trên đề thử THPT 2026 của chuyên
Lê Hồng Phong, chỗ hình chóp của Câu 4 lại là một tấm ảnh chụp bảng số liệu Câu 1 cùng mấy dòng
phương án A-D. Nguyên nhân đo được: model khoanh vùng hình **đúng hình dạng, sai dòng** — nó trả
`[38,0 · 33,1 · 23,0 · 15,5]` trong khi hình thật ở `[38 · 62,2 · 23 · 15,5]`. **Ba trên bốn số
trùng khít tới một chữ số thập phân, chỉ toạ độ dọc lệch 29 điểm.** Nói cách khác model nhận ra
hình và đo đúng khổ, chỉ đặt sai chỗ.

Điều làm nó thành lỗi im lặng: app **không có phép kiểm nào** xem bản cắt có thật là hình hay
không. Ô kiểm "Hình không có dữ liệu" chỉ bắt ảnh treo id, mà đây thì id nào cũng có dữ liệu —
nên tab Kiểm tra báo sạch trong khi file Word có một tấm ảnh vô nghĩa.

Nay mỗi bản cắt phải qua một cửa: nếu vùng cắt chứa **từ 2 dòng chữ xếp đều** trở lên thì app xin
model khoanh lại một lượt, kèm đúng lý do và toạ độ hộp đã sai. Vẫn sai thì **bỏ hình kèm cảnh
báo có số câu** — thiếu hình thì thầy biết ngay phải vẽ tay câu nào, còn ảnh rác thì phải tự tìm
ra rồi xoá. Đo trên chính ca đã lỗi: **3/3 lượt xin lại đều tìm về đúng hình chóp**.

Cửa này chốt bằng số đo, không bằng cảm nhận:

- **Tỉ lệ mực không dùng được** — đã đo và nó không tách được gì: hình thật 4,1-11,6%, dải chữ
  5,4-15,9%, trùm hẳn lên nhau. Chữ và nét vẽ đều là mực đen trên giấy trắng. Thứ tách được là
  **cấu trúc hàng**: chữ in thành dải ngang cao đều, trải quá nửa bề rộng, cách nhau bằng khoảng
  trắng sạch.
- **Không đối chiếu được lớp văn bản PDF** — đề này không có lớp văn bản nào (0 mảnh chữ trên
  trang 1), nên phép đối chứng văn bản của app vốn đã im lặng bỏ qua. Đề scan cũng vậy. Pixel là
  thứ luôn có.
- **Phán quyết trên hộp GỐC model khai, không phải hộp đã nới lề.** Lề 2% mỗi phía là ~34 px trên
  trang A4 — vừa đủ kéo trọn một dòng chữ kề bên vào. Đo trên chính hình chóp Câu 4: hộp **đúng**
  đếm được 2 dòng chữ khi nới lề (đủ để bị chặn oan, tức xoá một hình có thật) nhưng **0** khi đo
  hộp gốc. Lề vẫn giữ cho ảnh khỏi cắt cụt.
- **Ngưỡng đặt ở phía an toàn.** Trên hộp gốc: 13 hình thật của hai đề, đủ bốn họ hình học không
  gian / đồ thị / bảng biến thiên / hình vẽ khác — **cao nhất 1 dòng, không hình nào bị chặn**;
  40 dải chữ lấy tuỳ ý thì bắt được 30. Bỏ sót vài ca còn hơn xoá một hình có thật.

Chạy thật lại cả hai đề sau khi sửa: **8/8 và 6/6 hình cắt đúng, tab Kiểm tra sạch**, và soi cả
14 ảnh nhúng trong hai file Word thì đều là hình thật.

Bốn biến thể cố tình làm sai đều bị harness bắt — trong đó hai ca lúc đầu **lọt qua** nên phải bổ
sung: bỏ trần chiều cao dải (làm hai khối hình xếp dọc bị đọc thành hai dòng chữ) và bỏ phép kiểm
số hữu hạn khi đọc toạ độ khoanh lại.

## 1.3.1

**Bản portable giờ tự cập nhật bằng một nút bấm.** Trước bản này nút "Cập nhật" của bản
portable chỉ **mở trình duyệt** cho tải tay, rồi thầy phải tự xoá file cũ và đổi tên file
mới — bản cài (NSIS) thì đã tự thay từ lâu. Nay bấm một cái là app tải bản mới về **đúng
thư mục đang chạy**, đối chiếu SHA256, tự thoát, thay file rồi mở lại. Không thao tác tay
nào.

Ba chỗ trong đường này hỏng thì hỏng lặng lẽ, nên mỗi chỗ đều chốt bằng phép đo chứ không
bằng suy luận:

- **Chọn nhầm file là tải nhầm hẳn loại app.** Bản phát hành có 5 file, trong đó
  `MathVision-Setup.exe` và `MathVision-Setup.exe.blockmap` chỉ khác vài ký tự so với file
  portable. Đối chiếu với dữ liệu thật của bản 1.3.0: quy tắc chọn lấy đúng
  `MathVision-1.3.0.exe`, loại cả bản cài lẫn blockmap.
- **Không bao giờ chạy file chưa đối chiếu được hash.** Hash mong đợi được đọc **trước**
  khi tải, và mọi tình huống không đọc được — thiếu dòng, hash méo, file rỗng — đều trả
  chuỗi rỗng để bên gọi huỷ. Mọi đường vỡ (thư mục không ghi được, GitHub không trả lời,
  tải hỏng, SHA256 lệch) đều rơi về mở trình duyệt như cũ.
- **Hỏng giữa chừng thì không được mất app.** Bản mới vào chỗ **trước**, bản cũ dọn
  **sau**. Làm ngược lại — xoá trước rồi chép hỏng — là thầy mất sạch app. Phép kiểm dựng
  đúng cảnh đó và xác nhận file cũ còn nguyên vẹn.

Phép kiểm cuối là loại đắt nhất: nó chép `ping.exe` thành "bản cũ", **chạy nó lên** cho
Windows khoá file đúng như cảnh thật, rồi bắt lệnh thay file làm việc của nó — trên một
đường dẫn **có dấu tiếng Việt và dấu cách**. Sáu biến thể cố tình làm sai (nới quy tắc chọn
file, bỏ ba phép kiểm hash, bỏ vòng đợi hết khoá, đảo thứ tự chép–xoá) đều bị bắt.

Đường dẫn có dấu chính là lý do lệnh thay file dùng PowerShell chứ không phải `.cmd`: file
`.cmd` được đọc theo bảng mã OEM của máy, mà Node không ghi được bảng mã đó, nên
`C:\Users\Nguyễn Văn A\Downloads` sẽ hỏng dấu và script trượt file. `-EncodedCommand` nhận
base64 của UTF-16LE nên đường dẫn đi nguyên vẹn.

Kèm hai chỗ rò trong bước tải: đầy đĩa thì `write` chờ một tín hiệu không bao giờ tới (nút
quay mãi), và mạng treo ở bước hỏi GitHub thì không có hạn giờ. Nay cả hai đều rơi về mở
trình duyệt.

> **Lần này vẫn phải tải tay một lần.** Bản 1.3.0 trở về trước chưa có đường tự cập nhật
> nên nó không thể tự nâng lên 1.3.1. Từ 1.3.1 trở đi thì một nút là xong.

## 1.3.0

**Vẽ lại hình bằng TikZ giờ thắng gấp đôi, đo trên đề chính thức THPT 2025.** Chạy thật mã
đề 0101 (5 hình vẽ): trước bản này **2/5** hình được thay bằng bản TikZ nét sạch, nay
**4/5**. Ba thay đổi làm nên con số đó, không cái nào là tính năng mới:
(1) **người viết mã TikZ giờ được đọc ĐỀ BÀI** — trước đó nó chỉ nhìn ảnh cắt 144 DPI mờ,
trong khi trọng tài chấm và đường sinh ảnh đều đã được đọc đề; đúng hai ca thua cũ là lỗi
mà đề nói rõ (*"thiếu đoạn nối P và A"*, *"đồ thị cắt Oy sai dấu tung độ"*);
(2) bỏ một `Promise.race` bọc quanh lớp gọi Gemini — hạn ngoài 120 s bằng đúng hạn mỗi lượt
bên trong, nên **vòng dự phòng model chưa bao giờ chạy được** cho hình, và `Promise.race`
lại không huỷ được yêu cầu nên lượt bị bỏ rơi vẫn tốn hạn mức. Bằng chứng: một hình mất
**đúng 120 000 ms** rồi báo "dựng hỏng" — nó hết giờ, không phải sinh mã sai;
(3) hình xử lý **song song** thay vì nối đuôi, hiệu suất đo được **1,94/2 = 97%**.
Tổng thời gian dựng hình: **493 s → 452 s**, dù khối lượng việc thật tăng gần gấp đôi
(vòng dự phòng nay chạy thật thay vì bị cắt ngang).

**Hình TikZ giờ có bộ kiểm dựng THẬT, và nó tìm ra bốn thứ sai.** Trước bản này không ai
biết một bảng biến thiên có tiệm cận đứng hay một hình chóp có nét đứt đúng chỗ có dựng ra
được không — cho tới lúc chạy đề thật. Nay có 47 hình của chương trình THPT chia bốn họ
(đồ thị 14, bảng biến thiên 8, hình phẳng 10, hình không gian 15), mỗi hình ghi rõ mục
chương trình, dựng qua đúng đường sản phẩm: **47/47 dựng được, ~90 giây cả lượt**
(`node scripts/verify-tikz-render.mjs`). Bốn phát hiện: (1) tô miền bằng
`\fill[pattern]` nối hai lệnh `plot` **chạy được** — mở đường cho dạng diện tích hình
phẳng và thể tích khối tròn xoay của lớp 12; (2) `name intersections`, phép chiếu
`($(B)!(A)!(C)$)`, `circle through=`, `decorations.markings`, `ellipse/arc (a and b)` đều
chạy; (3) renderer **tất định** từng byte qua hai lượt, nên dải mực siết được tới **±10%**
— đủ chặt để bắt lại lớp lỗi font 404 của 1.2, thứ chỉ lệch ~11% mực; (4) ngưỡng đạt của
bộ probe cũ sai đơn vị — nó lưu phần trăm rồi so với `0.02`, tức ngưỡng thật 0,0002,
**lỏng gấp 10 lần** ngưỡng của app, nên ca probe báo "dựng được" ở 0,05% mực là ca app
thật sự bỏ hình. Mở `/tikz-corpus.html` để soát 47 hình bằng mắt — harness chỉ chứng minh
hình *dựng được*, không chứng minh hình *đúng kiểu SGK*.

**Lời giải tự có hình minh hoạ khi cần, kể cả khi đề đã có hình.** Chỗ hỏng cũ: prompt dạy
`Đề ĐÃ CÓ HÌNH -> veHinh = false`, còn phần đáp án thì in lại nguyên khối đề — cộng lại
thành ra đúng những câu hình học không gian có hình trong đề lại là những câu lời giải
**không bao giờ** có hình riêng, nó chỉ in lại ảnh cắt chưa có đường cao, chưa có chân
đường vuông góc, chưa có góc cần tìm. Nay `figurePolicy.ts` chốt ở CODE chứ không phó cho
model: hình học không gian, bài đơn điệu/cực trị/GTLN-GTNN, bài tương giao/tiệm cận/diện
tích, và câu tự luận chứng minh đều **bắt buộc** có hình; đề đã có hình thì hình của lời
giải phải vẽ THÊM đường phụ, không được sao chép. Model trả "không vẽ" cho câu bắt buộc
thì gọi lại đúng một lượt chỉ để xin hình (trần 12 lượt mỗi đề). Và bịt hai lỗ hổng đi
kèm: solver dựng hình hỏng nay đẩy cảnh báo vào tab Kiểm tra thay vì chỉ ghi nhật ký rồi
im, còn `renderTikz` nay truyền `onNote` nên ghi chú của bộ lọc không bị vứt nữa.

**Trình bày hình trong lời giải, và ba số đo.** Đoạn ảnh trước đây luôn canh giữa theo cột
đầy đủ nên hình trong lời giải lệch **0,87 cm** (chuẩn thường) / **0,63 cm** (chuẩn VDC) so
với khối chữ nó minh hoạ — vì khối ảnh của bộ quét MMD không mang cờ "đang trong lời giải"
dù bộ quét vẫn theo dõi trạng thái đó. Thêm **trần chiều cao 420 px = 11,1 cm**: trước đây
chỉ kẹp chiều rộng nên một hình cao hẹp 200×1200 px ra 3,97 × **23,81 cm**, gần trọn chiều
cao chữ; nay ra 1,85 × 11,11 cm. Trần chọn có đo — hình cao nhất trong 25 đề golden là 342
px, cao nhất trong bộ corpus là 375 px, nên **không hình nào đang có bị co thêm** và
`document.xml` của cả 25 đề vẫn trùng từng byte. Và vá dải trắng chọc qua nền xanh chuẩn
VDC: đoạn ảnh trong khối đề trước đây không được tô nên nền `C5E0B3` bị chẻ làm hai —
đo trên 6 file mẫu VDC thì **29/29** đoạn ảnh nằm trong khối đã tô đều CÓ nền.

**TikZ hỏng thì nhờ AI dựng ảnh — chỉ cho hình mô hình vật thật.** Hình toán chính xác vẫn
phải là TikZ: bảng biến thiên, đồ thị, hình không gian, hình phẳng đều không đi qua đường
này, vì sai một dấu hay một số trục là sai hỏng bài mà trọng tài đối chiếu với ảnh cắt mờ
cũng không bắt được. Ảnh sinh ra đọc **cả ảnh cắt lẫn đề bài** — ảnh là thẩm quyền về nội
dung, đề là thẩm quyền về ý nghĩa, và đề bị cắt bỏ các dòng phương án A/B/C/D vì số của
phương án nhiễu chính là thứ model hay vẽ lên hình. Rồi qua **hai cửa**: mười phép đo pixel
tất định (không tốn lượt gọi) trước, trọng tài nhìn hai ảnh sau — trọng tài phải liệt kê
nhãn của cả hai ảnh TRƯỚC khi kết luận, và quyết định cuối nằm ở code chứ không ở model.
Không đạt thì giữ ảnh cắt, y như cũ. Ảnh AI luôn kèm cảnh báo "phải xem lại trước khi in",
và tab Kiểm tra có thêm **khung soát hình**: thumbnail từng hình kèm nhãn nguồn (ảnh cắt /
TikZ / AI sinh) — trước bản này app không có chỗ nào xem được từng hình.

**Đọc đúng đề chính thức THPT 2025 — tìm ra bằng cách chạy thật mã đề 0101.** Hai chỗ hỏng, cả
hai đều chỉ lộ khi chạy đề thật: (1) đề 2025 ghi *"thí sinh chọn đúng HOẶC sai"* mà bộ nhận tiêu
đề chỉ khớp `đúng-sai` liền, nên PHẦN II không được nhận; (2) PHẦN III của đề 2025 chỉ ghi
*"Thí sinh trả lời từ câu 1 đến câu 6."* — **không có chữ nào cho biết đó là trả lời ngắn** — nên
bản trước bỏ luôn tiêu đề đó, và cả 6 câu bị giải thành tự luận: **không câu nào có dòng "Đáp
số:"**. Nay tiêu đề phần được nhận cả khi chưa rõ loại, rồi để nội dung quyết định (câu hỏi
"bằng bao nhiêu" / "làm tròn đến" là trả lời ngắn). Đo lại trên chính mã đề 0101: ba phần đều
mang tên chuẩn và **6/6 câu có "Đáp số:"**, giải lỗi 0, hai lượt lệch 0.

**Nhãn trong hình không còn bị nét chạy xuyên qua.** Luật cũ đã có câu "nhãn đặt ngoài hình,
không đè lên nét" từ 1.2 — mà hình vẫn bị đè, nên thêm một câu nữa cũng vô ích. Nay có phép ĐO:
dựng hình thành hai lớp (chỉ nét, chỉ chữ) rồi đếm pixel chồng nhau. Đo lần đầu trên bộ 47 hình
chuẩn: **13 hình bị đè** — mũi tên bảng biến thiên đâm vào nhãn `+∞`, nhãn `O` nằm trên trục,
nhãn `G` nằm trên trung tuyến. Đã sửa hết 13 hình, và luật vẽ đổi từ nói suông sang kỹ thuật cụ
thể: ghi kèm khoảng cách (`above=2pt`), điểm có nhiều nét đi ra thì dùng hướng thẳng, mũi tên
phải dừng trước nhãn, nhãn góc dùng `angle eccentricity`. Máy dò có bài TỰ KIỂM riêng (một hình
cố tình đặt nhãn đè phải bị bắt) vì `catch` trả 0 khiến "sạch" và "hỏng" trông giống hệt nhau.

**Bật/tắt đánh số trang.** Công tắc "Số trang" cạnh chọn định dạng. Tắt thì bỏ hẳn footer chứ
không để footer rỗng — footer rỗng vẫn sinh file và vẫn chừa chỗ trắng cuối trang. Mặc định bật,
đúng file mẫu K11.

**Sửa ba bug nền.** Hai chỗ gọi Gemini cho hình (`scoreRedraw`, `tikzMultiAgent`) không
truyền `models` và `signal`, nên 3-4 lượt gọi mỗi hình luôn bắt đầu ở model bậc 1 dù đã dò
ra tài khoản không có nó, và **vẫn đốt hạn mức sau khi bấm Dừng**. Mục lịch sử khôi phục
công tắc mà không có giá trị mặc định — mục lưu trước khi một công tắc ra đời cho
`undefined`, và ô tích chết cứng mà không hiện disabled; thêm công tắc thứ sáu ở bản này là
tạo ra đúng dân số đó trên đĩa của mọi người. Prompt soi hình gửi lặp **ba** khối luật
chung trong một lượt gọi, nay chọn đúng một khối theo loại hình.

**Sửa tám lỗi tìm ra khi soát lại toàn bộ thay đổi.** Ba cái đáng kể, cả ba đều IM LẶNG:
phép so nhãn của trọng tài chấm ảnh AI chuẩn hoá một bên mà không chuẩn hoá bên kia, nên
`"$A$"` không bao giờ khớp `"a"` — cửa chấm biến thành cửa luôn-từ-chối; cửa cỡ tối thiểu đo
cạnh NGẮN trong khi ảnh đã được kẹp cạnh DÀI, nên mọi hình dẹt bị loại oan; và mục lịch sử
lưu trước 1.3 khôi phục `wordOptions` không có mặc định, làm ô tích Số trang chết cứng —
đúng lớp lỗi đã sửa cho công tắc mà quên áp sang trường mới của chính bản này.

**Model đánh trùng id hình thì không còn nuốt mất hình.** Đo thật: một hình ở trang 3 nhận
id `p1_f1`, trùng id hình trang 1. Trùng id tệ hơn mất hình — bản cắt sau ghi đè bản trước
rồi hai câu khác nhau cùng trỏ vào một ảnh, mà QC không thấy gì vì id nào cũng có dữ liệu.
Nay id bị ép về đúng trang và tham chiếu trong nội dung được sửa theo.

**Chuỗi model**: sinh ảnh ưu tiên `gemini-3-pro-image` → `gemini-3.1-flash-image` →
`gemini-2.5-flash-image`; đọc-hiểu giữ `gemini-3.1-pro` → `3.6-flash`. Mọi tên đều đã đối
chiếu `models.list()` chứ không đặt theo tên nghe hợp lý — `gemini-3.1-pro` hiện CHƯA phát
hành nên nằm sẵn ở bậc 1 và bị lọc ra cho tới ngày có thật.

Bộ kiểm: `npm run verify` từ 12 lên **15 harness**, `verify:ci` từ 6 lên **9**. 25 đề golden vẫn
trùng `document.xml` từng ký tự qua toàn bộ thay đổi trên.

## 1.2.1

**Nút tải trong README giờ tải file luôn.** Trước đây nó mở trang Release rồi người
dùng phải tự tìm file. GitHub chỉ cho tải trực tiếp qua đường
`/releases/latest/download/<đúng tên file>`, mà tên có chứa version thì link vỡ mỗi
lần lên bản — nên bộ cài đổi tên thành `MathVision-Setup.exe`, không còn số version.
Bản portable vẫn giữ version trong tên vì người dùng hay để nhiều bản cạnh nhau.

**Giảm gần một nửa chi phí mỗi lần chạy.** Bản 1.2.0 nhồi ba khối luật vẽ hình đầy đủ
vào prompt gửi kèm **mỗi câu**, làm prompt một câu phình từ 705 lên 4.800 token phần
luật hình — trong khi phần lớn câu không vẽ hình nào. Đề 30 câu bật giải 2 lượt:
538.000 → 285.000 token input. Luật đầy đủ chuyển sang lượt soi lại hình, lượt đó chỉ
chạy cho câu thật sự có hình.

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
