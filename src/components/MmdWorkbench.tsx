/**
 * Khu làm việc sau khi đọc xong tài liệu: xem trước — sửa MMD — kiểm tra — tải Word.
 *
 * Dùng chung cho cả hai chế độ. Nội dung ô soạn thảo là NGUỒN CHÂN LÝ khi dựng docx,
 * nên người dùng sửa gì là ra đúng cái đó.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Packer } from 'docx';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Code,
  Download,
  Eye,
  FileText,
  Loader2,
  ShieldCheck,
} from 'lucide-react';

import { figureDataUrl, makeFigureResolver, type FigureMap } from '../pipeline/figures';
import { FORMATS, type DocFormat } from '../pipeline/formats';
import { buildExamDocx } from '../pipeline/mmdToDocx';
import { buildVdcDocx } from '../pipeline/mmdToDocxVdc';
import { mmdToVdcTxt } from '../pipeline/mmdToVdcTxt';
import {
  isRendererReady,
  lintMmd,
  loadMathpixRenderer,
  renderMmdHtml,
  type RenderLintIssue,
} from '../pipeline/mathpixPreview';
import type { QcIssue } from '../pipeline/qc';

type Tab = 'preview' | 'source' | 'qc';

interface Props {
  mmd: string;
  onMmdChange: (next: string) => void;
  issues: QcIssue[];
  notes: string[];
  figures: FigureMap;
  fileName: string;
  /** Đang chạy pipeline — khoá nút tải để tránh tải bản dở dang. */
  busy?: boolean;
  format: DocFormat;
  onFormatChange: (next: DocFormat) => void;
}

