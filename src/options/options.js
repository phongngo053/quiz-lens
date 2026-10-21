/* =============================================================
 * Quiz Lens — Script trang cài đặt
 * ------------------------------------------------------------
 * Đọc/ghi chrome.storage.sync và đồng bộ ngay với các tab đang mở.
 * ============================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'qh.settings';

  const DEFAULTS = {
    enabled: true,
    mode: 'dock',
    side: 'right',
    theme: 'auto',
    width: 340,
    pushContent: true,
    autoCollapse: true,
    showKeyBadge: true,
    stripKeyPrefix: true,
    includeHidden: false,
    minOptions: 2,
    maxQuestions: 300,
    maxOptionLength: 600,
    maxQuestionLength: 1200,
    enableTextFallback: true,
    detectRevealed: true,
    blockedHosts: [],
    customProfiles: [],
    aiEnabled: false,
    aiBaseUrl: '',
    aiModel: '',
    aiAuto: false,
    aiConcurrency: 2,
    deepSearch: true,
    autoCollapseOnFocus: true,
    manualScan: true
  };

  const FIELDS = {
    enabled: 'checkbox',
    mode: 'select',
    side: 'select',
    theme: 'select',
    width: 'range',
    pushContent: 'checkbox',
    autoCollapse: 'checkbox',
    showKeyBadge: 'checkbox',
    stripKeyPrefix: 'checkbox',
    includeHidden: 'checkbox',
    enableTextFallback: 'checkbox',
    detectRevealed: 'checkbox',
    minOptions: 'number',
    aiEnabled: 'checkbox',
    aiBaseUrl: 'text',
    aiModel: 'select',
    aiAuto: 'checkbox',
    deepSearch: 'checkbox',
    autoCollapseOnFocus: 'checkbox',
    manualScan: 'checkbox'
  };

  const el = (id) => document.getElementById(id);
  const saveState = el('saveState');

  /* ---------- Load ---------- */
  chrome.storage.sync.get(STORAGE_KEY, (res) => {
    const s = Object.assign({}, DEFAULTS, (res && res[STORAGE_KEY]) || {});
    applyToForm(s);
  });

  function applyToForm(s) {
    Object.keys(FIELDS).forEach((key) => {
      const input = el(key);
      if (!input) return;
      if (FIELDS[key] === 'checkbox') input.checked = !!s[key];
      else if (FIELDS[key] === 'select' && key === 'aiModel') return; // xử lý riêng
      else input.value = s[key];
    });
    el('blockedHosts').value = (s.blockedHosts || []).join('\n');
    el('aiFallbackModels').value = (s.aiFallbackModels || DEFAULTS.aiFallbackModels || []).join('\n');
    updateWidthLabel();
    setModelValue(s.aiModel || '');
  }

  function readForm() {
    const s = Object.assign({}, DEFAULTS);
    Object.keys(FIELDS).forEach((key) => {
      const input = el(key);
      if (!input) return;
      if (FIELDS[key] === 'checkbox') s[key] = input.checked;
      else if (FIELDS[key] === 'number') s[key] = parseInt(input.value, 10) || DEFAULTS[key];
      else if (FIELDS[key] === 'range') s[key] = parseInt(input.value, 10) || DEFAULTS[key];
      else if (key === 'aiModel') s[key] = input.value;
      else s[key] = input.value;
    });
    s.blockedHosts = el('blockedHosts').value
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    s.aiFallbackModels = el('aiFallbackModels').value
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    // KHÔNG đưa khoá API vào s (cài đặt đồng bộ) -> lưu riêng ở storage.local
    delete s.aiApiKey;
    return s;
  }

  /* ---------- Save ---------- */
  function save() {
    const s = readForm();
    chrome.storage.sync.set({ [STORAGE_KEY]: s }, () => {
      showSaved('Đã lưu');
    });
  }

  function showSaved(text) {
    saveState.textContent = text + ' ✓';
    saveState.classList.add('show');
    clearTimeout(showSaved._t);
    showSaved._t = setTimeout(() => saveState.classList.remove('show'), 2200);
  }

  el('save').addEventListener('click', save);

  el('reset').addEventListener('click', () => {
    applyToForm(DEFAULTS);
    chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULTS }, () => showSaved('Đã khôi phục mặc định'));
  });

  /* ---------- Slider label ---------- */
  function updateWidthLabel() {
    el('widthValue').textContent = el('width').value;
  }
  el('width').addEventListener('input', updateWidthLabel);

  /* ============================================================
   * PHẦN AI — KHOÁ API & DANH SÁCH MODEL
   * ============================================================ */

  const SECRET_KEY = 'qh.aiApiKey';
  let modelList = [];

  /* --- Hiện / ẩn khoá --- */
  el('toggleKey').addEventListener('click', () => {
    const input = el('aiApiKey');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    el('toggleKey').textContent = showing ? 'Hiện' : 'Ẩn';
  });

  /* --- Lưu khoá riêng vào storage.local --- */
  function saveKey() {
    const key = el('aiApiKey').value.trim();
    chrome.storage.local.set({ [SECRET_KEY]: key });
    if (key) showSaved('Đã lưu khoá (cục bộ)');
    return key;
  }

  el('aiApiKey').addEventListener('change', saveKey);
  el('aiApiKey').addEventListener('blur', saveKey);

  /* --- Nạp khoá đã lưu (chỉ hiện dạng chấm, không hiện giá trị) --- */
  chrome.storage.local.get(SECRET_KEY, (res) => {
    const key = (res && res[SECRET_KEY]) || '';
    if (key) {
      el('aiApiKey').value = key;
      el('aiApiKey').placeholder = 'đã lưu (' + key.length + ' ký tự)';
    }
  });

  /* --- Danh sách model --- */
  function setModelValue(value) {
    const sel = el('aiModel');
    if (!sel) return;
    // Nếu model đã chọn không nằm trong danh sách -> thêm vào để không mất lựa chọn
    const exists = Array.from(sel.options).some((o) => o.value === value);
    if (value && !exists) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value + ' (đã lưu)';
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = value;
  }

  function renderModels(models, keepValue) {
    const sel = el('aiModel');
    const search = (el('aiModelSearch').value || '').toLowerCase();
    sel.innerHTML = '';

    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '(mặc định của server)';
    sel.appendChild(blank);

    const filtered = models.filter((m) =>
      !search || m.id.toLowerCase().includes(search) ||
      String(m.label || '').toLowerCase().includes(search)
    );

    filtered.slice(0, 400).forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label && m.label !== m.id ? m.id + ' — ' + m.label : m.id;
      sel.appendChild(opt);
    });

    el('aiModelDesc').textContent = filtered.length === models.length
      ? models.length + ' model khả dụng. Gõ để lọc.'
      : filtered.length + ' / ' + models.length + ' model khớp tìm kiếm.';

    setModelValue(keepValue || '');
  }

  el('aiModelSearch').addEventListener('input', () => {
    renderModels(modelList, el('aiModel').value);
  });

  /* --- Kiểm tra kết nối & tải model --- */
  el('testAi').addEventListener('click', () => {
    const result = el('aiTestResult');
    result.className = '';
    result.textContent = 'Đang kiểm tra…';
    el('testAi').disabled = true;

    // Lưu khoá + cài đặt trước khi gọi
    saveKey();
    const s = readForm();
    chrome.storage.sync.set({ [STORAGE_KEY]: s });

    chrome.runtime.sendMessage({ type: 'qh:ai:test' }, (res) => {
      el('testAi').disabled = false;
      if (!res) {
        result.className = 'err';
        result.textContent = 'Không nhận được phản hồi từ service worker.';
        return;
      }
      if (!res.ok) {
        result.className = 'err';
        result.textContent = res.error || 'Lỗi không xác định.';
        return;
      }
      const d = res.data || {};
      if (!d.reachable) {
        result.className = 'err';
        result.textContent = 'Không kết nối được: ' + (d.error || 'lỗi mạng');
        return;
      }
      result.className = 'ok';
      result.textContent = 'Kết nối thành công — ' + d.count + ' model.';
      loadModels();
    });
  });

  function loadModels() {
    chrome.runtime.sendMessage({ type: 'qh:ai:models' }, (res) => {
      if (!res || !res.ok) {
        el('aiTestResult').className = 'err';
        el('aiTestResult').textContent = (res && res.error) || 'Không tải được danh sách model.';
        return;
      }
      modelList = res.data || [];
      renderModels(modelList, el('aiModel').value);
    });
  }

  /* --- Bật AI thì tự tải model để tiện --- */
  el('aiEnabled').addEventListener('change', () => {
    if (el('aiEnabled').checked && !modelList.length) {
      saveKey();
      loadModels();
    }
  });

  /* ---------- Auto-save khi đổi select/checkbox ---------- */
  Object.keys(FIELDS).forEach((key) => {
    const input = el(key);
    if (!input) return;
    const event = FIELDS[key] === 'range' ? 'change' : 'change';
    input.addEventListener(event, save);
  });
  el('blockedHosts').addEventListener('blur', save);

  /* ---------- Lưu nhanh bằng Ctrl+S ---------- */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });
})();
