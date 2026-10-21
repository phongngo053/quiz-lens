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
     * @returns {Promise<{answer:string, confidence:number, reason:string, raw:string}>}
     */
    suggest: async function (question, options, opts) {
      const prompt = buildPrompt(question, options || []);
      const raw = await AI.complete(prompt, opts);
      const text = (raw && raw.text) || '';
      const parsed = parseJsonLoose(text);

      if (!parsed || !parsed.answer) {
        throw new Error('Không đọc được kết quả từ model');
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
        model: (raw && raw.model) || (opts && opts.model) || ''
      };
    },

    parseJsonLoose: parseJsonLoose,
    buildPrompt: buildPrompt
  };

  QH.ai = AI;
})(typeof window !== 'undefined' ? window : globalThis);