export default function MmdWorkbench({
  mmd,
  onMmdChange,
  issues,
  notes,
  figures,
  fileName,
  busy,
  format,
  onFormatChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('preview');
  const [html, setHtml] = useState<string | null>(null);
  const [rendererFailed, setRendererFailed] = useState(false);
  const [lint, setLint] = useState<RenderLintIssue[]>([]);
  const [downloading, setDownloading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dataUrls = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, fig] of figures) m.set(id, figureDataUrl(fig));
    return m;
  }, [figures]);

  const dataUrlFor = useCallback((id: string) => dataUrls.get(id) ?? null, [dataUrls]);

  // Nạp bộ render một lần, rồi render lại có tiết chế khi MMD đổi.
  useEffect(() => {
    let cancelled = false;
    loadMathpixRenderer().then((ok) => {
      if (!cancelled && !ok) setRendererFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== 'preview' && tab !== 'qc') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const ok = await loadMathpixRenderer();
      if (cancelled) return;
      if (!ok) {
        setRendererFailed(true);
        return;
      }
      setHtml(renderMmdHtml(mmd, dataUrlFor));
      setLint(lintMmd(mmd));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mmd, tab, dataUrlFor]);

  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');

  const jumpToLine = (line?: number) => {
    if (!line) return;
    setTab('source');
    setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = mmd.split('\n').slice(0, line - 1).join('\n').length + 1;
      el.focus();
      el.setSelectionRange(pos, pos);
      const lineHeight = 20;
      el.scrollTop = Math.max(0, (line - 6) * lineHeight);
    }, 40);
  };

  const stem = fileName.replace(/\.(pdf|png|jpe?g|webp)$/i, '');

  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const download = async () => {
    if (errors.length) {
      const go = window.confirm(
        `Còn ${errors.length} lỗi chưa xử lý trong tab Kiểm tra. Vẫn tải file Word?`,
      );
      if (!go) return;
    }
    setDownloading(true);
    try {
      const resolver = makeFigureResolver(figures);
      const doc = format === 'vdc' ? buildVdcDocx(mmd, resolver) : buildExamDocx(mmd, resolver);
      saveBlob(await Packer.toBlob(doc), `${stem}.docx`);
    } finally {
      setDownloading(false);
    }
  };

  /** Bản .txt theo skill của nhóm VDC — chỉ có ở định dạng VDC. */
  const downloadTxt = () => {
    saveBlob(new Blob([mmdToVdcTxt(mmd)], { type: 'text/plain;charset=utf-8' }), `${stem}.txt`);
  };

  const tabButton = (id: Tab, label: string, Icon: typeof Eye, badge?: number) => (
    <button onClick={() => setTab(id)} className="seg-item" data-on={tab === id}>
      <Icon className="w-3.5 h-3.5" />
      {label}
      {badge ? <span className="badge badge-err ml-1">{badge}</span> : null}
    </button>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0" style={{ background: 'var(--surface-2)' }}>
      {/* Thanh công cụ */}
      <div
        className="shrink-0 h-12 px-4 hairline-b flex items-center justify-between gap-3"
        style={{ background: 'var(--surface)' }}
      >
        <div className="seg">
          {tabButton('preview', 'Xem trước', Eye)}
          {tabButton('source', 'MMD', Code)}
          {tabButton('qc', 'Kiểm tra', ShieldCheck, errors.length || undefined)}
        </div>

        <div className="flex items-center gap-2.5">
          {!busy && errors.length === 0 && warns.length === 0 && mmd.trim() && (
            <span className="badge badge-ok">
              <CheckCircle2 className="w-3 h-3" />
              Sạch
            </span>
          )}

          <select
            value={format}
            onChange={(e) => onFormatChange(e.target.value as DocFormat)}
            disabled={busy}
            title={FORMATS.find((f) => f.id === format)?.hint}
            className="h-[30px] px-2 rounded-lg text-[12.5px]"
            style={{ border: '1px solid var(--line-strong)', background: 'var(--surface)' }}
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>

          {format === 'vdc' && (
            <button
              onClick={downloadTxt}
              disabled={busy || !mmd.trim()}
              className="btn btn-outline btn-sm"
              title="Bản .txt theo quy ước nhập liệu của nhóm"
            >
              <FileText className="w-3.5 h-3.5" />
              Tải .txt
            </button>
          )}

          <button
            onClick={download}
            disabled={downloading || busy || !mmd.trim()}
            className="btn btn-primary btn-sm"
          >
            {downloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Tải Word
          </button>
        </div>
      </div>

      {/* Nội dung tab */}
      <div className="flex-1 overflow-y-auto min-h-0 scroll-thin">
        {tab === 'preview' && (
          <div className="p-8">
            {rendererFailed ? (
              <p className="t-body">
                Không nạp được bộ hiển thị công thức. Nội dung vẫn đầy đủ ở tab MMD và file
                Word tải về không bị ảnh hưởng.
              </p>
            ) : html ? (
              <div className="mmd-preview doc-sheet" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="t-small flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {isRendererReady() ? 'Đang dựng bản xem trước…' : 'Đang nạp bộ hiển thị công thức…'}
              </p>
            )}
          </div>
        )}

        {tab === 'source' && (
          <textarea
            ref={textareaRef}
            value={mmd}
            onChange={(e) => onMmdChange(e.target.value)}
            spellCheck={false}
            className="editor min-h-[400px]"
          />
        )}

        {tab === 'qc' && (
          <div className="p-6 space-y-6 max-w-[760px]">
            {notes.length > 0 && (
              <section>
                <h3 className="t-label mb-2">Ghi chú xử lý</h3>
                <ul className="space-y-1">
                  {notes.map((n, i) => (
                    <li key={i} className="t-body">
                      {n}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <IssueList
              title="Lỗi cần xử lý"
              tone="error"
              items={errors}
              onJump={jumpToLine}
              empty="Không có lỗi."
            />
            <IssueList
              title="Cảnh báo"
              tone="warn"
              items={warns}
              onJump={jumpToLine}
              empty="Không có cảnh báo."
            />

            {lint.length > 0 && (
              <section>
                <h3 className="t-label mb-2">Bộ dựng Mathpix báo lỗi cú pháp</h3>
                <ul className="space-y-1.5">
                  {lint.map((l, i) => (
                    <li key={i} className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
                      {l.message}
                      {l.snippet && <span style={{ color: 'var(--ink-3)' }}> — {l.snippet}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IssueList({
  title,
  tone,
  items,
  onJump,
  empty,
}: {
  title: string;
  tone: 'error' | 'warn';
  items: QcIssue[];
  onJump: (line?: number) => void;
  empty: string;
}) {
  const Icon = tone === 'error' ? AlertCircle : AlertTriangle;
  const color = tone === 'error' ? 'var(--err)' : 'var(--warn)';
  return (
    <section>
      <h3 className="t-label mb-2">
        {title} {items.length ? `(${items.length})` : ''}
      </h3>
      {items.length === 0 ? (
        <p className="t-small">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <Icon className="w-3.5 h-3.5 mt-[3px] shrink-0" style={{ color }} />
              <button
                onClick={() => onJump(it.line)}
                className="text-left text-[12.5px] hover:underline"
                style={{ color: 'var(--ink-2)' }}
              >
                {it.line ? <span style={{ color: 'var(--ink-4)' }}>dòng {it.line}: </span> : null}
                {it.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
