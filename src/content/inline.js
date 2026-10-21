/* =============================================================
 * Quiz Lens — LỚP CHÈN INLINE
 * ------------------------------------------------------------
 * Thuộc tính: window.QH.inline
 *
 * Chèn bảng đáp án ngay cạnh / dưới khối câu hỏi trong LIGHT DOM
 * (dùng chung style với trang web, do file inline.css phục vụ).
 *
 * Vì sao không dùng Shadow DOM ở đây?
 *  - Card inline cần nằm đúng vị trí trong luồng nội dung của trang,
 *    nên nó phải là node thật của light DOM.
 *  - Shadow DOM chỉ dùng cho panel cố định (dock) để cô lập CSS.
 * ============================================================= */
(function (global) {
  'use strict';

  const QH = (global.QH = global.QH || {});

  const MARK_ATTR = 'data-qh-inline-card';
  const ANCHOR_FLAG = 'data-qh-anchor-used';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Nhận diện nền thực tế của trang để card inline có tương phản phù hợp.
   *
   * Không nên dựa vào prefers-color-scheme: trang web có thể dùng nền tối
   * trong khi hệ điều hành đang ở chế độ sáng (hoặc ngược lại).
   * Ta đọc màu nền thực tế của <body>/<html> rồi quyết định.
   */
  function detectPageTheme() {
    const els = [document.body, document.documentElement];
    for (const el of els) {
      if (!el) continue;
      const bg = global.getComputedStyle(el).backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;

      const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(bg);
      if (!m) continue;
      const [r, g, b] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
      // Công thức độ sáng tương đối (perceptual luminance)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance > 0.55 ? 'light' : 'dark';
    }
    // Không xác định được -> theo cài đặt hệ điều hành
    return global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  const Inline = {
    enabled: false,

    /**
     * Xoá toàn bộ card inline đã chèn trước đó.
     * Đồng thời gỡ cờ "đã dùng làm neo" để lần render sau có thể chèn lại.
     */
    clear: function () {
      document.querySelectorAll('[' + MARK_ATTR + ']').forEach((n) => n.remove());
      document.querySelectorAll('[' + ANCHOR_FLAG + ']').forEach((n) => n.removeAttribute(ANCHOR_FLAG));
    },

    /**
     * Chèn card đáp án cho từng câu hỏi.
     * @param {Array} questions  kết quả từ detector.detect()
     * @param {Object} settings
     */
    render: function (questions, settings) {
      Inline.clear();
      const s = Object.assign({}, QH.config.defaults, settings || {});
      if (!questions || !questions.length) return 0;

      let inserted = 0;

      questions.forEach((q, idx) => {
        const anchor = resolveAnchor(q);
        if (!anchor || !anchor.parentElement) return;

        // Tránh chèn trùng nếu anchor đã bị xử lý
        if (anchor.getAttribute('data-qh-anchor-used') === 'yes') return;
        anchor.setAttribute('data-qh-anchor-used', 'yes');

        const card = document.createElement('div');
        card.setAttribute(MARK_ATTR, '1');
        card.className = 'qh-inline-card';

        const opts = q.options.map((o) => {
          const sel = o.selected ? 'true' : 'false';
          return '<li class="qh-inline-opt" data-selected="' + sel + '">' +
            '<span class="qh-inline-key">' + esc(o.key) + '</span>' +
            '<span class="qh-inline-text">' + esc(o.text) + '</span>' +
            (o.selected ? '<span class="qh-inline-mark">✓</span>' : '') +
            '</li>';
        }).join('');

        card.innerHTML =
          '<div class="qh-inline-head">' +
            '<span class="qh-inline-title">Quiz Lens — Đáp án câu ' + (idx + 1) + '</span>' +
            '<span class="qh-inline-count">' + q.options.length + ' lựa chọn</span>' +
          '</div>' +
          '<div class="qh-inline-q">' + esc(q.question) + '</div>' +
          '<ul class="qh-inline-opts">' + opts + '</ul>';

        anchor.insertAdjacentElement('afterend', card);
        inserted++;
      });

      return inserted;
    }
  };

  /**
   * Xác định node đích để chèn card.
   * Ưu tiên: container của câu hỏi → phần tử đáp án cuối cùng → phần tử cha.
   */
  function resolveAnchor(q) {
    if (q.anchorElement) return q.anchorElement;

    const withEl = q.options.filter((o) => o.element);
    if (!withEl.length) return null;

    // Lấy phần tử đáp án cuối cùng → chèn sau nó sẽ đặt card dưới cả nhóm
    const last = withEl[withEl.length - 1].element;
    return last;
  }

  QH.inline = Inline;
})(typeof window !== 'undefined' ? window : globalThis);
