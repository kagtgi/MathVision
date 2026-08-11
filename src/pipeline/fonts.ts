/**
 * Ba preset font cho file Word, chọn được trước khi chạy.
 *
 * `size` là half-point như OOXML: 23 = 11.5pt, 24 = 12pt. Hai giá trị này đo trực tiếp từ
 * file mẫu — `K11-Đề-tặng-kèm-số-1` dùng Times New Roman sz 24, `65-68_Mitu` dùng
 * Palatino Linotype sz 23.
 *
 * Myriad Pro KHÔNG có sẵn trong Windows/Office; máy nào chưa cài thì Word tự thay font
 * khi mở. Vẫn để vì người dùng yêu cầu đúng ba lựa chọn này.
 */

export type FontPresetId = 'palatino' | 'myriad' | 'tnr';

export interface FontPreset {
  id: FontPresetId;
  /** Tên font đúng như Word cần trong `w:rFonts`. */
  name: string;
  /** Half-point. */
  size: number;
  label: string;
  hint?: string;
}

export const FONT_PRESETS: FontPreset[] = [
  { id: 'palatino', name: 'Palatino Linotype', size: 23, label: 'Palatino Linotype 11.5' },
  {
    id: 'myriad',
    name: 'Myriad Pro',
    size: 23,
    label: 'Myriad Pro 11.5',
    hint: 'Windows không có sẵn Myriad Pro — máy chưa cài sẽ bị Word thay font khi mở',
  },
  { id: 'tnr', name: 'Times New Roman', size: 24, label: 'Times New Roman 12' },
];

export function fontPreset(id: FontPresetId): FontPreset {
  return FONT_PRESETS.find((f) => f.id === id) ?? FONT_PRESETS[2];
}

/** Font mặc định của từng định dạng khi người dùng chưa chọn tay. */
export const DEFAULT_FONT_BY_FORMAT = {
  k11: 'tnr',
  vdc: 'palatino',
} as const satisfies Record<string, FontPresetId>;

/** `null` = "theo định dạng" — lựa chọn tay ghi đè font mặc định của định dạng. */
export function resolveFont(format: 'k11' | 'vdc', id: FontPresetId | null): FontPreset {
  return fontPreset(id ?? DEFAULT_FONT_BY_FORMAT[format]);
}
