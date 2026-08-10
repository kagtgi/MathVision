'use strict';

/**
 * Cầu nối duy nhất giữa giao diện và tiến trình main: lưu file.
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
});
