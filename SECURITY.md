# Báo lỗi bảo mật

Nếu bạn tìm ra lỗi bảo mật, **đừng mở issue công khai**. Hãy dùng
[Security Advisory](https://github.com/kagtgi/MathVision/security/advisories/new)
của GitHub, hoặc nhắn riêng cho [@kagtgi](https://github.com/kagtgi).

Tôi làm dự án này ngoài giờ dạy nên có thể trả lời chậm, nhưng lỗi bảo mật sẽ
được xem trước mọi việc khác.

## Phiên bản được hỗ trợ

Chỉ bản phát hành mới nhất. Bản cũ không được vá.

## App xử lý dữ liệu gì

Nắm được mấy điều này thì đánh giá rủi ro dễ hơn:

- **API key Gemini** người dùng tự nhập. Từ 1.2.0 key được **mã hoá bằng
  `safeStorage` của Electron** (trên Windows là DPAPI, khoá gắn với tài khoản
  Windows đang đăng nhập) và lưu trong `%APPDATA%\MathVision\secrets.json`. Key
  cũ nằm trong `localStorage` được chuyển sang tự động theo luật
  ghi-trước-xoá-sau. Máy nào không có kho khoá hệ thống thì app **nói thật** ở
  mục Cài đặt là key đang lưu dạng văn bản thường, chứ không giả vờ đã mã hoá.
  Lưu ý: ciphertext DPAPI chỉ giải mã được trên đúng tài khoản Windows đó —
  copy thư mục sang máy khác thì key coi như mất, app sẽ hỏi lại.
  Key chỉ được gửi tới `generativelanguage.googleapis.com`, không đi qua máy chủ
  nào của dự án — dự án không có máy chủ.
  Bản web (vercel) vẫn dùng `localStorage` như trước.
- **Nội dung đề thi** (PDF, ảnh, văn bản) được gửi tới Gemini để nhận dạng và
  giải. Đây là điều bắt buộc để app hoạt động, và là dữ liệu nhạy cảm nếu đề
  chưa thi. Đừng dùng app cho đề còn trong thời gian bảo mật.
- **Không có telemetry.** App không gửi thống kê, không tự gọi ra ngoài ngoài
  Gemini và (từ 1.1.0) kiểm tra bản cập nhật ở GitHub Releases.
- **File Word xuất ra** ghi thẳng ra đĩa qua hộp thoại lưu của hệ điều hành.

## Điều đã biết, không phải lỗi

- `webSecurity: false` trong `electron/main.cjs` — cần để `fetch()` gọi được
  Gemini từ origin `file://`. App chỉ nạp file cục bộ, mọi liên kết ngoài đều bị
  đẩy sang trình duyệt hệ thống chứ không mở trong cửa sổ app.
- Bản `.exe` không có code signing, nên Windows SmartScreen sẽ cảnh báo. Hash
  SHA256 của mỗi bản phát hành được công bố trong Release để tự kiểm chứng.
