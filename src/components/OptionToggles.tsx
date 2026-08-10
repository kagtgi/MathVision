/** Các công tắc điều khiển pipeline, dùng chung cho hai chế độ. */

export interface PipelineToggles {
  /** Chuẩn hoá bố cục đề thi (bỏ phiếu tô, tiêu đề PHẦN, mục ĐÁP ÁN CHI TIẾT). */
  examMode: boolean;
  /** Tự giải đề khi tài liệu chưa có lời giải. */
  autoSolve: boolean;
  /** Giải hai lượt rồi đối chiếu, lệch thì có lượt thứ ba phân xử. */
  doubleCheck: boolean;
  /** Cho phép tự vẽ hình minh hoạ cho bài hình học. */
  drawFigures: boolean;
  /** Vẽ lại hình có sẵn trong đề bằng TikZ (ảnh crop vẫn luôn được giữ làm nền). */
  redrawTikz: boolean;
}

interface Props {
  value: PipelineToggles;
  onChange: (next: PipelineToggles) => void;
  disabled?: boolean;
  /** Chế độ ảnh đơn: không có bước vẽ lại hình trong đề. */
  hideRedraw?: boolean;
}

const ROWS: Array<{
  key: keyof PipelineToggles;
  label: string;
  hint: string;
  dependsOn?: keyof PipelineToggles;
}> = [
  {
    key: 'examMode',
    label: 'Chuẩn hoá đề thi',
    hint: 'Bỏ phiếu tô, chuẩn tiêu đề PHẦN, dựng mục ĐÁP ÁN CHI TIẾT',
  },
  {
    key: 'autoSolve',
    label: 'Tự giải đề & sinh đáp án',
    hint: 'Đề chưa có lời giải thì tự giải theo văn phong SGK',
    dependsOn: 'examMode',
  },
  {
    key: 'doubleCheck',
    label: 'Giải 2 lượt đối chiếu',
    hint: 'Chậm gấp đôi nhưng phát hiện được câu máy giải không chắc',
    dependsOn: 'autoSolve',
  },
  {
    key: 'drawFigures',
    label: 'Tự vẽ hình cho bài hình học',
    hint: 'Hình không gian lớp 11 chưa có hình thì dựng TikZ bổ sung',
    dependsOn: 'autoSolve',
  },
  {
    key: 'redrawTikz',
    label: 'Vẽ lại hình trong đề bằng TikZ',
    hint: 'Ảnh cắt từ PDF luôn được giữ; TikZ chỉ thay khi dựng thành công',
  },
];

export default function OptionToggles({ value, onChange, disabled, hideRedraw }: Props) {
  const rows = hideRedraw ? ROWS.filter((r) => r.key !== 'redrawTikz') : ROWS;

  return (
    <div>
      <span className="t-label block mb-2">Tuỳ chọn</span>
      <div className="space-y-0.5">
        {rows.map((row) => {
          const parentOff = row.dependsOn ? !value[row.dependsOn] : false;
          const off = disabled || parentOff;
          return (
            <label
              key={row.key}
              className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                off ? 'opacity-40' : 'hover:bg-[var(--surface-2)] cursor-pointer'
              } ${row.dependsOn ? 'ml-4' : ''}`}
            >
              <input
                type="checkbox"
                checked={value[row.key] && !parentOff}
                disabled={off}
                onChange={(e) => onChange({ ...value, [row.key]: e.target.checked })}
                className="mt-[3px] w-3.5 h-3.5 shrink-0 rounded"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="min-w-0">
                <span className="block text-[13px] leading-tight" style={{ color: 'var(--ink)' }}>
                  {row.label}
                </span>
                <span
                  className="block text-[11.5px] leading-snug mt-0.5"
                  style={{ color: 'var(--ink-3)' }}
                >
                  {row.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
