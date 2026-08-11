/**
 * PDF → Word.
 *
 * Đường đi: pdf.js render trang → Gemini đọc thành MMD (kèm bbox hình) → cắt ảnh hình
 * từ chính trang đó → ghép trang → chuẩn hoá → tự giải đề → tái cấu trúc → docx chuẩn.
 *
 * Hai nguyên tắc rút từ lần làm trước:
 *   - HÌNH VẼ (hình học, đồ thị, biểu đồ) ưu tiên dựng lại bằng TikZ cho nét; ảnh cắt
 *     từ PDF là lưới an toàn khi TikZ hỏng, nên không bao giờ để chỗ trống. Chỉ ẢNH
 *     CHỤP vật thật mới bắt buộc giữ ảnh gốc — vẽ lại là bịa nội dung.
 *   - Người dùng sửa được MMD trước khi tải, vì OCR và lời giải máy đều có thể sai.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { AlertCircle, FileText, Loader2, Upload, X } from 'lucide-react';

import MmdWorkbench from './components/MmdWorkbench';
import OptionToggles, { type PipelineToggles } from './components/OptionToggles';
import WordOptions, { DEFAULT_WORD_OPTIONS, type WordOptionsValue } from './components/WordOptions';
import { cropFigure, type FigureMap } from './pipeline/figures';
import { ocrPage } from './pipeline/ocr';
import type { FigureKind } from './pipeline/prompts';
import { canvasToJpegBase64, extractPageText, loadPdf, renderPdfPage } from './pipeline/pdfRender';
import { crossCheckPage } from './pipeline/textLayerCheck';
import { recheck, runTextPipeline } from './pipeline/runPipeline';
import type { QcIssue } from './pipeline/qc';
import { tikzToImage } from './utils/latexToImage';
import { generateTikzMultiAgent } from './utils/tikzMultiAgent';
import { isRedrawable } from './utils/figurePrompts';
import { scoreRedraw } from './utils/scoreRedraw';

const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;
const RENDER_BATCH_SIZE = 4;

interface Props {
  apiKey: string;
  models?: string[];
}

export default function PdfToDocxConverter({ apiKey, models }: Props) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
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

  const [toggles, setToggles] = useState<PipelineToggles>({
    examMode: true,
    autoSolve: true,
    doubleCheck: true,
    drawFigures: true,
    redrawTikz: true,
  });

  const abortRef = useRef<AbortController | null>(null);
  const figuresRef = useRef<FigureMap>(new Map());

  useEffect(() => () => abortRef.current?.abort(), []);

  const addLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-160), line]);
  }, []);

  const onDrop = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_PDF_SIZE_BYTES) {
      setError(`File nặng ${(file.size / 1024 / 1024).toFixed(1)} MB, vượt mức 50 MB.`);
      return;
    }
    setPdfFile(file);
    setError(null);
    setMmd('');
    setIssues([]);
    setNotes([]);
    setLog([]);
    // Kết quả của LƯỢT CHẠY, không được sống qua file mới — xem comment cùng chỗ ở
    // ImageToWordConverter.
    setDisagreements([]);
    figuresRef.current = new Map();
    setFigures(new Map());
  }, []);

  /** Xem comment cùng chỗ ở ImageToWordConverter: thả file quá cỡ vốn không báo gì. */
  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const codes = new Set(rejections.flatMap((r) => r.errors.map((e) => e.code)));
    if (codes.has('file-too-large')) {
      const mb = (rejections[0].file.size / 1024 / 1024).toFixed(1);
      setError(`File nặng ${mb} MB, vượt mức 50 MB.`);
    } else if (codes.has('file-invalid-type')) {
      setError('Chỉ nhận file PDF.');
    } else if (codes.has('too-many-files')) {
      setError('Mỗi lần chỉ xử lý được một file.');
    } else {
      setError('Không nhận được file này.');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: MAX_PDF_SIZE_BYTES,
  });

  const process = async () => {
    if (!pdfFile || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setMmd('');
    setIssues([]);
    setDisagreements([]);
    setLog([]);
    figuresRef.current = new Map();

    try {
      setStage('Đang mở PDF…');
      const pdf = await loadPdf(await pdfFile.arrayBuffer());
      const total = pdf.numPages;

      // ── Render toàn bộ trang trước, theo lô để không ngốn RAM ──
      const canvases = new Map<number, HTMLCanvasElement>();
      const base64 = new Map<number, string>();
      for (let batch = 0; batch < total; batch += RENDER_BATCH_SIZE) {
        if (controller.signal.aborted) return;
        const end = Math.min(batch + RENDER_BATCH_SIZE, total);
        await Promise.all(
          Array.from({ length: end - batch }, (_, k) => batch + k + 1).map(async (p) => {
            const canvas = await renderPdfPage(pdf, p);
            canvases.set(p, canvas);
            base64.set(p, canvasToJpegBase64(canvas));
          }),
        );
        setStage(`Đang dựng ảnh trang ${end}/${total}…`);
        setProgress({ done: end, total });
      }

      // ── Đọc từng trang thành MMD ──
      // Chạy tuần tự để đuôi trang trước làm ngữ cảnh cho trang sau (nối liền câu bị
      // cắt trang) — đây là thứ ghép trang không tự đoán được.
      const pageMmds: string[] = [];
      const allWarnings: string[] = [];
      const figureJobs: Array<{
        id: string;
        page: number;
        bbox: [number, number, number, number];
        kind: FigureKind;
      }> = [];
      const textLayerIssues: QcIssue[] = [];

      for (let p = 1; p <= total; p++) {
        if (controller.signal.aborted) return;
        setStage(`Đang đọc trang ${p}/${total}…`);
        setProgress({ done: p, total });

        const prevTail = pageMmds.join('\n\n');
        const res = await ocrPage(
          apiKey,
          {
            imageBase64: base64.get(p)!,
            mimeType: 'image/jpeg',
            pageNumber: p,
            totalPages: total,
            prevTail,
          },
          { signal: controller.signal, onLog: addLog, models },
        );
        pageMmds.push(res.mmd);
        allWarnings.push(...res.warnings);
        for (const f of res.figures) {
          figureJobs.push({ id: f.id, page: p, bbox: f.bbox, kind: f.kind });
        }

        // Đối chiếu với lớp văn bản có sẵn trong PDF: gần như miễn phí, và là thứ duy
        // nhất bắt được câu bị bỏ sót hay số bị đổi — lỗi của mô hình đọc rất trôi chảy
        // nên nhìn mắt không ra.
        try {
          const layer = await extractPageText(pdf, p);
          textLayerIssues.push(
            ...crossCheckPage({ pageText: layer, mmd: res.mmd, pageNumber: p }),
          );
        } catch {
          // PDF lạ không đọc được lớp text thì bỏ qua, đây chỉ là kiểm tra thêm.
        }
      }

      // ── Hình: cắt trước làm lưới an toàn, rồi ưu tiên dựng lại bằng TikZ ──
      //
      // Ảnh cắt từ PDF luôn dính hạt và hay lem chữ bên cạnh, nên hình VẼ (hình học, đồ
      // thị, biểu đồ) được dựng lại bằng TikZ cho nét; chỉ ẢNH CHỤP vật thật mới bắt buộc
      // giữ ảnh gốc, vì vẽ lại là bịa nội dung. Cắt vẫn chạy trước để nếu TikZ hỏng thì
      // vẫn còn hình, không bao giờ để chỗ trống.
      setStage('Đang cắt hình từ trang gốc…');
      const map: FigureMap = new Map();
      for (const job of figureJobs) {
        const canvas = canvases.get(job.page);
        if (!canvas) continue;
        const entry = await cropFigure(canvas, job.bbox);
        if (entry) map.set(job.id, entry);
        else allWarnings.push(`Hình ${job.id}: vùng cắt không hợp lệ — đã bỏ.`);
      }
      figuresRef.current = map;
      setFigures(new Map(map));

      // Dựng TikZ CHẠY SONG SONG với bước giải đề: cả hai đều chờ Gemini, nối tiếp nhau
      // thì người dùng phải đợi thêm vài phút mới bấm được nút Tải. Chờ cả hai xong rồi
      // mới hiện kết quả, nên thứ nhìn thấy vẫn là bản cuối.
      const tikzWork = (async () => {
        if (!toggles.redrawTikz) return;
        // `isRedrawable` thay cho `kind === 've'`: từ 1.2.0 loại hình được chia nhỏ (bbt,
        // dothi, khonggian, phang, model) để chọn đúng luật vẽ, `ve` chỉ còn là giá trị dự
        // phòng khi chưa phân loại được.
        const drawable = figureJobs.filter((j) => isRedrawable(j.kind) && map.has(j.id));
        const skipped = figureJobs.length - drawable.length;
        for (const [i, job] of drawable.entries()) {
          if (controller.signal.aborted) return;
          addLog(`TikZ: đang vẽ lại hình ${i + 1}/${drawable.length} (${job.id})`);
          const ok = await redrawOne(job.id, map.get(job.id)!, controller, job.kind);
          if (!ok) allWarnings.push(`Hình ${job.id}: dựng TikZ không đạt — dùng ảnh cắt từ đề.`);
        }
        if (skipped) {
          allWarnings.push(`${skipped} hình là ảnh chụp vật thật — giữ nguyên ảnh gốc.`);
        }
        setFigures(new Map(figuresRef.current));
      })();

      // ── Chặng văn bản: chuẩn hoá → tự giải → tái cấu trúc → QC ──
      setStage(toggles.autoSolve ? 'Đang giải đề…' : 'Đang chuẩn hoá nội dung…');
      const result = await runTextPipeline({
        pageMmds,
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
          figureImages: buildFigureImages(map),
          renderTikz: async (code) => {
            const png = await tikzToImage(code);
            return png ? { bytes: png.bytes, w: png.width, h: png.height } : null;
          },
          onProgress: (done, totalQ) => {
            setStage(`Đang giải câu ${done}/${totalQ}…`);
            setProgress({ done, total: totalQ });
          },
        },
      });

      // Chờ nốt phần vẽ hình đang chạy song song, để bản hiện ra là bản cuối.
      setStage('Đang hoàn tất hình vẽ…');
      await tikzWork;

      for (const [id, fig] of result.newFigures) {
        figuresRef.current.set(id, { ...fig, source: 'tikz' });
      }
      setFigures(new Map(figuresRef.current));
      setMmd(result.mmd);
      setNotes([...allWarnings, ...result.notes]);
      setIssues([...textLayerIssues, ...result.issues]);
      setDisagreements(result.disagreements);
      setStage('');
      setProgress(null);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Lỗi không xác định.');
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Dựng lại MỘT hình bằng TikZ, và CHỈ thay vào chỗ ảnh cắt khi bản vẽ lại thật sự tốt hơn.
   *
   * Bản trước thay ngay khi mã compile được, mà bước soát thì chỉ đọc ảnh gốc cùng hai chuỗi
   * mã — KHÔNG BAO GIỜ nhìn ảnh mình vừa dựng. Nên nó có thể lặng lẽ thay một ảnh cắt đọc
   * được bằng một hình sai-mà-vẫn-dựng-được. Giờ đưa ẢNH CẮT GỐC và ẢNH VỪA DỰNG cạnh nhau
   * cho model chấm, thua thì giữ ảnh cắt.
   *
   * Trả `false` khi giữ ảnh cắt — lúc đó ảnh cắt vẫn nguyên trong figureMap nên tài liệu
   * không bao giờ thiếu hình. Hỏng một hình không được làm hỏng cả tài liệu, nên mọi lỗi
   * đều nuốt tại đây.
   */
  const redrawOne = async (
    id: string,
    fig: { bytes: Uint8Array },
    controller: AbortController,
    kind: FigureKind,
  ): Promise<boolean> => {
    try {
      const gen = await generateTikzMultiAgent(apiKey, bytesToBase64(fig.bytes), 'image/png', {
        kind,
      });
      if (controller.signal.aborted) return false;
      if (!gen.tikzCode.includes('\\begin{tikzpicture}')) return false;
      const png = await tikzToImage(gen.tikzCode, (n) => addLog(`TikZ ${id}: ${n}`));
      if (!png) return false;
      if (controller.signal.aborted) return false;

      const verdict = await scoreRedraw(
        apiKey,
        bytesToBase64(fig.bytes),
        bytesToBase64(png.bytes),
        kind,
      );
      if (verdict.keep === 'crop') {
        addLog(`TikZ ${id}: giữ ảnh cắt — ${verdict.why}`);
        return false;
      }

      figuresRef.current.set(id, {
        bytes: png.bytes,
        w: png.width,
        h: png.height,
        source: 'tikz',
      });
      setFigures(new Map(figuresRef.current));
      return true;
    } catch {
      return false;
    }
  };

  const onMmdChange = (next: string) => {
    setMmd(next);
    setIssues(recheck(next, new Set(figuresRef.current.keys()), disagreements));
  };

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      {/* ─── Trái: nguồn + tuỳ chọn ─── */}
      <div className="w-[340px] xl:w-[380px] shrink-0 flex flex-col hairline-r overflow-hidden">
        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-5 space-y-6">
          <div>
            <span className="t-label block mb-2">Đề gốc</span>
            {!pdfFile ? (
              <div
                {...getRootProps()}
                role="button"
                className="dropzone flex flex-col items-center justify-center py-14 text-center"
                data-active={isDragActive}
              >
                <input {...getInputProps()} />
                <Upload className="w-5 h-5 mb-3" style={{ color: 'var(--ink-4)' }} />
                <p className="text-[13.5px] font-medium" style={{ color: 'var(--ink-2)' }}>
                  Thả file PDF vào đây
                </p>
                <p className="t-small mt-0.5">hoặc bấm để chọn · tối đa 50 MB</p>
              </div>
            ) : (
              <div className="card flex items-center gap-2.5 px-3 py-2.5">
                <FileText className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                <span className="text-[13px] truncate flex-1">{pdfFile.name}</span>
                <button
                  onClick={() => setPdfFile(null)}
                  className="shrink-0"
                  style={{ color: 'var(--ink-4)' }}
                  aria-label="Bỏ file"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <OptionToggles value={toggles} onChange={setToggles} disabled={busy} />

          {/* Chọn trước khi chạy; đổi lại được ở thanh công cụ khu làm việc. */}
          <WordOptions
            value={wordOptions}
            onChange={setWordOptions}
            disabled={busy}
            variant="stack"
          />

          {pdfFile && (
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
                'Chuyển thành Word'
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
            <div
              className="flex items-start gap-2 rounded-lg p-3"
              style={{ background: '#fce8e6' }}
            >
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

      {/* ─── Phải: khu làm việc ─── */}
      {mmd ? (
        <MmdWorkbench
          mmd={mmd}
          onMmdChange={onMmdChange}
          issues={issues}
          notes={notes}
          figures={figures}
          fileName={pdfFile?.name ?? 'de-thi'}
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

/** Ảnh hình trong đề, để solver "nhìn" được câu hình học. */
function buildFigureImages(map: FigureMap): Map<string, { base64: string; mimeType: string }> {
  const out = new Map<string, { base64: string; mimeType: string }>();
  for (const [id, fig] of map) out.set(id, { base64: bytesToBase64(fig.bytes), mimeType: 'image/png' });
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
