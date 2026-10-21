/* =============================================================
 * Quiz Lens — SERVICE WORKER
 * ------------------------------------------------------------
 * Nhiệm vụ:
 *   1. Xử lý click vào icon extension -> bật/tắt trên tab đang hoạt động
 *   2. Lệnh bàn phím Alt+Shift+Q
 *   3. Làm cầu nối cài đặt giữa options page và content script
 *   4. PROXY gọi API AI (giữ API key ở service worker, tránh CORS,
 *      không lộ key cho script của trang web)
 *
 * Không có backend. Mọi dữ liệu lưu trong chrome.storage.sync.
 * ============================================================= */

const STORAGE_KEY = 'qh.settings';

/**
 * KHOÁ API — lưu trong chrome.storage.LOCAL, KHÔNG dùng storage.sync.
 *
 * Lý do:
 *   - storage.local không đồng bộ lên tài khoản Google, không nằm trong
 *     dữ liệu người dùng có thể export.
 *   - Nội dung file này (source code) được đẩy lên GitHub công khai ->
 *     tuyệt đối không hard-code khoá vào mã nguồn.
 *   - Khoá chỉ được đọc trong service worker rồi gửi trực tiếp tới API;
 *     nó KHÔNG bao giờ được tiêm vào DOM của trang web.
 */
const SECRET_KEY = 'qh.aiApiKey';

const DEFAULT_SETTINGS = {
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
  blockedHosts: [],
  customProfiles: [],
  aiEnabled: false,
  aiBaseUrl: '',          // người dùng tự nhập ở trang Cài đặt
  aiModel: '',
  aiAuto: false,
  aiConcurrency: 2,
  deepSearch: true,
  autoCollapseOnFocus: true,
  manualScan: true
};

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
  }
});

/** Đọc cài đặt hiện tại (có fallback về mặc định). */
async function getSettings() {
  const res = await chrome.storage.sync.get(STORAGE_KEY);
  return Object.assign({}, DEFAULT_SETTINGS, (res && res[STORAGE_KEY]) || {});
}

/**
 * Đọc khoá API từ chrome.storage.local.
 * Tách riêng khỏi cài đặt đồng bộ để khoá KHÔNG BAO GIỜ bị export
 * cùng cài đặt, và không bao giờ nằm trong mã nguồn push lên GitHub.
 */
async function getApiKey() {
  const res = await chrome.storage.local.get(SECRET_KEY);
  return (res && res[SECRET_KEY]) || '';
}

/** Lưu khoá API vào storage.local. */
async function setApiKey(value) {
  await chrome.storage.local.set({ [SECRET_KEY]: value || '' });
}

/** Gửi lệnh tới tab đang hoạt động. */
async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    // Tab chưa nạp content script (vd: trang nội bộ) -> báo lại
    return null;
  }
}

/** Báo lỗi lên badge icon khi không gửi được lệnh. */
async function flashBadge() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#4f9cf9' });
  setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 2500);
}

chrome.action.onClicked.addListener(async () => {
  const res = await sendToActiveTab({ type: 'qh:toggle' });
  if (!res) await flashBadge();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-panel') {
    const res = await sendToActiveTab({ type: 'qh:toggle' });
    if (!res) await flashBadge();
  }
});

/** Options page lưu cài đặt -> thông báo cho mọi content script đang mở. */
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  if (!changes[STORAGE_KEY]) return;

  const tabs = await chrome.tabs.query({});
  tabs.forEach((tab) => {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'qh:settings-changed' }).catch(() => {});
    }
  });
});

/* =============================================================
 * LỚP AI — PROXY GỌI API
 * ============================================================= */

function normalizeBase(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  // Bỏ dấu / cuối
  u = u.replace(/\/+$/, '');
  // Người dùng có thể nhập ".../v1" hoặc chỉ ".../" -> chuẩn hoá về có /v1
  if (!/\/v\d+$/.test(u)) u += '/v1';
  return u;
}

