/* =============================================================
 * Quiz Lens — LỚP AI
 * ------------------------------------------------------------
 * Thuộc tính: window.QH.ai
 *
 * Gọi API tương thích OpenAI. Việc HTTP được thực hiện trong
 * service worker (có host_permissions) để:
 *   - tránh lỗi CORS khi gọi từ content script
 *   - không lộ API key vào ngữ cảnh trang web
 * ============================================================= */
(function (global) {
  'use strict';

  const QH = (global.QH = global.QH || {});

  function send(type, payload) {
    return new Promise((resolve, reject) => {
      if (!global.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Không có chrome.runtime'));
        return;
      }
      chrome.runtime.sendMessage({ type, payload }, (res) => {
        if (global.chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res) { reject(new Error('Không nhận được phản hồi')); return; }
        if (res.error) { reject(new Error(res.error)); return; }
        resolve(res.data);
      });
    });
  }

  /* ------------------------------------------------------------
   * Prompt: yêu cầu model trả về JSON có cấu trúc
   * ------------------------------------------------------------ */
  function buildPrompt(question, options) {
    const lines = options.map((o) => `${o.key}. ${o.text}`).join('\n');
    return [
      'Bạn là trợ lý giải trắc nghiệm. Dựa trên câu hỏi và các lựa chọn, hãy chọn đáp án đúng nhất.',
      '',
      'CÂU HỎI:',
      question,
      '',
      'CÁC LỰA CHỌN:',
      lines,
      '',
      'Trả về DUY NHẤT một đối tượng JSON, không thêm giải thích bên ngoài, theo mẫu:',
      '{"answer":"<ký hiệu đáp án>","confidence":<số 0-1>,"reason":"<giải thích ngắn gọn, tối đa 120 ký tự>"}'
    ].join('\n');
  }

  /** Bóc JSON khỏi phản hồi của model (chịu được cả khi model bọc trong ```json). */
  function parseJsonLoose(text) {
    if (!text) return null;
    let s = String(text).trim();

    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();

    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      s = s.slice(start, end + 1);
    }
    try { return JSON.parse(s); } catch (e) { /* thử tiếp */ }

    // Trường hợp model trả về dạng "answer: B"
    const m = /answer"?\s*[:=]\s*["']?([A-Ha-h])["']?/i.exec(text);
    if (m) {
      const conf = /confidence"?\s*[:=]\s*([\d.]+)/i.exec(text);
      const reason = /reason"?\s*[:=]\s*["']([^"']{0,200})["']/i.exec(text);
      return {
        answer: m[1].toUpperCase(),
        confidence: conf ? parseFloat(conf[1]) : 0.6,
        reason: reason ? reason[1] : ''
      };
    }
    return null;
  }

  /**
   * Chuỗi model dự phòng.
   *
   * Bối cầu chung của các gateway (new-api, one-api…) là mỗi key chỉ được
   * cấp quyền cho một số model nhất định. Nếu model đang chọn không thuộc
   * nhóm được cấp, API trả lỗi kiểu "No active credentials" hoặc
   * "channel verification". Ta tự thử lần lượt các model thay thế.
   */
  const FALLBACK_MODELS = [
    'gemma4',
    'ollama/gpt-oss:120b',
    'gpt-5.6-luna',
    'ollama/beam:cloud'
  ];

  /** Lỗi nào đáng thử model khác? */
  function isModelLevelError(message) {
    if (!message) return false;
    const m = String(message).toLowerCase();
    return m.includes('no active credentials') ||
           m.includes('channel verification') ||
           m.includes('request illegal') ||
           m.includes('no such model') ||
           m.includes('does not exist') ||
           m.includes('not in the free plan') ||
           m.includes('model_not_found') ||
           m.includes('not found');
  }

  const AI = {
    /** Lấy danh sách model khả dụng. */
    listModels: function () {
      return send('qh:ai:models');
    },

    /**
     * Lưu khoá API.
     * Khoá được gửi tới service worker và lưu ở chrome.storage.local —
     * KHÔNG lưu trong cài đặt đồng bộ và KHÔNG nằm trong mã nguồn.
     */
    setKey: function (key) {
      return send('qh:ai:setkey', { key: key });
    },

    /** Kiểm tra đã có khoá hay chưa (không trả về giá trị khoá). */
    hasKey: function () {
      return send('qh:ai:haskey');
    },

    /** Kiểm tra kết nối tới API. */
    test: function () {
      return send('qh:ai:test');
    },

    /** Gọi model, trả về nội dung text thô. */
    complete: function (prompt, options) {
      const opts = options || {};
      return send('qh:ai:complete', {
        prompt,
        model: opts.model || null,
        temperature: typeof opts.temperature === 'number' ? opts.temperature : 0
      });
    },

    /**
     * Gợi ý đáp án cho một câu hỏi.
     *
     * Nếu model chính bị lỗi ở tầng model (key chưa được cấp quyền cho
     * model đó), tự thử các model dự phòng.
     *
     * @returns {Promise<{answer:string, confidence:number, reason:string, raw:string}>}
     */
    suggest: async function (question, options, opts) {
      const prompt = buildPrompt(question, options || []);
      const settings = opts || {};

      const primary = settings.model || '';
      const tried = [];
      let lastError = null;

      // Danh sách model sẽ thử lần lượt
      const chain = [];
      if (primary) chain.push(primary);
      (settings.fallbackModels || FALLBACK_MODELS).forEach((m) => {
        if (m && chain.indexOf(m) === -1) chain.push(m);
      });
      if (!chain.length) chain.push('');   // để server tự chọn

      for (const model of chain) {
        tried.push(model || '(mặc định)');
        let raw;
        try {
          raw = await AI.complete(prompt, Object.assign({}, settings, { model }));
        } catch (e) {
          lastError = e;
          // Lỗi cấp quyền -> thử model khác
          if (isModelLevelError(e.message)) continue;
          // Lỗi mạng / xác thực -> dừng, không đáng thử tiếp
          throw e;
        }

        const text = (raw && raw.text) || '';
        const parsed = parseJsonLoose(text);
        if (!parsed || !parsed.answer) {
          lastError = new Error('Không đọc được kết quả từ model');
          continue;
        }

        // Chuẩn hoá ký hiệu đáp án
        const answer = String(parsed.answer).trim().toUpperCase().replace(/[^A-H]/g, '').charAt(0);
        let confidence = parseFloat(parsed.confidence);
        if (!isFinite(confidence)) confidence = 0.6;
        if (confidence > 1) confidence = confidence / 100;

        return {
          answer: answer,
          confidence: Math.max(0, Math.min(1, confidence)),
          reason: String(parsed.reason || '').trim(),
          raw: text.slice(0, 600),
          model: (raw && raw.model) || model || '',
          triedModels: tried
        };
      }

      // Hết chuỗi dự phòng -> báo lỗi có thông tin hữu ích
      const msg = lastError ? lastError.message : 'Không có model nào trả lời được';
      const err = new Error(
        'Không gọi được AI (' + msg + '). Đã thử: ' + tried.join(', ')
      );
      err.triedModels = tried;
      throw err;
    },

    parseJsonLoose: parseJsonLoose,
    buildPrompt: buildPrompt,
    isModelLevelError: isModelLevelError,
    FALLBACK_MODELS: FALLBACK_MODELS
  };

  QH.ai = AI;
})(typeof window !== 'undefined' ? window : globalThis);
