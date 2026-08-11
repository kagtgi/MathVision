'use strict';

/**
 * Cầu nối giữa giao diện và tiến trình main: lưu file và cập nhật.
 *
 * Trong bản đóng gói KHÔNG dùng cơ chế tải của trình duyệt (blob + thẻ <a download>).
 * Lý do: muốn hỏi người dùng chọn thư mục thì phải mở hộp thoại, mà `will-download` bắt
 * buộc quyết đường dẫn ngay lập tức — mở hộp thoại modal ở đó làm treo tiến trình main,
 * download nằm lại dạng .tmp và người dùng không nhận được file nào.
 *
 * Đi qua IPC thì mọi thứ tường minh: hỏi chỗ lưu, ghi file, mở thư mục.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mathvision', {
  /**
   * @param {string} suggestedName tên gợi ý, ví dụ "de-thi.docx"
   * @param {Uint8Array} data nội dung file
   * @returns {Promise<{ ok: boolean, path?: string, error?: string, canceled?: boolean }>}
   */
  saveFile: (suggestedName, data) => ipcRenderer.invoke('mv:save-file', suggestedName, data),

  /**
   * Kho khoá. `enc` cho biết key đang được mã hoá hay còn dạng chữ thường — giao diện phải
   * NÓI THẬT chuyện đó chứ không giả vờ đã mã hoá.
   * @returns {Promise<{ok:boolean, key:string, enc:'safeStorage'|'plain'|'none',
   *   encryptionAvailable:boolean, models?:string[], path?:string}>}
   */
  getApiKey: () => ipcRenderer.invoke('mv:key-get'),
  /** @param {string} key @param {string[]=} models chuỗi model đã lọc, để khỏi dò lại mỗi lần mở */
  setApiKey: (key, models) => ipcRenderer.invoke('mv:key-set', key, models),
  clearApiKey: () => ipcRenderer.invoke('mv:key-clear'),

  /**
   * Lịch sử chuyển đổi. Main chỉ là kho blob: nó không parse `preview` hay `entry`, mọi hiểu
   * biết về lược đồ nằm ở renderer. Giao diện nhận ra bản đóng gói có hỗ trợ lịch sử hay
   * không bằng cách hỏi `typeof historySave === 'function'`, KHÔNG dò user-agent — nhờ vậy
   * bản đóng gói cũ (có cầu nối, chưa có mấy hàm này) không rơi vào nhánh sai.
   */
  historyIndex: () => ipcRenderer.invoke('mv:hist-index'),
  historySave: (payload) => ipcRenderer.invoke('mv:hist-save', payload),
  historyUpdate: (payload) => ipcRenderer.invoke('mv:hist-update', payload),
  historyLoad: (id) => ipcRenderer.invoke('mv:hist-load', id),
  historyThumbs: (ids) => ipcRenderer.invoke('mv:hist-thumbs', ids),
  historyDelete: (id) => ipcRenderer.invoke('mv:hist-delete', id),
  historyClear: () => ipcRenderer.invoke('mv:hist-clear'),
  historyStats: () => ipcRenderer.invoke('mv:hist-stats'),

  /** @returns {Promise<string>} phiên bản đang chạy, ví dụ "1.1.0" */
  getVersion: () => ipcRenderer.invoke('mv:get-version'),

  /** Trạng thái cập nhật hiện tại (giao diện gọi một lần lúc mở để bắt kịp). */
  getUpdateState: () => ipcRenderer.invoke('mv:update-state'),

  /** Kiểm ngay, không đợi lịch tự động. */
  checkUpdates: () => ipcRenderer.invoke('mv:check-updates'),

  /** Bản cài: thoát và cài bản mới. Bản portable: mở trang Release trong trình duyệt. */
  applyUpdate: () => ipcRenderer.invoke('mv:apply-update'),

  /**
   * Nghe trạng thái cập nhật do main đẩy sang. Trả về hàm huỷ đăng ký.
   * Bọc `ipcRenderer.on` chứ KHÔNG expose `ipcRenderer` ra ngoài.
   * @param {(state: unknown) => void} cb
   * @returns {() => void}
   */
  onUpdateState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('mv:update-state', handler);
    return () => ipcRenderer.removeListener('mv:update-state', handler);
  },
});
