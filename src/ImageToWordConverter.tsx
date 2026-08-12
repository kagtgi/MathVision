/**
 * Ảnh → Word: một ảnh chụp/quét đề đi qua đúng đường ống của chế độ PDF.
 *
 * Ảnh gửi lên API được thu nhỏ tối đa 2048 px (bản cũ để 1024 px — quá nhỏ với ảnh
 * chụp đề dày chữ, chỉ số dưới và dấu tiếng Việt nhoè hết), còn bản gốc giữ nguyên
 * độ phân giải để cắt hình cho nét.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import {
  AlertCircle,
  History as HistoryIcon,
  Image as ImageIcon,
  Loader2,
  Upload,
  X,
} from 'lucide-react';

import MmdWorkbench from './components/MmdWorkbench';
import OptionToggles, {
  DEFAULT_TOGGLES,
  type PipelineToggles,
} from './components/OptionToggles';
import WordOptions, { DEFAULT_WORD_OPTIONS, type WordOptionsValue } from './components/WordOptions';
import { cropFigure, type FigureMap } from './pipeline/figures';
import { textBlockReason } from './pipeline/cropGate';
import { ocrPage } from './pipeline/ocr';
import { recheck, runTextPipeline } from './pipeline/runPipeline';
import type { QcIssue } from './pipeline/qc';
import { tikzToImage } from './utils/latexToImage';
import * as historyStore from './history/store';
import type { RestoredConversion } from './history/store';
import { canvasThumbJpeg } from './history/thumb';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const API_MAX_DIM = 2048;
const API_JPEG_QUALITY = 0.85;

interface Props {
  apiKey: string;
  models?: string[];
  /** Mục lịch sử vừa được mở lại; `restoreSeq` tăng mỗi lần mở để effect chạy lại. */
  restore?: RestoredConversion | null;
  restoreSeq?: number;
}