async function aiFetch(settings, endpoint, init) {
  const base = normalizeBase(settings.aiBaseUrl);
  if (!base) throw new Error('Chưa cấu hình địa chỉ API');

  const apiKey = await getApiKey();
  const url = base + endpoint;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: init.method || 'GET',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        apiKey ? { Authorization: 'Bearer ' + apiKey } : {},
        init.headers || {}
      ),
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }

    if (!res.ok) {
      const msg = (data && (data.error && (data.error.message || data.error) || data.message)) || ('HTTP ' + res.status);
      throw new Error(String(msg).slice(0, 300));
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Yêu cầu quá thời gian chờ');
    throw new Error(e.message || 'Không kết nối được tới API');
  } finally {
    clearTimeout(timer);
  }
}

/** Lấy danh sách model. */
async function listModels(settings) {
  const data = await aiFetch(settings, '/models', { method: 'GET' });
  const list = Array.isArray(data) ? data : (data.data || data.models || []);
  return list
    .map((m) => {
      if (typeof m === 'string') return { id: m, label: m };
      const id = m.id || m.name || m.model || '';
      return { id, label: m.display_name || m.name || id };
    })
    .filter((m) => m.id);
}

/** Gọi chat/completions. */
async function complete(settings, prompt, model, temperature) {
  const useModel = model || settings.aiModel || '';
  const body = {
    model: useModel || undefined,
    messages: [{ role: 'user', content: prompt }],
    temperature: typeof temperature === 'number' ? temperature : 0,
    stream: false
  };
  // Nếu không có model, thử gọi endpoint chat để server tự chọn
  const data = await aiFetch(settings, '/chat/completions', { method: 'POST', body });

  let text = '';
  if (data && Array.isArray(data.choices) && data.choices.length) {
    const c = data.choices[0];
    text = (c.message && (c.message.content || c.message.reasoning_content)) ||
           (c.text || c.delta && c.delta.content) || '';
    if (Array.isArray(text)) {
      text = text.map((x) => (typeof x === 'string' ? x : (x && x.text) || '')).join('');
    }
  } else if (data && typeof data.output_text === 'string') {
    text = data.output_text;
  } else if (data && data.raw) {
    text = data.raw;
  }

  return {
    text: String(text || ''),
    model: (data && data.model) || useModel,
    usage: data && data.usage
  };
}

/* =============================================================
 * MESSAGE HANDLER
 * ============================================================= */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'qh:ai:models':
      getSettings()
        .then(async (s) => {
          if (!s.aiEnabled && !s.aiBaseUrl) throw new Error('AI chưa được bật');
          const models = await listModels(s);
          sendResponse({ ok: true, data: models });
        })
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'qh:ai:complete':
      getSettings()
        .then(async (s) => {
          const p = msg.payload || {};
          const out = await complete(s, p.prompt, p.model, p.temperature);
          sendResponse({ ok: true, data: out });
        })
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'qh:ping':
      getSettings()
        .then(async (s) => {
          try {
            const models = await listModels(s);
            sendResponse({ ok: true, data: { reachable: true, count: models.length } });
          } catch (e) {
            sendResponse({ ok: true, data: { reachable: false, error: e.message } });
          }
        });
      return true;

    /* --- Quản lý khoá API (chỉ lưu cục bộ, không đồng bộ) --- */
    case 'qh:ai:setkey':
      setApiKey((msg.payload || {}).key || '')
        .then(() => sendResponse({ ok: true, data: { saved: true } }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'qh:ai:haskey':
      getApiKey()
        .then((k) => sendResponse({ ok: true, data: { hasKey: !!k } }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'qh:ai:test':
      getSettings()
        .then(async (s) => {
          try {
            const models = await listModels(s);
            sendResponse({ ok: true, data: { reachable: true, count: models.length } });
          } catch (e) {
            sendResponse({ ok: true, data: { reachable: false, error: e.message } });
          }
        });
      return true;
  }
});
