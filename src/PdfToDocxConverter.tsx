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
import { AlertCircle, FileText, History as HistoryIcon, Loader2, Upload, X } from 'lucide-react';

import MmdWorkbench from './components/MmdWorkbench';
import OptionToggles, {
  DEFAULT_TOGGLES,
  type PipelineToggles,
} from './components/OptionToggles';
import WordOptions, { DEFAULT_WORD_OPTIONS, type WordOptionsValue } from './components/WordOptions';
import {
  cropFigure,
  warnFor,
  KIND_NOT_ALLOWED,
  type FigureEntry,
  type FigureMap,
  type FigureOutcome,
  type FigureSource,
} from './pipeline/figures';
import { buildFigureContexts, type FigureContext } from './pipeline/figureContext';
import { measurePng, preGateGen } from './pipeline/imageNormalize';
import { ocrPage } from './pipeline/ocr';
import type { FigureKind } from './pipeline/prompts';
import { canvasToJpegBase64, extractPageText, loadPdf, renderPdfPage } from './pipeline/pdfRender';
import { crossCheckPage } from './pipeline/textLayerCheck';
import { recheck, runTextPipeline } from './pipeline/runPipeline';
import type { QcIssue } from './pipeline/qc';
import { tikzToImage } from './utils/latexToImage';
import { generateTikzMultiAgent } from './utils/tikzMultiAgent';
import { isGenImageAllowed, isRedrawable } from './utils/figurePrompts';
import { scoreRedraw } from './utils/scoreRedraw';
import { scoreGenerated } from './utils/scoreGenerated';
import { genFigureImage } from './utils/genFigureImage';
import * as historyStore from './history/store';
import type { RestoredConversion } from './history/store';
import { canvasThumbJpeg } from './history/thumb';

const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;
const RENDER_BATCH_SIZE = 4;

interface Props {
  apiKey: string;
  models?: string[];
  /**
   * Chuỗi model SINH ẢNH, tách khỏi `models`. Gộp vào là gửi yêu cầu sinh ảnh tới model
   * đọc-hiểu và nhận về text — xem `IMAGE_MODEL_CHAIN`.
   */
  imageModels?: string[];
  /** Mục lịch sử vừa được mở lại; `restoreSeq` tăng mỗi lần mở để effect chạy lại. */
  restore?: RestoredConversion | null;
  restoreSeq?: number;
}

