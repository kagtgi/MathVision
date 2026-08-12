/**
 * Giao diện các công tắc điều khiển pipeline, dùng chung cho hai chế độ.
 *
 * KIỂU và MẶC ĐỊNH nằm ở `pipeline/toggles.ts` (không DOM) vì `history/serialize.ts` cần
 * `DEFAULT_TOGGLES` như một giá trị mà vẫn phải import được từ Node. Re-export ở đây để mọi
 * chỗ đang `import { type PipelineToggles } from './components/OptionToggles'` vẫn chạy.
 */

import {
  DEFAULT_TOGGLES,
  HIDDEN_IN_IMAGE_MODE,
  type PipelineToggles,
} from '../pipeline/toggles.ts';

export { DEFAULT_TOGGLES, HIDDEN_IN_IMAGE_MODE, type PipelineToggles };

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
    label: 'Ưu tiên vẽ lại hình bằng TikZ',
    hint: 'Hình vẽ được dựng lại cho nét; ảnh chụp vật thật giữ nguyên ảnh gốc',
  },
  {
    key: 'genFigureImage',
    label: 'TikZ hỏng thì nhờ AI dựng ảnh',
    hint: 'Chỉ cho hình mô hình vật thật; đọc kèm đề bài; không đạt thì vẫn giữ ảnh cắt',
    dependsOn: 'redrawTikz',
  },
];

export default function OptionToggles({ value, onChange, disabled, hideRedraw }: Props) {
  const rows = hideRedraw ? ROWS.filter((r) => !HIDDEN_IN_IMAGE_MODE.includes(r.key)) : ROWS;

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
