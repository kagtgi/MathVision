# Góp sức cho MathVision

Cảm ơn bạn đã quan tâm. Dự án này làm ra để dùng thật trong việc soạn đề, nên
tiêu chí số một là **file Word xuất ra không được xấu đi**.

## Quy trình

1. Fork rồi tạo nhánh từ `main`.
2. Sửa code, chạy kiểm (xem dưới).
3. Mở Pull Request. Nhánh `main` yêu cầu PR được duyệt mới merge được.

## Chạy thử

```bash
npm install
npm run dev
```

App cần một API key Gemini, nhập ngay ở màn hình đầu. Key chỉ nằm trong
`localStorage` của máy bạn, không gửi đi đâu ngoài Google và không ghi vào file
nào trong repo.

## Kiểm trước khi mở PR

```bash
npm run lint
npm run verify
```

`npm run verify` là bộ kiểm thật của dự án (không có Jest/Vitest). Bảy harness:

| Harness | Kiểm gì |
|---|---|
| `verify-pipeline.mjs` | 25 đề golden chạy lại qua toàn chuỗi phải ra chính nó, cộng fixture chuẩn hoá và QC |
| `verify-docx.mjs` | `document.xml` phải trùng **từng ký tự** với oracle `scripts/ref-mmd2docx.cjs` trên cả 25 đề |
| `verify-numbering.mjs` | nhãn "Câu N." dựng bằng numbering đúng spec đo từ file mẫu |
| `verify-solver-shape.mjs` | lời giải do máy sinh ra đúng bố cục sau khi tái cấu trúc |
| `verify-vdc.mjs` | docx + .txt định dạng VDC khớp spec, và định dạng thường không bị đổi |
| `verify-textlayer.mjs` | phép đối chiếu lớp văn bản PDF bắt được lỗi thật, không báo oan |
| `verify-download.mjs` | luồng lưu file của bản đóng gói — **cần một bản `.exe` đã build** |

**Ba harness cần dữ liệu ngoài repo.** `verify-pipeline`, `verify-docx` và
`verify-numbering` (phần golden) đọc 25 file `.mmd` ở `MMD KTGK/` và `MMD KTTX/`
cùng ảnh ở `figures/`, mặc định tìm tại `C:\Users\Win\Downloads\PDF TO WORD`.
Đó là đề thi thật của học sinh nên không đưa lên repo được. Máy bạn không có
thì truyền đường dẫn khác (`node scripts/verify-docx.mjs "D:\du-lieu"`) hoặc
chạy bản CI:

```bash
npm run verify:ci
```

`verify:ci` gồm bốn harness tự chứa fixture — cũng chính là bộ mà GitHub
Actions chạy trên mỗi PR. Nếu bạn sửa gì trong `src/pipeline/`, hãy nói rõ
trong PR là đã chạy được `npm run verify` đầy đủ hay chưa.

## Nếu bạn sửa file trong `electron/`

Chạy thêm `npm run electron:build` rồi `node scripts/verify-download.mjs` —
harness đó bật app thật lên và thử luồng lưu file, đây là chỗ duy nhất bắt được
lỗi chỉ xuất hiện ở bản đóng gói.

## Đừng làm

- **Đừng sửa `scripts/ref-mmd2docx.cjs`.** Nó là bản copy đóng băng của bộ
  chuyển đổi gốc, tồn tại đúng để làm mốc so sánh. Sửa nó là mất mốc.
- Đừng đổi hằng số twip/màu/tab stop trong `mmdToDocx.ts` hay `mmdToDocxVdc.ts`
  mà không đo lại từ file mẫu. Mọi con số ở đó đều đo từ file thật.
- Đừng đo định dạng chỉ bằng cách đọc text của `document.xml`. Nhãn đánh số,
  màu, nền đều có thể nằm ở `numbering.xml` hoặc `styles.xml` — bản 1.0 đã kết
  luận sai là "định dạng VDC không có nhãn Câu N." đúng vì lỗi này.

## Commit

Tiếng Việt, thể mệnh lệnh, nói **vì sao** chứ không chỉ **cái gì**:

```
Sửa nút Tải Word không ra file, và cho TikZ chạy song song với giải đề
```