export default function PdfToDocxConverter({
  apiKey,
  models,
  imageModels,
  restore,
  restoreSeq,
}: Props) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  /**
   * Tên nguồn để đặt tên file .docx.
   *
   * Không lấy trực tiếp từ `pdfFile.name` nữa: mục mở lại từ lịch sử KHÔNG có `File` nào, nên
   * thiếu state này thì file xuất ra tên `de-thi.docx` chứ không phải stem gốc.
   */
  const [sourceName, setSourceName] = useState('de-thi');
  const [restoredFrom, setRestoredFrom] = useState<{ fileName: string; at: number } | null>(null);
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

  const [toggles, setToggles] = useState<PipelineToggles>(DEFAULT_TOGGLES);

  const abortRef = useRef<AbortController | null>(null);
  /** Id mục lịch sử của lượt chạy hiện tại, để `update` khi người dùng sửa MMD. */
  const historyIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const thumbRef = useRef<Uint8Array | undefined>(undefined);
  const figuresRef = useRef<FigureMap>(new Map());
  /**
   * Kết quả nâng chất từng hình. Ref là nguồn ghi (vòng lặp chạy trong closure), state là bản
   * trao cho khung soát hình — cùng khuôn `figuresRef`/`figures` ở trên.
   */
  const outcomesRef = useRef<FigureOutcome[]>([]);
  const [outcomes, setOutcomes] = useState<FigureOutcome[]>([]);

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
    setSourceName(file.name);
    setRestoredFrom(null);
    historyIdRef.current = null;
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
    outcomesRef.current = [];
    setOutcomes([]);

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

      // Ảnh nhỏ cho danh sách lịch sử phải chụp NGAY ĐÂY. `canvases` là biến cục bộ của
      // `process()` và không được giữ vào ref nào, nên sau khi hàm này trả về thì pixel trang
      // đã mất — đọc lúc lưu là đọc vào chỗ trống.
      const page1 = canvases.get(1);
      thumbRef.current = page1 ? await canvasThumbJpeg(page1) : undefined;

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

      // Ngữ cảnh đề cho từng hình. Dựng NGAY ĐÂY: `pageMmds` đã đủ, và chặng văn bản (nơi
      // `splitForSolving` chạy) thì khởi động SONG SONG với bước nâng chất hình nên không
      // mượn được map câu↔hình của nó.
      const figureContexts = buildFigureContexts(pageMmds);

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
        // KHÔNG gọi `setStage` trong vòng này: nó chạy song song với solver đang set
        // "Đang giải câu N/M…", hai bên tranh nhau một ô chữ thì người dùng thấy nhấp nháy.
        for (const [i, job] of drawable.entries()) {
          if (controller.signal.aborted) return;
          addLog(`Hình ${i + 1}/${drawable.length} (${job.id}, ${job.kind}): bắt đầu nâng chất`);
          const outcome = await upgradeFigure({
            id: job.id,
            crop: map.get(job.id)!,
            kind: job.kind,
            context: figureContexts.get(job.id),
            controller,
          });
          outcomesRef.current.push(outcome);
          allWarnings.push(...warnFor(outcome));
        }
        if (skipped) {
          allWarnings.push(`${skipped} hình là ảnh chụp vật thật — giữ nguyên ảnh gốc.`);
        }
        const genCount = outcomesRef.current.filter((o) => o.used === 'genai').length;
        const tikzCount = outcomesRef.current.filter((o) => o.used === 'tikz').length;
        const cropCount = figureJobs.length - genCount - tikzCount;
        allWarnings.push(
          `Tổng kết hình: ${tikzCount} vẽ lại bằng TikZ, ${genCount} do AI sinh, ${cropCount} giữ ảnh cắt.`,
        );
        setOutcomes([...outcomesRef.current]);
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
          // CHỤP MAP ẢNH CẮT, cố ý: `map` ở đây là bản ảnh cắt trước khi `tikzWork` ghi đè. Ảnh
          // cắt là bản CHUẨN để solver đọc đề — đưa nó bản TikZ hay bản AI sinh là để nó giải bài
          // dựa trên một hình đã qua tay model khác. Đừng "sửa" thành `figuresRef.current`.
          figureImages: buildFigureImages(map),
          // Truyền `onNote`: không có nó thì mọi ghi chú của bộ lọc ("bỏ dấu tiếng Việt",
          // "bỏ thư viện không có") và mức mực đo được đều bị vứt cho hình solver — trong khi
          // đường ảnh cắt vẫn ghi chúng vào nhật ký. Đó là lý do hình lời giải hỏng thì không ai
          // biết vì sao.
          renderTikz: async (code) => {
            const png = await tikzToImage(code, (n) => addLog(`TikZ lời giải: ${n}`));
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

      // Lưu lịch sử CHỈ khi chạy xong trọn vẹn. Một MMD dở dang trong danh sách còn tệ hơn
      // không có mục nào.
      if (!controller.signal.aborted) {
        historyIdRef.current = await historyStore.save({
          mode: 'pdf-to-word',
          fileName: pdfFile.name,
          pageCount: total,
          mmd: result.mmd,
          notes: [...allWarnings, ...result.notes],
          issues: [...textLayerIssues, ...result.issues],
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

  /**
   * Nâng chất MỘT hình. Thứ tự cố định, và ẢNH CẮT LUÔN LÀ BẢN CUỐI nếu cả hai bước thua:
   *   1. TikZ — vector, nét sạch, người soát được mã, nhẹ. Vẫn là lựa chọn số một.
   *   2. sinh ảnh — CHỈ khi TikZ thua, và CHỈ với loại hình mô hình vật thật
   *      (`isGenImageAllowed`). Đọc thêm ĐỀ BÀI, vì ảnh cắt mờ không đủ để biết điểm nào tên gì;
   *      nhưng model sinh ảnh bịa rất tự nhiên nên phải qua HAI cửa: tiền kiểm tất định bằng
   *      pixel (không tốn lượt gọi) rồi mới tới trọng tài nhìn hai ảnh.
   *   3. giữ ảnh cắt.
   *
   * TikZ thua theo HAI KIỂU khác nhau về mức nguy hiểm: (i) mã không dựng được, (ii) dựng được
   * nhưng trọng tài loại. Kiểu (ii) nghĩa là ảnh cắt khó đọc tới mức một model ĐÃ bịa một lần
   * rồi — đúng chỗ model sinh ảnh cũng dễ bịa nhất. Cả hai đều đi tiếp sang bước 2, và chính
   * cửa trọng tài mới là thứ đỡ kiểu (ii); vì thế kiểu (ii) KHÔNG gửi lại mã TikZ mà chỉ gửi
   * những chỗ đã bị chấm sai làm negative prompt.
   *
   * Trả `FigureOutcome` thay cho `boolean`: bên gọi cần biết THUA Ở ĐÂU mới ghi đúng cảnh báo.
   * Hỏng một hình không được làm hỏng cả tài liệu, nên mọi lỗi đều nuốt tại đây.
   */
  const upgradeFigure = async (a: {
    id: string;
    crop: FigureEntry;
    kind: FigureKind;
    context: FigureContext | undefined;
    controller: AbortController;
  }): Promise<FigureOutcome> => {
    const tried: FigureOutcome['tried'] = [];
    const ctxText = a.context?.text ?? '';
    const cropB64 = bytesToBase64(a.crop.bytes);
    const net = { models, signal: a.controller.signal, context: ctxText };
    const done = (used: FigureSource): FigureOutcome => ({
      id: a.id,
      used,
      tried,
      hadContext: ctxText.length > 0,
      num: a.context?.num ?? null,
    });
    const commit = (bytes: Uint8Array, w: number, h: number, source: FigureSource) => {
      figuresRef.current.set(a.id, { bytes, w, h, source });
      setFigures(new Map(figuresRef.current));
    };

    // ── 1. TikZ ──
    let judged: { code: string; missing: string[]; extra: string[] } | undefined;
    let failedTikz: string | undefined;
    try {
      const gen = await generateTikzMultiAgent(apiKey, cropB64, 'image/png', {
        kind: a.kind,
        models,
        signal: a.controller.signal,
      });
      if (a.controller.signal.aborted) return done('crop');
      const png = gen.tikzCode.includes('\\begin{tikzpicture}')
        ? await tikzToImage(gen.tikzCode, (n) => addLog(`TikZ ${a.id}: ${n}`))
        : null;

      if (!png) {
        failedTikz = gen.tikzCode;
        tried.push({ step: 'tikz', ok: false, why: 'mã không dựng được' });
      } else {
        const verdict = await scoreRedraw(
          apiKey,
          cropB64,
          bytesToBase64(png.bytes),
          a.kind,
          net,
        );
        if (verdict.keep === 'tikz') {
          commit(png.bytes, png.width, png.height, 'tikz');
          tried.push({ step: 'tikz', ok: true, why: verdict.why });
          return done('tikz');
        }
        addLog(`TikZ ${a.id}: trọng tài loại — ${verdict.why}`);
        tried.push({ step: 'tikz', ok: false, why: verdict.why });
        judged = { code: gen.tikzCode, missing: verdict.missing, extra: verdict.extra };
      }
    } catch (err) {
      tried.push({
        step: 'tikz',
        ok: false,
        why: err instanceof Error ? err.message : 'lỗi không rõ',
      });
    }

    // ── 2. sinh ảnh ──
    if (a.controller.signal.aborted) return done('crop');
    if (!toggles.genFigureImage) return done('crop');
    if (!isGenImageAllowed(a.kind)) {
      tried.push({ step: 'genai', ok: false, why: KIND_NOT_ALLOWED });
      return done('crop');
    }

    try {
      addLog(
        `Sinh ảnh ${a.id}: TikZ thua, gọi model sinh hình` +
          (ctxText ? ` (kèm đề câu ${a.context?.num ?? '?'})` : ' (KHÔNG có đề bài)'),
      );
      const img = await genFigureImage({
        apiKey,
        cropBase64: cropB64,
        cropW: a.crop.w,
        cropH: a.crop.h,
        kind: a.kind,
        context: ctxText,
        failedTikz,
        judged,
        models: imageModels,
        signal: a.controller.signal,
        onLog: (s) => addLog(`Sinh ảnh ${a.id}: ${s}`),
      });
      if (a.controller.signal.aborted) return done('crop');
      if (!img) {
        tried.push({ step: 'genai', ok: false, why: 'model không trả ảnh dùng được' });
        return done('crop');
      }

      // Cửa 1: tất định, không tốn lượt gọi.
      const cropStats = await measurePng(a.crop.bytes);
      if (!cropStats) {
        // Không đo được ảnh cắt thì mất mốc so của G9/G10 — thiếu mốc thì không chấm, giữ ảnh cắt.
        const why = 'không đo được ảnh cắt để so';
        addLog(`Sinh ảnh ${a.id}: ${why}`);
        tried.push({ step: 'genai', ok: false, why });
        return done('crop');
      }
      const preFail = preGateGen(cropStats, img.stats);
      if (preFail) {
        addLog(`Sinh ảnh ${a.id}: loại ở tiền kiểm — ${preFail}`);
        tried.push({ step: 'genai', ok: false, why: preFail });
        return done('crop');
      }

      // Cửa 2: trọng tài nhìn hai ảnh, kèm đề bài.
      const verdict = await scoreGenerated({
        apiKey,
        cropBase64: cropB64,
        genBase64: bytesToBase64(img.bytes),
        kind: a.kind,
        context: ctxText,
        models,
        signal: a.controller.signal,
      });
      if (verdict.keep !== 'genai') {
        addLog(`Sinh ảnh ${a.id}: trọng tài giữ ảnh cắt — ${verdict.why}`);
        tried.push({ step: 'genai', ok: false, why: verdict.why });
        return done('crop');
      }

      commit(img.bytes, img.w, img.h, 'genai');
      addLog(`Sinh ảnh ${a.id}: THAY ảnh cắt (độ tin cậy ${verdict.doTinCay}%) — cần người duyệt.`);
      tried.push({ step: 'genai', ok: true, why: verdict.why });
      return done('genai');
    } catch (err) {
      tried.push({
        step: 'genai',
        ok: false,
        why: err instanceof Error ? err.message : 'lỗi không rõ',
      });
      return done('crop');
    }
  };

  const onMmdChange = (next: string) => {
    setMmd(next);
    const nextIssues = recheck(next, new Set(figuresRef.current.keys()), disagreements);
    setIssues(nextIssues);
    queueHistoryUpdate(next, nextIssues);
  };

  /**
   * Ghi lại mục lịch sử sau khi người dùng ngừng gõ ~3 giây.
   *
   * CHỈ ghi `entry.json` + một dòng index (~300 KB), KHÔNG đụng `figures/` — đó là toàn bộ ý
   * nghĩa của việc tách file: ghi cả hình mỗi nhịp debounce sẽ là vài MB ra đĩa mỗi lần gõ.
   */
  const queueHistoryUpdate = (nextMmd: string, nextIssues: QcIssue[]) => {
    const id = historyIdRef.current;
    if (!id) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void historyStore.update(id, { mmd: nextMmd, issues: nextIssues, wordOptions });
    }, 3000);
  };

  // Đổi định dạng / font / số câu bắt đầu cũng phải lưu, để mở lại ra đúng bản vừa xuất.
  useEffect(() => {
    const id = historyIdRef.current;
    if (!id || !mmd) return;
    void historyStore.update(id, { mmd, issues, wordOptions });
  }, [wordOptions]);

  // Flush lần ghi đang chờ khi rời khỏi màn hình, đừng mất chữ vừa sửa.
  useEffect(
    () => () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  /**
   * Nhận mục vừa mở lại từ lịch sử.
   *
   * Ba chỗ dễ sai, đều phải làm đúng:
   *  - gán `figuresRef.current` (cái REF, không chỉ state): `onMmdChange` đọc ref để dựng
   *    `figureIds` cho QC, thiếu là gõ một ký tự thành "Hình không có dữ liệu" cho MỌI hình;
   *  - `setDisagreements`: nó chỉ được set trong `process()`, mở lại kiểu hồn nhiên là mất
   *    sạch cảnh báo "hai lượt lệch nhau";
   *  - `new Map(...)`: deps của effect xem trước có `figures`, trao lại Map trùng identity thì
   *    khung xem trước không vẽ lại.
   */
  useEffect(() => {
    if (!restore || restore.mode !== 'pdf-to-word') return;
    figuresRef.current = restore.figures;
    setFigures(new Map(restore.figures));
    setDisagreements(restore.disagreements);
    setIssues(restore.issues);
    setNotes(restore.notes);
    setWordOptions(restore.wordOptions);
    setToggles(restore.toggles);
    setSourceName(restore.fileName);
    setPdfFile(null); // không có PDF gốc -> không chạy lại được, nút chạy phải ẩn
    setError(null);
    setMmd(restore.mmd); // đặt cuối: đây là thứ mount khu làm việc
    historyIdRef.current = restore.id;
    setRestoredFrom({ fileName: restore.fileName, at: restore.createdAt });
  }, [restoreSeq]);

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

          {restoredFrom && (
            <div className="card p-2.5 flex items-start gap-2">
              <HistoryIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] truncate">Mở lại: {restoredFrom.fileName}</p>
                <p className="t-small">
                  {new Date(restoredFrom.at).toLocaleString('vi-VN')} · xuất Word được, chạy lại
                  thì cần thả PDF gốc
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
          figureOutcomes={outcomes}
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
