/* =============================================================
 * Quiz Lens — ĐIỀU PHỐI (CONTENT SCRIPT CHÍNH)
 * ------------------------------------------------------------
 * Trách nhiệm:
 *   1. Nạp & theo dõi cài đặt từ chrome.storage
 *   2. Quét DOM, đẩy kết quả sang detector -> panel
 *   3. Tự cập nhật khi trang thay đổi (MutationObserver, lazy-load)
 *   4. Phản hồi lệnh từ service worker (toggle, refresh, cài đặt)
 *   5. Đồng bộ theo tab đang hoạt động
 * ============================================================= */
(function (global) {
  'use strict';

  const QH = (global.QH = global.QH || {});

  const state = {
    settings: Object.assign({}, QH.config.defaults),
    lastData: null,
    scanTimer: null,
    observer: null,
    hidden: false,
    initialized: false
  };

  /* ============================================================
   * TIỆN ÍCH
   * ============================================================ */

  function isBlockedHost(hostname, blocked) {
    if (!blocked || !blocked.length) return false;
    const h = String(hostname || '').toLowerCase();
    return blocked.some((entry) => {
      const e = String(entry || '').trim().toLowerCase();
      if (!e) return false;
      if (e.startsWith('*.')) {
        const bare = e.slice(2);
        return h === bare || h.endsWith('.' + bare);
      }
      return h === e || h.endsWith('.' + e);
    });
  }

  /** Chữ ký dữ liệu để tránh render lại vô ích. */
  function signature(data) {
    if (!data || !data.questions) return '';
    return data.questions.map((q) => q.question + '|' + q.options.map((o) => o.key + ':' + o.text + (o.selected ? '*' : '')).join(',')).join('#');
  }

  /* ============================================================
   * NẠP CÀI ĐẶT
   * ============================================================ */

  function loadSettings() {
    return new Promise((resolve) => {
      if (!global.chrome || !chrome.storage || !chrome.storage.sync) {
        resolve(Object.assign({}, QH.config.defaults));
        return;
      }
      chrome.storage.sync.get(QH.config.storageKey, (res) => {
        const saved = (res && res[QH.config.storageKey]) || {};
        state.settings = Object.assign({}, QH.config.defaults, saved);
        resolve(state.settings);
      });
    });
  }

  function saveSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch);
    if (global.chrome && chrome.storage && chrome.storage.sync) {
      const payload = {};
      payload[QH.config.storageKey] = state.settings;
      chrome.storage.sync.set(payload);
    }
  }

  /* ============================================================
   * AI — GỢI Ý ĐÁP ÁN
   * ============================================================ */

  const aiState = {
    pending: new Set(),
    results: {},      // qid -> { answer, confidence, reason }
    queue: [],
    running: 0
  };

  function askAI(qid) {
    if (!state.settings.aiEnabled) {
      QH.panel.showAI(qid, { error: 'AI chưa được bật trong Cài đặt' });
      return;
    }
    const data = state.lastData;
    if (!data) return;
    const q = data.questions.find((x) => x.id === qid);
    if (!q) return;

    if (aiState.pending.has(qid)) return;
    aiState.pending.add(qid);
    QH.panel.showAI(qid, { loading: true });

    aiState.queue.push({ qid, question: q.question, options: q.options.map((o) => ({ key: o.key, text: o.text })) });
    pumpAIQueue();
  }

  function pumpAIQueue() {
    const limit = Math.max(1, state.settings.aiConcurrency || 2);
    while (aiState.running < limit && aiState.queue.length) {
      const job = aiState.queue.shift();
      aiState.running++;
      QH.ai.suggest(job.question, job.options, {
        model: state.settings.aiModel,
        fallbackModels: state.settings.aiFallbackModels
      })
        .then((res) => {
          aiState.results[job.qid] = res;
          QH.panel.showAI(job.qid, res);
        })
        .catch((err) => {
          QH.panel.showAI(job.qid, { error: err.message || 'Lỗi khi gọi AI' });
        })
        .then(() => {
          aiState.running--;
          aiState.pending.delete(job.qid);
          pumpAIQueue();
        });
    }
  }

  function askAIForAll() {
    if (!state.settings.aiEnabled || !state.lastData) return;
    state.lastData.questions.forEach((q) => askAI(q.id));
  }

  /* ============================================================
   * IFRAME — ĐIỀU PHỐI GIỮA CÁC FRAME
   * ------------------------------------------------------------
   * Nhiều trang đặt câu hỏi trong iframe (khung nhúng, trình xem đề).
   * Chỉ frame chính (top) được vẽ panel; frame con gửi kết quả quét
   * lên frame chính qua postMessage.
   * ============================================================ */

  const FRAME_FLAG = '__qh_frame_msg__';

  function isTopFrame() {
    try { return global.top === global.self; } catch (e) { return true; }
  }

  /** Frame con: gửi câu hỏi tìm được lên frame chính. */
  function reportToTop(data) {
    if (!data || !data.questions || !data.questions.length) return;
    try {
      const payload = {
        [FRAME_FLAG]: true,
        questions: data.questions.map((q) => ({
          id: q.id,
          question: q.question,
          source: q.source,
          confidence: q.confidence,
          options: q.options.map((o) => ({
            key: o.key, text: o.text, selected: o.selected, revealed: o.revealed
          }))
        }))
      };
      global.top.postMessage(payload, '*');
    } catch (e) { /* cross-origin -> bỏ qua */ }
  }

  /** Frame chính: nhận câu hỏi từ frame con và gộp vào danh sách. */
  function listenFromFrames() {
    global.addEventListener('message', (e) => {
      if (!e.data || !e.data[FRAME_FLAG]) return;
      if (e.source === global) return;

      const incoming = e.data.questions || [];
      if (!incoming.length) return;

      const base = state.lastData ? state.lastData.questions : [];
      const sig = (q) => (q.question || '').toLowerCase().slice(0, 120);
      const merged = base.slice();

      incoming.forEach((q) => {
        if (!merged.some((x) => sig(x) === sig(q))) {
          // Bổ sung field `element` = null vì không thể truyền qua postMessage
          merged.push(Object.assign({}, q, {
            options: (q.options || []).map((o) => Object.assign({}, o, { element: null }))
          }));
        }
      });

      merged.forEach((q, i) => { q.id = 'q' + (i + 1); });
      state.lastData = { questions: merged };

      QH.panel.render(state.lastData, state.settings);
      if (state.settings.mode === 'inline' || state.settings.mode === 'both') {
        QH.inline.render(state.lastData.questions, state.settings);
      }
    });
  }

  /* ============================================================
   * QUÉT & HIỂN THỊ
   * ============================================================ */

  function scan(options) {
    const force = options && options.force;

    if (isBlockedHost(location.hostname, state.settings.blockedHosts)) {
      teardown();
      return;
    }

    let data;
    try {
      data = QH.detector.detect(document.body, state.settings);
    } catch (err) {
      console.warn('[Quiz Lens] Lỗi khi phát hiện:', err);
      return;
    }

    // Gắn element đáp án đầu tiên làm neo cho chế độ inline
    data.questions.forEach((q) => {
      const withEl = q.options.filter((o) => o.element);
      if (withEl.length) q.anchorElement = withEl[withEl.length - 1].element;
    });

    const sig = signature(data);
    const changed = sig !== signature(state.lastData);

    state.lastData = data;

    if (changed || force) {
      // Frame con: gửi kết quả lên frame chính, không tự vẽ panel
      if (!isTopFrame()) {
        reportToTop(data);
        return;
      }

      QH.panel.render(data, state.settings);

      const mode = state.settings.mode;
      if (mode === 'inline' || mode === 'both') {
        QH.inline.render(data.questions, state.settings);
      } else {
        QH.inline.clear();
      }

      // Tự thu gọn khi không có câu hỏi nào
      if (state.settings.autoCollapse) {
        if (data.questions.length === 0) {
          QH.panel.setCollapsed(true);
        } else if (QH.panel.collapsed && state.lastData && state.lastData.questions.length === 0) {
          QH.panel.setCollapsed(false);
        }
      }

      // Tự động gợi ý AI nếu bật
      if (state.settings.aiEnabled && state.settings.aiAuto && changed) {
        askAIForAll();
      }
    }
  }

  /** Lên lịch quét (debounce) để gom nhiều thay đổi DOM thành một lần. */
  function scheduleScan(delay) {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(() => scan({ force: false }), delay || 350);
  }

  /* ============================================================
   * QUAN SÁT DOM (SPA / lazy-load)
   * ============================================================ */

  function startObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver((mutations) => {
      // Bỏ qua thay đổi do chính extension tạo ra
      let relevant = false;
      for (const m of mutations) {
        // Thay đổi thuộc tính (ví dụ người dùng tick radio) -> cần cập nhật
        if (m.type === 'attributes') { relevant = true; continue; }

        if (!m.addedNodes.length && !m.removedNodes.length) continue;
        let own = false;
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1 && (n.id === 'qh-panel-host' || n.hasAttribute && n.hasAttribute('data-qh-inline-card') || (n.classList && n.classList.contains('qh-inline-card')))) own = true;
        });
        m.removedNodes.forEach((n) => {
          if (n.nodeType === 1 && (n.id === 'qh-panel-host' || n.getAttribute && n.getAttribute('data-qh-inline-card'))) own = true;
        });
        if (!own) relevant = true;
      }
      if (relevant) scheduleScan(400);
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      // Theo dõi trạng thái chọn của đáp án: checked / aria-checked / aria-selected
      attributes: true,
      attributeFilter: ['checked', 'aria-checked', 'aria-selected']
    });
  }

  function stopObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  /* ============================================================
   * QUÉT THỦ CÔNG THEO VÙNG NGƯỜI DÙNG CHỌN
   * ------------------------------------------------------------
   * Khi trang không dùng radio/checkbox (ví dụ đề trắc nghiệm render
   * bằng div, hoặc câu hỏi nằm trong khối do JS tạo), người dùng có thể
   * bôi đen vùng cần phân tích rồi bấm "Quét vùng đã chọn".
   * ============================================================ */

  const manualState = { active: false, selection: '' };

  function toggleManualScan() {
    if (!state.settings.manualScan) {
      QH.panel.setFooter('Tính năng quét thủ công đang tắt');
      return;
    }
    manualState.active = !manualState.active;
    if (manualState.active) {
      QH.panel.setFooter('Bôi đen vùng câu hỏi rồi bấm lại nút quét');
      document.body.style.cursor = 'crosshair';
    } else {
      document.body.style.cursor = '';
      QH.panel.setFooter('Đã tắt chế độ quét thủ công');
    }
    QH.bus && QH.bus.emit('panel:manualState', manualState.active);
  }

  function captureSelection() {
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);

    // Tìm phần tử cha chung nhất của vùng chọn
    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    if (!node) return null;

    // Ưu tiên phần tử cha gần nhất chứa đủ câu hỏi + đáp án
    let el = node;
    for (let i = 0; i < 6 && el && el.parentElement; i++) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text.length > 12) break;
      el = el.parentElement;
    }
    return el || node;
  }

  function runManualScan() {
    const el = captureSelection();
    if (!el) {
      QH.panel.setFooter('Hãy bôi đen trước khối câu hỏi rồi quét lại');
      return;
    }

    const found = QH.detector.detectIn(el, state.settings);
    if (!found.length) {
      QH.panel.setFooter('Không tìm thấy đáp án trong vùng đã chọn');
      return;
    }

    // Gộp với kết quả hiện có, loại trùng
    const existing = state.lastData ? state.lastData.questions : [];
    const sig = (q) => (q.question || '').toLowerCase().slice(0, 120);
    const merged = existing.slice();
    found.forEach((q) => {
      if (!merged.some((e) => sig(e) === sig(q))) merged.push(q);
    });

    merged.forEach((q, i) => { q.id = 'q' + (i + 1); });
    state.lastData = { questions: merged };

    QH.panel.render(state.lastData, state.settings);
    if (state.settings.mode === 'inline' || state.settings.mode === 'both') {
      QH.inline.render(state.lastData.questions, state.settings);
    }
    QH.panel.setFooter('Đã thêm ' + found.length + ' câu từ vùng đã chọn');
  }

  /* ============================================================
   * VÒNG ĐỜI
   * ============================================================ */

  function teardown() {
    stopObserver();
    QH.panel.destroy();
    QH.inline.clear();
    state.initialized = false;
  }

  function setup() {
    if (state.initialized) return;
    state.initialized = true;

    // Chỉ frame chính mới vẽ panel; frame con chỉ quét rồi gửi lên
    const top = isTopFrame();

    if (top) {
      QH.panel.create(state.settings);
      QH.panel.applySettings(state.settings);
      QH.panel.setPushContent(state.settings.pushContent, state.settings.side, state.settings.width);
      listenFromFrames();
    }

    scan({ force: true });
    startObserver();

    /* ------------------------------------------------------------
     * Người dùng tick radio/checkbox -> thuộc tính `checked` (IDL property)
     * đổi nhưng content attribute KHÔNG đổi, nên MutationObserver không
     * bắt được. Bắt sự kiện `change` để cập nhật trạng thái đã chọn.
     * ------------------------------------------------------------ */
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('input[type="radio"], input[type="checkbox"]')) {
        scheduleScan(120);
      }
    }, true);

    /* ------------------------------------------------------------
     * CHẾ ĐỘ "ĐANG GÕ"
     *
     * Khi người dùng đang nhập liệu vào một ô (input/textarea/contenteditable)
     * trên trang, panel sẽ:
     *   - trở nên trong suốt và không bắt chuột (pointer-events: none)
     *     -> không bao giờ chặn thao tác gõ hay click nhầm
     *   - tự thu gọn để không che ô đang nhập
     *   - tự khôi phục khi ngừng gõ
     *
     * Điều này giải quyết trực tiếp vấn đề: làm quiz tiếng Anh có phần
     * điền từ, panel bị đè lên ô nhập hoặc "bắt" focus.
     * ------------------------------------------------------------ */
    const TEXT_INPUT = 'input:not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]):not([type="file"]), textarea, [contenteditable=""], [contenteditable="true"]';

    let typingTimer = null;
    const setTyping = (on) => {
      if (!state.settings.autoCollapseOnFocus) return;
      QH.panel.setTypingMode(on);
    };

    document.addEventListener('focusin', (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches(TEXT_INPUT)) {
        setTyping(true);
        clearTimeout(typingTimer);
      }
    }, true);

    document.addEventListener('focusout', (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (!t.matches(TEXT_INPUT)) return;
      clearTimeout(typingTimer);
      // Chỉ tắt chế độ gõ khi thực sự rời khỏi ô nhập
      typingTimer = setTimeout(() => {
        const active = document.activeElement;
        const stillTyping = active && active.matches && active.matches(TEXT_INPUT);
        setTyping(!!stillTyping);
      }, 220);
    }, true);

    // Người dùng đang gõ -> trạng thái đáp án có thể đổi, quét lại sau khi dừng
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches(TEXT_INPUT)) {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => scheduleScan(600), 600);
      }
    }, true);

    // Quét lại khi cửa sổ đổi kích thước (layout đáp án thường đổi theo breakpoint)
    let resizeTimer = null;
    global.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => scan({ force: false }), 400);
    });

    // Quét lại khi tab quay lại hoạt động (lazy-load theo tab)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleScan(150);
    });
  }

  function applySettings(newSettings) {
    const prev = state.settings;
    state.settings = Object.assign({}, QH.config.defaults, newSettings || {});

    if (!state.settings.enabled) {
      teardown();
      return;
    }

    setup();

    // Frame con không có panel -> chỉ quét và gửi lên frame chính
    if (isTopFrame()) {
      QH.panel.applySettings(state.settings);
      QH.panel.setPushContent(state.settings.pushContent, state.settings.side, state.settings.width);
    }

    if (prev.mode !== state.settings.mode) {
      QH.inline.clear();
    }
    scan({ force: true });
  }

  /* ============================================================
   * MESSAGE PASSING VỚI SERVICE WORKER
   * ============================================================ */

  if (global.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'qh:init':
          loadSettings().then((s) => {
            applySettings(s);
            sendResponse({ ok: true, count: state.lastData ? state.lastData.questions.length : 0 });
          });
          return true;

        case 'qh:toggle':
          if (state.settings.enabled) {
            saveSettings({ enabled: false });
            applySettings({ enabled: false });
          } else {
            saveSettings({ enabled: true });
            applySettings({ enabled: true });
          }
          sendResponse({ ok: true, enabled: state.settings.enabled });
          return true;

        case 'qh:refresh':
          scan({ force: true });
          sendResponse({ ok: true });
          return true;

        case 'qh:get-state':
          sendResponse({
            ok: true,
            enabled: state.settings.enabled,
            count: state.lastData ? state.lastData.questions.length : 0,
            settings: state.settings
          });
          return true;

        case 'qh:settings-changed':
          loadSettings().then((s) => {
            applySettings(s);
            sendResponse({ ok: true });
          });
          return true;
      }
    });
  }

  /* ============================================================
   * ĐỒNG BỘ THEO TAB ĐANG HOẠT ĐỘNG
   * ============================================================ */

  if (global.chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const change = changes[QH.config.storageKey];
      if (!change) return;
      applySettings(Object.assign({}, state.settings, change.newValue));
    });
  }

  /* ============================================================
   * KHỞI ĐỘNG
   * ============================================================ */

  function boot() {
    loadSettings().then((s) => {
      if (isBlockedHost(location.hostname, s.blockedHosts)) return;
      if (!s.enabled) return;
      applySettings(s);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Cung cấp bus nhẹ cho panel
  QH.bus = {
    handlers: {},
    on(evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); },
    emit(evt, payload) {
      (this.handlers[evt] || []).forEach((fn) => {
        try { fn(payload); } catch (e) { console.warn(e); }
      });
    }
  };

  /* ------------------------------------------------------------
   * Nối các sự kiện từ panel
   * ------------------------------------------------------------ */
  QH.bus.on('panel:refresh', () => scan({ force: true }));
  QH.bus.on('panel:hide', () => {
    QH.panel.setTypingMode(false);
    QH.panel.setCollapsed(true);
  });
  QH.bus.on('panel:manual', () => {
    if (manualState.active) {
      runManualScan();
      manualState.active = false;
      document.body.style.cursor = '';
      QH.panel.setManualActive(false);
    } else {
      toggleManualScan();
      QH.panel.setManualActive(true);
    }
  });
  QH.bus.on('ai:ask', (payload) => {
    if (payload && payload.qid) askAI(payload.qid);
  });
  QH.bus.on('ai:askAll', () => askAIForAll());

  /* Chọn nhanh đáp án trong panel -> click vào đáp án tương ứng trên trang */
  QH.bus.on('ui:pick', (payload) => {
    if (!payload) return;
    const data = state.lastData;
    if (!data) return;
    const q = data.questions.find((x) => x.id === payload.qid);
    if (!q) return;
    const opt = q.options.find((o) => o.key === payload.key);
    if (!opt || !opt.element) return;

    // Tìm phần tử input/radio tương ứng để click
    const el = opt.element;
    const input = el.matches && el.matches('input') ? el : el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]');
    const target = input || el;
    try {
      target.click();
      scheduleScan(150);
      QH.panel.setFooter('Đã chọn ' + payload.key + ' — nhớ kiểm tra lại trước khi nộp bài');
    } catch (e) {
      QH.panel.setFooter('Không click được đáp án này');
    }
  });

  QH.app = {
    scan,
    scheduleScan,
    askAI,
    askAIForAll,
    runManualScan,
    getState: () => state
  };
})(typeof window !== 'undefined' ? window : globalThis);
