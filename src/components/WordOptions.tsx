/**
 * Chọn định dạng / font / số câu bắt đầu cho file Word.
 *
 * Dùng ở HAI chỗ với cùng một state: cột trái (trước khi chạy) và thanh công cụ khu làm
 * việc (đổi được trước lúc tải). `variant` chỉ đổi cách trình bày.
 */

import { FORMATS, type DocFormat } from '../pipeline/formats';
import { FONT_PRESETS, type FontPresetId } from '../pipeline/fonts';
// Kiểu + mặc định nằm ở `pipeline/wordOptions.ts` (không DOM) vì `history/store.ts` cần
// `DEFAULT_WORD_OPTIONS` như một giá trị mà vẫn import được từ Node. Re-export để mọi chỗ đang
// import từ file này vẫn chạy.
import { DEFAULT_WORD_OPTIONS, type WordOptionsValue } from '../pipeline/wordOptions';

export { DEFAULT_WORD_OPTIONS, type WordOptionsValue };

interface Props {
  value: WordOptionsValue;
  onChange: (next: WordOptionsValue) => void;
  disabled?: boolean;
  /** `stack` = cột trái (có nhãn), `inline` = thanh công cụ (chỉ select). */
  variant: 'stack' | 'inline';
}

const SELECT_STYLE = {
  border: '1px solid var(--line-strong)',
  background: 'var(--surface)',
} as const;

export default function WordOptions({ value, onChange, disabled, variant }: Props) {
  const format = FORMATS.find((f) => f.id === value.format);
  const font = FONT_PRESETS.find((f) => f.id === value.fontId);
  const inline = variant === 'inline';
  const cls = `h-[30px] px-2 rounded-lg text-[12.5px] ${inline ? '' : 'w-full'}`;

  const formatSelect = (
    <select
      value={value.format}
      onChange={(e) => onChange({ ...value, format: e.target.value as DocFormat })}
      disabled={disabled}
      title={format?.hint}
      className={cls}
      style={SELECT_STYLE}
      aria-label="Định dạng file Word"
    >
      {FORMATS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </select>
  );

  const fontSelect = (
    <select
      value={value.fontId ?? ''}
      onChange={(e) =>
        onChange({ ...value, fontId: (e.target.value || null) as FontPresetId | null })
      }
      disabled={disabled}
      title={font?.hint ?? 'Font và cỡ chữ của file Word'}
      className={cls}
      style={SELECT_STYLE}
      aria-label="Font file Word"
    >
      <option value="">Font theo định dạng</option>
      {FONT_PRESETS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </select>
  );

  // Số câu bắt đầu: file VDC hằng tuần đánh tiếp dải trước (file mẫu bắt đầu ở 65).
  const startInput = value.format === 'vdc' && (
    <input
      type="number"
      min={1}
      value={value.startNumber}
      onChange={(e) => onChange({ ...value, startNumber: Math.max(1, Number(e.target.value) || 1) })}
      disabled={disabled}
      title="Số của câu đầu tiên — tuần sau đánh tiếp thì nhập số kế tiếp"
      className={`h-[30px] px-2 rounded-lg text-[12.5px] ${inline ? 'w-[74px]' : 'w-full'}`}
      style={SELECT_STYLE}
      aria-label="Số câu bắt đầu"
    />
  );

  // Chuẩn VDC không có footer (đo từ file mẫu), nên công tắc chỉ có nghĩa với định dạng thường.
  const pageNumberToggle = value.format !== 'vdc' && (
    <label
      className={`flex items-center gap-2 ${inline ? 'h-[30px] px-2' : ''} ${
        disabled ? 'opacity-40' : 'cursor-pointer'
      }`}
      title='In dòng "Trang N" ở chân mỗi trang'
    >
      <input
        type="checkbox"
        checked={value.pageNumbers}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, pageNumbers: e.target.checked })}
        className="w-3.5 h-3.5 shrink-0 rounded"
        style={{ accentColor: 'var(--accent)' }}
      />
      <span className="text-[12.5px] whitespace-nowrap" style={{ color: 'var(--ink)' }}>
        Số trang
      </span>
    </label>
  );

  if (inline) {
    return (
      <>
        {formatSelect}
        {fontSelect}
        {startInput}
        {pageNumberToggle}
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="t-small block mb-1">Định dạng Word</label>
        {formatSelect}
      </div>
      <div>
        <label className="t-small block mb-1">Font</label>
        {fontSelect}
      </div>
      {value.format === 'vdc' && (
        <div>
          <label className="t-small block mb-1">Số câu bắt đầu</label>
          {startInput}
        </div>
      )}
      {pageNumberToggle}
    </div>
  );
}