export default function ImageToWordConverter({ apiKey, models, restore, restoreSeq }: Props) {
  /** Tên nguồn để đặt tên .docx — mục mở lại từ lịch sử không có `File` nào. */
  const [sourceName, setSourceName] = useState('de-thi');
  const [restoredFrom, setRestoredFrom] = useState<{ fileName: string; at: number } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const [mmd, setMmd] = useState('');
  const [issues, setIssues] = useState<QcIssue[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [figures, setFigures] = useState<FigureMap>(new Map());
  const [disagreements, setDisagreements] = useState<string[]>([]);
  const [wordOptions, setWordOptions] = useState<WordOptionsValue>(DEFAULT_WORD_OPTIONS);
  const format = wordOptions.format;

  // Chế độ ảnh đơn không có bước vẽ lại hình trong đề (xem `HIDDEN_IN_IMAGE_MODE`).
  const [toggles, setToggles] = useState<PipelineToggles>({
    ...DEFAULT_TOGGLES,
    redrawTikz: false,
    genFigureImage: false,
  });

  const fullResRef = useRef<HTMLCanvasElement | null>(null);
  const figuresRef = useRef<FigureMap>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const historyIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const thumbRef = useRef<Uint8Array | undefined>(undefined);

  useEffect(() => () => abortRef.current?.abort(), []);

  const addLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-160), line]);
  }, []);

  const onDrop = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      setError(`Ảnh nặng ${(f.size / 1024 / 1024).toFixed(1)} MB, vượt mức 20 MB.`);
      return;
    }
    setFile(f);
    setSourceName(f.name);
    setRestoredFrom(null);
    historyIdRef.current = null;
    setError(null);
    setMmd('');
    setIssues([]);
    setNotes([]);
    setLog([]);
    // `disagreements` là kết quả của LƯỢT CHẠY, không được sống qua ảnh mới: `onMmdChange`
    // truyền nó lại vào `recheck`, nên thiếu dòng này là cảnh báo "hai lượt giải cho kết quả
    // khác nhau" của ảnh trước rò sang tài liệu mới.
    setDisagreements([]);
    figuresRef.current = new Map();
    setFigures(new Map());

    createImageBitmap(f)
      .then((bitmap) => {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        bitmap.close();
        fullResRef.current = canvas;
        // Ảnh nhỏ cho lịch sử: ở chế độ ảnh thì `fullResRef` bền nên chụp ngay đây được.
        void canvasThumbJpeg(canvas).then((t) => (thumbRef.current = t));
        setPreviewUrl(canvas.toDataURL('image/jpeg', 0.7));
      })
      .catch(() => setError('Không đọc được ảnh. Dùng file PNG, JPG hoặc WebP.'));
  }, []);

  /**
   * File bị react-dropzone loại thì `onDrop` nhận mảng RỖNG, nên câu báo dung lượng ở trên
   * không bao giờ hiện khi người dùng THẢ file quá cỡ — họ thả xong và không thấy gì.
   * (Đường dán Ctrl+V gọi `onDrop` trực tiếp nên nó lại chạm được câu báo đó.)
   */
  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const codes = new Set(rejections.flatMap((r) => r.errors.map((e) => e.code)));
    if (codes.has('file-too-large')) {
      const mb = (rejections[0].file.size / 1024 / 1024).toFixed(1);
      setError(`Ảnh nặng ${mb} MB, vượt mức 20 MB.`);
    } else if (codes.has('file-invalid-type')) {
      setError('Chỉ nhận ảnh PNG, JPG hoặc WebP.');
    } else if (codes.has('too-many-files')) {
      setError('Mỗi lần chỉ xử lý được một ảnh.');
    } else {
      setError('Không nhận được ảnh này.');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE,
  });

  /**
   * Dán ảnh bằng Ctrl+V — chụp Win+Shift+S rồi dán thẳng, khỏi phải lưu file trung gian.
   *
   * Nghe ở `document` chứ không phải ở vùng thả: focus thường nằm ở `<body>` nên listener
   * gắn vào phần tử con sẽ không bao giờ nhận được sự kiện.
   *
   * Chỉ đi đường DOM, KHÔNG thêm IPC `clipboard.readImage()`: Chromium đã tự quy
   * `CF_BITMAP`/`CF_DIB` (Snipping Tool, Paint) và `CF_HDROP` (copy file trong Explorer)
   * thành `File` trong `clipboardData.files`, mà thêm IPC lại buộc sửa `electron/main.cjs`
   * kéo theo phải build exe để chạy lại hai harness.
   *
   * HAI CHỐT, đúng thứ tự — chốt sau là để GIỮ CÔNG VIỆC, không phải giữ chữ:
   *   1. lọc MIME trước, chỉ `preventDefault()` sau khi đã qua ⇒ dán chữ thành no-op hoàn
   *      toàn, trình duyệt vẫn tự chèn chữ vào ô soạn thảo như thường;
   *   2. bỏ qua khi con trỏ đang ở ô soạn thảo ⇒ một lần Ctrl+V lỡ tay lúc đang sửa MMD
   *      không xoá sạch kết quả, vì `onDrop` reset `mmd`/`issues`/`notes`.
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const img = Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith('image/'),
      );
      if (!img) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('textarea, input, [contenteditable]')) return;
      if (busy) return;
      e.preventDefault();
      // Snipping Tool đặt tên `image.png` vô dụng; đặt tên theo giờ để file .docx ra tên
      // phân biệt được. GIỮ phần mở rộng để MmdWorkbench cắt đi đúng như file thả vào.
      const ext =
        img.type === 'image/webp' ? 'webp' : img.type === 'image/jpeg' ? 'jpg' : 'png';
      const t = new Date();
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      const ss = String(t.getSeconds()).padStart(2, '0');
      onDrop([new File([img], `anh-dan-${hh}${mm}${ss}.${ext}`, { type: img.type })]);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onDrop, busy]);

  /** Bản thu nhỏ để gửi API — vẫn đủ nét cho chữ nhỏ và chỉ số dưới. */
  const apiImageBase64 = (): string => {
    const src = fullResRef.current!;
    const scale = Math.min(1, API_MAX_DIM / Math.max(src.width, src.height));
    if (scale === 1) return src.toDataURL('image/jpeg', API_JPEG_QUALITY).split(',')[1];
    const out = document.createElement('canvas');
    out.width = Math.round(src.width * scale);
    out.height = Math.round(src.height * scale);
    out.getContext('2d')?.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', API_JPEG_QUALITY).split(',')[1];
  };

  const process = async () => {
    if (!file || !fullResRef.current || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setMmd('');
    setLog([]);
    // Dọn đầu vòng như bên PDF. Thiếu ba dòng này thì chạy lại lần hai còn `issues`,
    // `disagreements` và `figuresRef` của lượt trước.
    setIssues([]);
    setDisagreements([]);
    figuresRef.current = new Map();

    try {
      setStage('Đang đọc ảnh…');
      const res = await ocrPage(
        apiKey,
        {
          imageBase64: apiImageBase64(),
          mimeType: 'image/jpeg',
          pageNumber: 1,
          totalPages: 1,
          prevTail: '',
          singleImage: true,
        },
        { signal: controller.signal, onLog: addLog, models },
      );

      setStage('Đang cắt hình…');
      const map: FigureMap = new Map();
      const warnings = [...res.warnings];
      for (const f of res.figures) {
        const entry = await cropFigure(fullResRef.current, f.bbox);
        if (!entry) {
          warnings.push(`Hình ${f.id}: vùng cắt không hợp lệ — đã bỏ.`);
          continue;
        }
        // Cùng cửa như chế độ PDF (xem `cropGate.ts`), nhưng KHÔNG xin khoanh lại: ở đây chỉ có
        // một ảnh và chính nó là toàn bộ đầu vào, nên bỏ hình rồi báo là đủ — thầy tự cắt lại
        // ảnh rồi chạy lượt nữa còn nhanh hơn một lượt hỏi model.
        const why = entry.stats ? textBlockReason(entry.stats) : null;
        if (why) {
          warnings.push(`Hình ${f.id}: khoanh sai vùng — ${why}. Đã bỏ hình này.`);
          continue;
        }
        map.set(f.id, entry);
      }
      figuresRef.current = map;
      setFigures(new Map(map));

      setStage(toggles.autoSolve ? 'Đang giải đề…' : 'Đang chuẩn hoá nội dung…');
      const result = await runTextPipeline({
        pageMmds: [res.mmd],
        figureIds: new Set(map.keys()),
        examMode: toggles.examMode,
        format,
        autoSolve: toggles.autoSolve,
        solveOptions: {
          apiKey,
          models,
          signal: controller.signal,
          onLog: addLog,
          doubleCheck: toggles.doubleCheck,
          drawFigures: toggles.drawFigures,
          verifyFigures: toggles.drawFigures,
          figureImages: figureImagesOf(map),
          // Xem chú thích cùng chỗ ở `PdfToDocxConverter`: thiếu `onNote` là mất sạch lý do khi
          // hình lời giải hỏng.
          renderTikz: async (code) => {
            const png = await tikzToImage(code, (n) => addLog(`TikZ lời giải: ${n}`));
            return png ? { bytes: png.bytes, w: png.width, h: png.height } : null;
          },
          onProgress: (done, total) => {
            setStage(`Đang giải câu ${done}/${total}…`);
            setProgress({ done, total });
          },
        },
      });

      for (const [id, fig] of result.newFigures) {
        figuresRef.current.set(id, { ...fig, source: 'tikz' });
      }
      setFigures(new Map(figuresRef.current));
      setMmd(result.mmd);
      setNotes([...warnings, ...result.notes]);
      setIssues(result.issues);
      setDisagreements(result.disagreements);
      setStage('');
      setProgress(null);

      // Chỉ lưu khi chạy xong trọn vẹn — MMD dở dang trong danh sách còn tệ hơn không có.
      if (!controller.signal.aborted) {
        historyIdRef.current = await historyStore.save({
          mode: 'image-to-word',
          fileName: file.name,
          pageCount: 1,
          mmd: result.mmd,
          notes: [...warnings, ...result.notes],
          issues: result.issues,
          disagreements: result.disagreements,
          wordOptions,
          toggles,
          figures: figuresRef.current,
          thumb: thumbRef.current,
          meta: { models },
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Lỗi không xác định.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onMmdChange = (next: string) => {
    setMmd(next);
    const nextIssues = recheck(next, new Set(figuresRef.current.keys()), disagreements);
    setIssues(nextIssues);
    const id = historyIdRef.current;
    if (!id) return;
    // Chỉ ghi lại entry.json, KHÔNG đụng figures/ — xem ghi chú ở PdfToDocxConverter.
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void historyStore.update(id, { mmd: next, issues: nextIssues, wordOptions });
    }, 3000);
  };

  useEffect(() => {
    const id = historyIdRef.current;
    if (!id || !mmd) return;
    void historyStore.update(id, { mmd, issues, wordOptions });
  }, [wordOptions]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  /** Nhận mục mở lại từ lịch sử — ba chỗ dễ sai giải thích ở PdfToDocxConverter. */
  useEffect(() => {
    if (!restore || restore.mode !== 'image-to-word') return;
    figuresRef.current = restore.figures;
    setFigures(new Map(restore.figures));
    setDisagreements(restore.disagreements);
    setIssues(restore.issues);
    setNotes(restore.notes);
    setWordOptions(restore.wordOptions);
    setToggles(restore.toggles);
    setSourceName(restore.fileName);
    setFile(null);
    setPreviewUrl(null);
    fullResRef.current = null;
    setError(null);
    setMmd(restore.mmd);
    historyIdRef.current = restore.id;
    setRestoredFrom({ fileName: restore.fileName, at: restore.createdAt });
  }, [restoreSeq]);

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <div className="w-[340px] xl:w-[380px] shrink-0 flex flex-col hairline-r overflow-hidden">
        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-5 space-y-6">
          <div>
            <span className="t-label block mb-2">Ảnh đề</span>
            {!previewUrl ? (
              <div
                {...getRootProps()}
                role="button"
                className="dropzone flex flex-col items-center justify-center py-14 text-center"
                data-active={isDragActive}
              >
                <input {...getInputProps()} />
                <Upload className="w-5 h-5 mb-3" style={{ color: 'var(--ink-4)' }} />
                <p className="text-[13.5px] font-medium" style={{ color: 'var(--ink-2)' }}>
                  Thả ảnh vào đây hoặc dán (Ctrl+V)
                </p>
                <p className="t-small mt-0.5">PNG · JPG · WebP — tối đa 20 MB</p>
              </div>
            ) : (
              <div className="relative rounded-xl overflow-hidden card">
                <img
                  src={previewUrl}
                  alt="Ảnh đề"
                  className="w-full h-auto max-h-[300px] object-contain"
                />
                <button
                  onClick={() => {
                    setFile(null);
                    setPreviewUrl(null);
                    fullResRef.current = null;
                  }}
                  className="absolute top-2 right-2 rounded-lg p-1"
                  style={{ background: 'rgba(255,255,255,0.9)', color: 'var(--ink-2)' }}
                  aria-label="Bỏ ảnh"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <OptionToggles value={toggles} onChange={setToggles} disabled={busy} hideRedraw />

          {restoredFrom && (
            <div className="card p-2.5 flex items-start gap-2">
              <HistoryIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] truncate">Mở lại: {restoredFrom.fileName}</p>
                <p className="t-small">
                  {new Date(restoredFrom.at).toLocaleString('vi-VN')} · xuất Word được, chạy lại
                  thì cần thả ảnh gốc
                </p>
              </div>
              <button
                onClick={() => setRestoredFrom(null)}
                style={{ color: 'var(--ink-4)' }}
                aria-label="Đóng"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Chọn trước khi chạy; đổi lại được ở thanh công cụ khu làm việc. */}
          <WordOptions
            value={wordOptions}
            onChange={setWordOptions}
            disabled={busy}
            variant="stack"
          />

          {previewUrl && (
            <button
              onClick={busy ? () => abortRef.current?.abort() : process}
              className={`btn w-full ${busy ? 'btn-outline' : 'btn-primary'}`}
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Dừng lại
                </>
              ) : mmd ? (
                'Chạy lại'
              ) : (
                <>
                  <ImageIcon className="w-4 h-4" />
                  Chuyển thành Word
                </>
              )}
            </button>
          )}

          {(stage || progress) && (
            <div className="space-y-2">
              <p className="t-small">{stage}</p>
              {progress && progress.total > 0 && (
                <div className="progress">
                  <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: '#fce8e6' }}>
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--err)' }} />
              <p className="text-[12.5px]" style={{ color: 'var(--err)' }}>
                {error}
              </p>
            </div>
          )}

          {log.length > 0 && (
            <details>
              <summary className="t-small cursor-pointer">Nhật ký xử lý ({log.length})</summary>
              <div className="mt-2 space-y-0.5 max-h-52 overflow-y-auto scroll-thin">
                {log.map((l, i) => (
                  <p
                    key={i}
                    className="truncate text-[11px] font-mono"
                    style={{ color: 'var(--ink-4)' }}
                  >
                    {l}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="shrink-0 px-5 py-3" style={{ borderTop: '1px solid var(--line)' }}>
          <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
            Công thức giữ dạng $…$ — mở Word rồi chạy MathType Toggle TeX để thành equation.
          </p>
        </div>
      </div>

      {mmd ? (
        <MmdWorkbench
          mmd={mmd}
          onMmdChange={onMmdChange}
          issues={issues}
          notes={notes}
          figures={figures}
          fileName={sourceName}
          busy={busy}
          wordOptions={wordOptions}
          onWordOptionsChange={setWordOptions}
        />
      ) : (
        <div
          className="flex-1 flex items-center justify-center"
          style={{ background: 'var(--surface-2)' }}
        >
          <p className="t-small">{busy ? 'Đang xử lý…' : 'Kết quả sẽ hiện ở đây.'}</p>
        </div>
      )}
    </div>
  );
}

function figureImagesOf(map: FigureMap): Map<string, { base64: string; mimeType: string }> {
  const out = new Map<string, { base64: string; mimeType: string }>();
  for (const [id, fig] of map) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < fig.bytes.length; i += chunk) {
      binary += String.fromCharCode(...fig.bytes.subarray(i, i + chunk));
    }
    out.set(id, { base64: btoa(binary), mimeType: 'image/png' });
  }
  return out;
}
