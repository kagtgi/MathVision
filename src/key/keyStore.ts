/**
 * Đọc/ghi API key, chọn kho theo môi trường.
 *
 * Bản đóng gói: `secrets.json` trong `userData`, mã hoá bằng `safeStorage` (xem
 * `electron/secrets.cjs`). Bản web hoặc bản đóng gói CŨ (có cầu nối nhưng chưa có method
 * key): `localStorage` y như trước — bản web không đổi gì cả.
 *
 * Chọn kho bằng cách hỏi **method có tồn tại không**, KHÔNG bao giờ dò user-agent: nhờ vậy
 * bản đóng gói cũ không âm thầm rơi vào nhánh sai.
 *
 * DI TRÚ: luật bất di bất dịch là **GHI TRƯỚC, XOÁ SAU**. Chỉ xoá bản chữ thường trong
 * `localStorage` khi đã ghi thành công vào `secrets.json`. Ghi hỏng thì GIỮ bản cũ và vẫn cho
 * vào app — thà key nằm chỗ kém an toàn còn hơn làm người dùng mất key.
 */

export const LEGACY_KEY_STORAGE = 'mathvision.apiKey';

export type KeyStorageKind = 'secrets' | 'localStorage';

export interface LoadedKey {
  key: string;
  models?: string[];
  kind: KeyStorageKind;
  /** `none` khi chưa có key. */
  enc: KeyEnc;
  encryptionAvailable: boolean;
  path?: string;
  /** Đã đọc được key cũ nhưng KHÔNG chuyển sang kho mã hoá được. */
  migrationFailed?: boolean;
}

const bridge = () => {
  const b = window.mathvision;
  return b && typeof b.getApiKey === 'function' ? b : null;
};

export function hasSecretStore(): boolean {
  return bridge() !== null;
}

const readLegacy = (): string => {
  try {
    return localStorage.getItem(LEGACY_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
};

const dropLegacy = () => {
  try {
    localStorage.removeItem(LEGACY_KEY_STORAGE);
  } catch {
    /* localStorage bị chặn thì thôi */
  }
};

export async function loadKey(): Promise<LoadedKey> {
  const b = bridge();
  if (!b) {
    return {
      key: readLegacy(),
      kind: 'localStorage',
      enc: readLegacy() ? 'plain' : 'none',
      encryptionAvailable: false,
    };
  }

  const state = await b.getApiKey();

  if (state.enc !== 'none' && state.key) {
    // Đã ở kho mới. Còn sót bản chữ thường thì dọn — dư âm của lần di trú từng chết giữa
    // bước ghi và bước xoá.
    if (readLegacy()) dropLegacy();
    return {
      key: state.key,
      models: state.models,
      kind: 'secrets',
      enc: state.enc,
      encryptionAvailable: state.encryptionAvailable,
      path: state.path,
    };
  }

  // Kho mới trống: thử di trú bản chữ thường.
  const legacy = readLegacy();
  if (!legacy) {
    return {
      key: '',
      kind: 'secrets',
      enc: 'none',
      encryptionAvailable: state.encryptionAvailable,
      path: state.path,
    };
  }

  const saved = await b.setApiKey(legacy);
  if (saved.ok) {
    dropLegacy(); // CHỈ xoá sau khi ghi xong
    return {
      key: legacy,
      kind: 'secrets',
      enc: saved.enc,
      encryptionAvailable: state.encryptionAvailable,
      path: state.path,
    };
  }

  return {
    key: legacy,
    kind: 'localStorage',
    enc: 'plain',
    encryptionAvailable: state.encryptionAvailable,
    path: state.path,
    migrationFailed: true,
  };
}

export async function saveKey(key: string, models?: string[]): Promise<{ ok: boolean; enc: KeyEnc }> {
  const b = bridge();
  if (!b) {
    try {
      localStorage.setItem(LEGACY_KEY_STORAGE, key);
      return { ok: true, enc: 'plain' };
    } catch {
      return { ok: false, enc: 'none' };
    }
  }
  const res = await b.setApiKey(key, models);
  // Ghi được vào kho mã hoá thì không để lại bản chữ thường ở đâu nữa.
  if (res.ok) dropLegacy();
  return { ok: res.ok, enc: res.enc };
}

export async function clearKey(): Promise<void> {
  dropLegacy();
  await bridge()?.clearApiKey();
}
