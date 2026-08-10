/**
 * Điều phối toàn bộ chặng văn bản: MMD từng trang -> MMD hoàn chỉnh + báo cáo QC.
 *
 * Mọi thứ dính DOM (render PDF, cắt ảnh, dựng TikZ) nằm ở tầng UI và đi vào đây qua
 * tham số, để chặng này chạy được cả dưới Node trong harness.
 */

import { conformMmd } from './conform.ts';
import { applyExamTransforms, prepareExamForSolving } from './examTransforms.ts';
import { type DocFormat } from './formats.ts';
import { fixEscapes, normalizeMmd } from './normalize.ts';
import { qcMmd, type QcIssue } from './qc.ts';
import { renderSolutionsMmd, solveExam, type SolveOptions, type SolvedQuestion } from './solveExam.ts';
import { stitchPages } from './stitchPages.ts';
import { applyVdcLatex } from './vdcLatex.ts';

export interface PipelineInput {
  pageMmds: string[];
  /** Id hình đã có dữ liệu (crop / TikZ), dùng cho QC. */
  figureIds: Set<string>;
  /** Chuẩn hoá bố cục đề thi (tắt khi tài liệu không phải đề). */
  examMode: boolean;
  /** Tự giải và sinh ĐÁP ÁN CHI TIẾT khi đề chưa có lời giải. */
  autoSolve: boolean;
  /** Tuỳ chọn cho solver; bắt buộc khi autoSolve = true. */
  solveOptions?: Omit<SolveOptions, 'apiKey'> & { apiKey: string };
  /**
   * Định dạng đầu ra. Chỉ ảnh hưởng ở đây khi là `vdc`: quy ước LaTeX của nhóm VDC
   * (`{A}'`, `\int\limits`, `\left`/`\right`, số trần không bọc `$`) phải áp vào chính
   * MMD, vì người dùng còn sửa tay ở tab MMD rồi mới dựng file.
   */
  format?: DocFormat;
}

export interface PipelineResult {
  mmd: string;
  issues: QcIssue[];
  notes: string[];
  solved: SolvedQuestion[];
  disagreements: string[];
  /** Hình do solver tự dựng, cần nhập vào figureMap của UI. */
  newFigures: Map<string, { bytes: Uint8Array; w: number; h: number }>;
}

const HAS_SOLUTIONS = /(?:^|\n)##\s*HƯỚNG DẪN GIẢI/;

export async function runTextPipeline(input: PipelineInput): Promise<PipelineResult> {
  const notes: string[] = [];
  const stitched = stitchPages(input.pageMmds);
  notes.push(...stitched.notes);

  let mmd = fixEscapes(normalizeMmd(stitched.mmd));

  let solved: SolvedQuestion[] = [];
  let disagreements: string[] = [];
  const newFigures = new Map<string, { bytes: Uint8Array; w: number; h: number }>();

  const alreadyHasSolutions = HAS_SOLUTIONS.test(mmd) || mmd.includes('# ĐÁP ÁN CHI TIẾT');

  if (input.examMode && input.autoSolve && !alreadyHasSolutions && input.solveOptions) {
    // Chuẩn hoá tiêu đề phần TRƯỚC khi giải: solver cần biết loại câu.
    const prepared = prepareExamForSolving(mmd);
    mmd = prepared.mmd;
    if (prepared.parts.length) notes.push(`Các phần nhận diện được: ${prepared.parts.join(' / ')}`);

    const result = await solveExam(mmd, input.solveOptions);
    solved = result.solved;
    disagreements = result.disagreements;
    for (const [k, v] of result.newFigures) newFigures.set(k, v);

    const failed = solved.filter((s) => s.failed).length;
    if (failed) notes.push(`${failed} câu chưa giải được — dùng nút "Giải lại câu này".`);

    // Lời giải cũng do model viết ra nên phải qua đúng lớp sửa như văn bản OCR: model
    // rất hay dùng `\begin{cases}` cho hệ phương trình và `$$` cho công thức tách dòng,
    // hai thứ MathType không nuốt được. Thiếu bước này thì QC báo lỗi mà không ai sửa.
    const conformed = conformMmd(renderSolutionsMmd(solved), { insertTableSeparators: false });
    if (conformed.notes.length) {
      notes.push(
        'Đã chỉnh lời giải về chuẩn MMD: ' +
          conformed.notes.map((n) => `${n.rule}×${n.count}`).join(', '),
      );
    }
    mmd = mmd.trimEnd() + '\n\n' + fixEscapes(normalizeMmd(conformed.mmd));
  } else if (alreadyHasSolutions) {
    notes.push('Tài liệu đã có sẵn lời giải — dùng bản in sẵn, không tự giải.');
  }

  if (input.examMode) {
    const t = applyExamTransforms(mmd);
    mmd = t.mmd;
    if (t.report.restructure?.missing.length) {
      notes.push(`Thiếu lời giải cho: ${t.report.restructure.missing.join('; ')}`);
    }
  }

  // Quy ước LaTeX của VDC áp SAU cùng, khi nội dung đã ổn định: các transform đề thi
  // đều khớp mẫu theo `$...$` chuẩn, đổi ngoặc sớm là chúng không nhận ra nữa.
  if (input.format === 'vdc') {
    mmd = applyVdcLatex(mmd);
    notes.push('Đã áp quy ước LaTeX của nhóm VDC (\\left/\\right, {A}’, \\int\\limits).');
  }

  const figureIds = new Set(input.figureIds);
  for (const id of newFigures.keys()) figureIds.add(id);

  const issues = qcMmd(mmd, { figureIds, disagreements });
  return { mmd, issues, notes, solved, disagreements, newFigures };
}

/** Chạy lại QC sau khi người dùng sửa tay trong tab MMD. */
export function recheck(mmd: string, figureIds: Set<string>, disagreements: string[] = []): QcIssue[] {
  return qcMmd(mmd, { figureIds, disagreements });
}
