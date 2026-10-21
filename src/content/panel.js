/* =============================================================
 * Quiz Lens — LỚP GIAO DIỆN PANEL
 * ------------------------------------------------------------
 * Thuộc tính: window.QH.panel
 *
 * Panel được mount trong Shadow DOM để cô lập CSS.
 * Cung cấp:
 *   create()      -> tạo host + shadow root
 *   render(data)  -> vẽ danh sách câu hỏi/đáp án
 *   setCollapsed() -> thu gọn / mở rộng
 *   setMode()     -> 'dock' | 'inline' | 'both'
 *   setTheme()    -> 'auto' | 'dark' | 'light'
 *   destroy()
 * ============================================================= */
(function (global) {
  'use strict';

  const QH = (global.QH = global.QH || {});

  const ICONS = {
    toggle: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    refresh: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13.5 1.5V5H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    options: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.2v1.6M8 13.2v1.6M14.8 8h-1.6M2.8 8H1.2M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1M12.8 12.8l-1.1-1.1M4.3 4.3L3.2 3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    select: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3h4M3 3v4M13 3h-4M13 3v4M3 13h4M3 13V9M13 13H9M13 13V9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    spark: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l1.6 4.2 4.4 1.5-4.4 1.6L8 13l-1.6-4.2L2 7.2l4.4-1.5L8 1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const Panel = {
    host: null,
    root: null,
    shadow: null,
    refs: {},
    collapsed: false,
    mode: 'dock',
    theme: 'auto',
    width: 340,
    _lastSignature: ''
  };

  /* ------------------------------------------------------------
   * Tạo cấu trúc DOM
   * ------------------------------------------------------------ */
  Panel.create = function (settings) {
    if (Panel.host) return Panel.host;

    const host = document.createElement('div');
    host.setAttribute('data-qh-generated', '1');
    host.id = 'qh-panel-host';
    host.style.cssText = 'all:initial;position:static;';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = QH.panelStyles.CSS;
    shadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'root';
    root.innerHTML = Panel.template();
    shadow.appendChild(root);

    Panel.host = host;
    Panel.shadow = shadow;
    Panel.root = root;

    Panel.refs = {
      dock: root.querySelector('.dock'),
      body: root.querySelector('.body'),
      brandCount: root.querySelector('.brand-count'),
      toggle: root.querySelector('.toggle'),
      refresh: root.querySelector('.js-refresh'),
      options: root.querySelector('.js-options'),
      close: root.querySelector('.js-close'),
      railBadge: root.querySelector('.rail-badge'),
      footerTime: root.querySelector('.footer-time'),
      manual: root.querySelector('.js-manual'),
      aiAll: root.querySelector('.js-ai-all')
    };

    Panel.bind();
    Panel.applySettings(settings);
    document.documentElement.appendChild(host);
    return host;
  };

  /* ------------------------------------------------------------
   * Template
   * ------------------------------------------------------------ */
  Panel.template = function () {
    return `
      <div class="dock" data-side="right" data-collapsed="false">
        <div class="collapsed-rail">
          <div class="rail-badge js-rail-badge">0</div>
          <div class="rail-label">Quiz Lens</div>
        </div>

        <div class="header">
          <div class="header-body" style="display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;">
            <div class="brand">
              <span class="brand-dot"></span>
              <span class="brand-text">Quiz Lens</span>
              <span class="brand-count js-brand-count">0 câu</span>
            </div>
          </div>
          <div class="actions">
            <button class="icon-btn js-refresh" title="Quét lại trang" aria-label="Quét lại trang">${ICONS.refresh}</button>
            <button class="icon-btn js-manual" title="Quét vùng đã chọn: bôi đen khối câu hỏi rồi bấm" aria-label="Quét vùng đã chọn">${ICONS.select}</button>
            <button class="icon-btn js-ai-all" title="Gợi ý AI cho tất cả câu" aria-label="Gợi ý AI cho tất cả câu" hidden>${ICONS.spark}</button>
            <button class="icon-btn js-options" title="Cài đặt" aria-label="Cài đặt">${ICONS.options}</button>
            <button class="icon-btn js-close" title="Ẩn panel" aria-label="Ẩn panel">${ICONS.close}</button>
            <button class="icon-btn toggle js-toggle" title="Thu gọn / Mở rộng" aria-label="Thu gọn hoặc mở rộng panel">${ICONS.toggle}</button>
          </div>
        </div>

        <div class="body"></div>

        <div class="footer">
          <span class="js-footer-text">Sẵn sàng</span>
          <span class="footer-time js-footer-time"></span>
        </div>
      </div>
    `;
  };

  /* ------------------------------------------------------------
   * Gắn sự kiện
   * ------------------------------------------------------------ */
  Panel.bind = function () {
    const { toggle, refresh, options, close } = Panel.refs;

    toggle.addEventListener('click', () => Panel.setCollapsed(!Panel.collapsed));
    close.addEventListener('click', () => QH.bus && QH.bus.emit('panel:hide'));
    refresh.addEventListener('click', () => QH.bus && QH.bus.emit('panel:refresh'));
    options.addEventListener('click', () => {
      if (global.chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        global.open('chrome://extensions/shortcuts');
      }
    });

    if (Panel.refs.manual) {
      Panel.refs.manual.addEventListener('click', () => QH.bus && QH.bus.emit('panel:manual'));
    }
    if (Panel.refs.aiAll) {
      Panel.refs.aiAll.addEventListener('click', () => QH.bus && QH.bus.emit('ai:askAll'));
    }

    // Phím tắt bên trong trang (Alt+Shift+Q) — chỉ khi focus nằm trong iframe nội dung
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'Q' || e.key === 'q')) {
        e.preventDefault();
        Panel.setCollapsed(!Panel.collapsed);
      }
    });
  };

  /* ------------------------------------------------------------
   * Áp dụng cài đặt
   * ------------------------------------------------------------ */
  Panel.applySettings = function (settings) {
    const s = Object.assign({}, QH.config.defaults, settings || {});
    Panel.mode = s.mode;
    Panel.theme = s.theme;
    Panel.width = s.width;
    Panel.setMode(s.mode);
    Panel.setTheme(s.theme);
    Panel.setWidth(s.width);
    Panel.setSide(s.side);
    Panel.setFeatureButtons(s);
  };

  Panel.setMode = function (mode) {
    Panel.mode = mode;
    if (!Panel.refs.dock) return;
    Panel.refs.dock.style.display = (mode === 'inline') ? 'none' : '';
  };

  /** Hiện/ẩn các nút theo cài đặt (AI, quét thủ công). */
  Panel.setFeatureButtons = function (settings) {
    const s = Object.assign({}, QH.config.defaults, settings || {});
    if (Panel.refs.aiAll) Panel.refs.aiAll.hidden = !s.aiEnabled;
    if (Panel.refs.manual) Panel.refs.manual.hidden = !s.manualScan;
  };

  /** Đánh dấu trạng thái đang bật của nút quét thủ công. */
  Panel.setManualActive = function (active) {
    if (!Panel.refs.manual) return;
    Panel.refs.manual.style.color = active ? 'var(--qh-accent)' : '';
    Panel.refs.manual.style.borderColor = active ? 'var(--qh-accent)' : 'transparent';
  };

  Panel.setTheme = function (theme) {
    Panel.theme = theme;
    if (!Panel.host) return;
    let resolved = theme;
    if (theme === 'auto') {
      resolved = global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    Panel.host.setAttribute('data-theme', resolved);
  };

  Panel.setWidth = function (width) {
    Panel.width = width;
    if (!Panel.refs.dock) return;
    Panel.refs.dock.style.setProperty('--qh-dock-w', width + 'px');
  };

  Panel.setSide = function (side) {
    if (!Panel.refs.dock) return;
    Panel.refs.dock.setAttribute('data-side', side === 'left' ? 'left' : 'right');
  };

  Panel.setCollapsed = function (collapsed) {
    Panel.collapsed = !!collapsed;
    if (!Panel.refs.dock) return;
    Panel.refs.dock.setAttribute('data-collapsed', Panel.collapsed ? 'true' : 'false');
  };

  /* ------------------------------------------------------------
   * Chế độ "đang gõ": người dùng đang nhập liệu vào một ô trên trang.
   *
   * Vấn đề thực tế: khi làm bài có phần điền từ (fill-in-the-blank),
   * ô nhập có thể nằm sát mép phải và bị panel che. Hoặc người dùng
   * lo panel sẽ "bắt" focus khi gõ.
   *
   * Cách xử lý:
   *   - Panel trở nên "trong suốt" cho chuột (pointer-events: none)
   *     -> click xuyên qua được, không bao giờ chặn thao tác.
   *   - Panel tự thu gọn nếu nó đang mở, nhớ trạng thái để khôi phục.
   * ------------------------------------------------------------ */
  Panel.setTypingMode = function (active) {
    if (!Panel.refs.dock) return;
    Panel.typing = !!active;
    Panel.refs.dock.setAttribute('data-typing', Panel.typing ? 'true' : 'false');

    if (Panel.typing) {
      Panel.typingRestore = !Panel.collapsed;
      if (!Panel.collapsed) Panel.setCollapsed(true);
    } else if (Panel.typingRestore) {
      Panel.setCollapsed(false);
      Panel.typingRestore = false;
    }
  };

  /* ------------------------------------------------------------
   * Render dữ liệu
   * ------------------------------------------------------------ */
  Panel.render = function (data, settings) {
    if (!Panel.root) return;
    const s = Object.assign({}, QH.config.defaults, settings || {});
    const questions = (data && data.questions) || [];

    const body = Panel.refs.body;
    const countText = questions.length === 1 ? '1 câu' : questions.length + ' câu';

    if (Panel.refs.brandCount) Panel.refs.brandCount.textContent = countText;
    if (Panel.refs.railBadge) Panel.refs.railBadge.textContent = String(questions.length);

    if (!questions.length) {
      body.innerHTML = `
        <div class="empty">
          <strong>Chưa phát hiện câu hỏi nào</strong>
          Trang này có thể chưa tải xong, hoặc dùng cấu trúc đáp án lạ.
          <div style="margin-top:10px;">Bấm <kbd>↻</kbd> để quét lại, hoặc mở <kbd>Cài đặt</kbd> để thêm selector riêng.</div>
          ${s.aiEnabled ? '<div style="margin-top:8px;">Bật <strong>Quét vùng đã chọn</strong> rồi bôi đen khối câu hỏi.</div>' : ''}
        </div>`;
      Panel.setFooter('Không tìm thấy câu hỏi');
      return;
    }

    const aiOn = !!s.aiEnabled;

    const html = questions.map((q, idx) => {
      const opts = q.options.map((o) => {
        const key = s.showKeyBadge !== false
          ? `<span class="opt-key">${esc(o.key)}</span>`
          : '';
        const mark = o.selected ? `<span class="opt-mark">✓ đã chọn</span>` : '';
        const reveal = o.revealed ? `<span class="opt-reveal">★ đáp án đúng</span>` : '';
        const pick = o.element
          ? `<button class="opt-pick js-pick" data-qid="${esc(q.id)}" data-key="${esc(o.key)}" title="Chọn đáp án này trong trang">chọn</button>`
          : '';
        return `<li class="opt" data-selected="${o.selected ? 'true' : 'false'}" data-revealed="${o.revealed ? 'true' : 'false'}" data-key="${esc(o.key)}">${key}<span class="opt-text">${esc(o.text)}</span>${mark}${reveal}${pick}</li>`;
      }).join('');

      const aiBlock = aiOn ? `
        <div class="ai-row" data-ai-for="${esc(q.id)}">
          <button class="ai-btn primary js-ai-ask" data-qid="${esc(q.id)}">Gợi ý AI</button>
          <span class="ai-answer js-ai-slot" data-qid="${esc(q.id)}"></span>
        </div>` : '';

      return `
        <div class="q" data-qid="${esc(q.id)}">
          <div class="q-head">
            <span class="q-badge">Câu ${idx + 1}</span>
            <span class="q-src">${esc(sourceLabel(q.source))}</span>
          </div>
          <div class="q-text">${esc(q.question)}</div>
          <ul class="opts">${opts}</ul>
          ${aiBlock}
        </div>`;
    }).join('');

    body.innerHTML = html;
    Panel.bindBody();
    Panel.setFooter('Cập nhật lúc ' + new Date().toLocaleTimeString());
  };

  /* ------------------------------------------------------------
   * Gắn sự kiện cho các nút trong body (AI, chọn nhanh)
   * ------------------------------------------------------------ */
  Panel.bindBody = function () {
    const body = Panel.refs.body;
    if (!body) return;

    body.querySelectorAll('.js-ai-ask').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        QH.bus && QH.bus.emit('ai:ask', { qid: btn.getAttribute('data-qid') });
      });
    });

    body.querySelectorAll('.js-pick').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        QH.bus && QH.bus.emit('ui:pick', {
          qid: btn.getAttribute('data-qid'),
          key: btn.getAttribute('data-key')
        });
      });
    });
  };

  /* ------------------------------------------------------------
   * Hiển thị kết quả AI cho một câu
   * ------------------------------------------------------------ */
  Panel.showAI = function (qid, payload) {
    const slot = Panel.root && Panel.root.querySelector(`.js-ai-slot[data-qid="${qid}"]`);
    if (!slot) return;
    const btn = Panel.root.querySelector(`.js-ai-ask[data-qid="${qid}"]`);

    if (payload && payload.loading) {
      if (btn) { btn.disabled = true; btn.textContent = 'Đang suy nghĩ…'; }
      slot.innerHTML = '<span class="ai-spin"></span>';
      return;
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Gợi ý AI'; }

    if (!payload) { slot.innerHTML = ''; return; }

    if (payload.error) {
      slot.innerHTML = `<span class="ai-error">${esc(payload.error)}</span>`;
      return;
    }

    const conf = typeof payload.confidence === 'number' ? payload.confidence : 0;
    const level = conf >= 0.75 ? 'high' : (conf >= 0.45 ? 'mid' : 'low');
    const pct = Math.round(conf * 100);

    slot.innerHTML =
      `<span class="ai-badge" data-conf="${level}" title="Độ tin cậy ${pct}%">${esc(payload.answer)}</span>` +
      (payload.reason ? `<span class="ai-reason">${esc(payload.reason)}</span>` : '');
  };

  function sourceLabel(src) {
    if (src === 'input') return 'theo input';
    if (src === 'aria') return 'theo ARIA';
    if (src === 'keyed-text') return 'theo A./B./C.';
    if (src === 'plain-text') return 'theo văn bản';
    return src || '';
  }

  Panel.setFooter = function (text) {
    const el = Panel.root && Panel.root.querySelector('.js-footer-text');
    if (el) el.textContent = text;
    const t = Panel.refs && Panel.refs.footerTime;
    if (t) t.textContent = new Date().toLocaleTimeString();
  };

  /* ------------------------------------------------------------
   * Đẩy nội dung trang sang bên để không che vùng đọc
   * ------------------------------------------------------------ */
  Panel.setPushContent = function (enabled, side, width) {
    const doc = document.documentElement;
    const s = side === 'left' ? 'left' : 'right';
    if (!enabled) {
      doc.style.setProperty('--qh-push-' + s, '0px');
      doc.style.removeProperty('margin-' + s);
      return;
    }
    doc.style.setProperty('--qh-push-' + s, width + 'px');
    doc.style.setProperty('margin-' + s, width + 'px');
  };

  Panel.destroy = function () {
    if (Panel.host && Panel.host.parentElement) {
      Panel.host.parentElement.removeChild(Panel.host);
    }
    Panel.host = null;
    Panel.shadow = null;
    Panel.root = null;
    Panel.refs = {};
  };

  QH.panel = Panel;
})(typeof window !== 'undefined' ? window : globalThis);
