/* =============================================================
 * Quiz Lens — Test cho nhánh cải tiến:
 *   - Dạng trình bày đáp án mới: <ol type=A>, div+span khoá, bảng
 *   - Nhận dạng đáp án đã tiết lộ ("Đáp án: B")
 *   - AI: chuỗi dự phòng model + phân loại lỗi
 *   - Iframe: điều phối frame con -> frame chính
 * ============================================================= */
'use strict';

const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const EXT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++; failures.push(name + (extra ? ' -> ' + extra : ''));
    console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

function boot(html) {
  const dom = new JSDOM(html || '<!DOCTYPE html><body></body>', {
    pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://example.test/'
  });
  const w = dom.window;
  ['src/content/config.js', 'src/content/detector.js', 'src/content/panel-styles.js',
   'src/content/panel.js', 'src/content/inline.js', 'src/content/ai.js']
    .forEach((f) => w.eval(fs.readFileSync(path.join(EXT, f), 'utf8')));
  return w;
}

function detect(html, overrides) {
  const w = boot(html);
  const s = Object.assign({}, w.QH.config.defaults, overrides || {});
  return { result: w.QH.detector.detect(w.document.body, s), window: w };
}

/* ============================================================
 * TEST 1 — <ol type="A"> / <ul type="A">
 * ============================================================ */
console.log('\n[1] Đáp án dạng <ol type="A">');
{
  const html = `<!DOCTYPE html><body>
    <div class="question">
      <p class="q-title">Which planet is the Red Planet?</p>
      <ol type="A">
        <li>Venus</li><li>Mars</li><li>Jupiter</li><li>Saturn</li>
      </ol>
    </div></body>`;
  const { result } = detect(html);
  check('phát hiện 1 câu hỏi', result.questions.length === 1, 'got ' + result.questions.length);
  const q = result.questions[0] || {};
  check('có 4 đáp án', (q.options || []).length === 4, 'got ' + (q.options || []).length);
  check('nhãn A/B/C/D', q.options && q.options.map(o => o.key).join('') === 'ABCD',
    q.options ? q.options.map(o => o.key).join(',') : 'n/a');
  check('nội dung đáp án đúng', q.options && q.options[1].text === 'Mars',
    q.options ? JSON.stringify(q.options[1].text) : 'n/a');
  check('câu hỏi lấy đúng', /Red Planet/.test(q.question || ''), q.question);
}

/* ============================================================
 * TEST 2 — <ul type="A">
 * ============================================================ */
console.log('\n[2] Đáp án dạng <ul type="A">');
{
  const html = `<!DOCTYPE html><body>
    <div class="q">
      <p class="q-title">2 + 2 = ?</p>
      <ul type="A"><li>3</li><li>4</li><li>5</li></ul>
    </div></body>`;
  const { result } = detect(html);
  check('phát hiện 1 câu hỏi', result.questions.length === 1, 'got ' + result.questions.length);
  check('có 3 đáp án', result.questions[0] && result.questions[0].options.length === 3,
    result.questions[0] ? String(result.questions[0].options.length) : 'n/a');
}

/* ============================================================
 * TEST 3 — Khoá nằm trong thẻ con đầu tiên
 * ============================================================ */
console.log('\n[3] Khoá trong thẻ con: <div><span>A.</span>…</div>');
{
  const html = `<!DOCTYPE html><body>
    <div class="item">
      <div class="qtext">What is the capital of France?</div>
      <div class="opt"><span class="key">A.</span><span>Paris</span></div>
      <div class="opt"><span class="key">B.</span><span>Lyon</span></div>
      <div class="opt"><span class="key">C.</span><span>Marseille</span></div>
    </div></body>`;
  const { result } = detect(html);
  check('phát hiện 1 câu hỏi', result.questions.length === 1, 'got ' + result.questions.length);
  const q = result.questions[0] || {};
  check('có 3 đáp án', (q.options || []).length === 3, 'got ' + (q.options || []).length);
  check('nhãn A/B/C', q.options && q.options.map(o => o.key).join('') === 'ABC',
    q.options ? q.options.map(o => o.key).join(',') : 'n/a');
  check('nội dung lấy đúng (không kèm khoá)', q.options && q.options[0].text === 'Paris',
    q.options ? JSON.stringify(q.options[0].text) : 'n/a');
  check('câu hỏi đúng', /capital of France/.test(q.question || ''), q.question);
}

/* ============================================================
 * TEST 4 — Bảng 2 cột
 * ============================================================ */
console.log('\n[4] Đáp án trong bảng');
{
  const html = `<!DOCTYPE html><body>
    <table class="quiz">
      <tr><td class="q">Which is a mammal?</td></tr>
      <tr><td>A. Shark</td><td>B. Whale</td></tr>
      <tr><td>C. Trout</td><td>D. Eel</td></tr>
    </table></body>`;
  const { result } = detect(html);
  const all = result.questions;
  check('phát hiện ít nhất 1 câu', all.length >= 1, 'got ' + all.length);
  const found = all.find((q) => q.options.length >= 2);
  check('có nhóm 2 đáp án trở lên', !!found, 'n/a');
  if (found) {
    const keys = found.options.map(o => o.key).sort().join('');
    check('chứa khoá A và B', keys.indexOf('A') !== -1 && keys.indexOf('B') !== -1, keys);
    check('nội dung đáp án đúng', found.options.some(o => o.text === 'Whale'),
      JSON.stringify(found.options.map(o => o.text)));
  }
}

/* ============================================================
 * TEST 5 — Đáp án đã tiết lộ
 * ============================================================ */
console.log('\n[5] Nhận dạng đáp án trang đã tiết lộ');
{
  const w = boot();
  const f = w.QH.detector.findRevealedAnswer;
  check('"Đáp án: B" -> B', (() => { const r = f('Đáp án: B'); return r && r.key === 'B'; })(), 'n/a');
  check('"Đáp án đúng là C" -> C', (() => { const r = f('Đáp án đúng là C'); return r && r.key === 'C'; })(), 'n/a');
  check('"Correct answer: A" -> A', (() => { const r = f('Correct answer: A'); return r && r.key === 'A'; })(), 'n/a');
  check('"The answer is D" -> D', (() => { const r = f('The answer is D'); return r && r.key === 'D'; })(), 'n/a');
  check('"Đáp án: (E)" -> E', (() => { const r = f('Đáp án: (E)'); return r && r.key === 'E'; })(), 'n/a');
  check('"✓ Đáp án đúng: B" -> B', (() => { const r = f('✓ Đáp án đúng: B'); return r && r.key === 'B'; })(), 'n/a');
  check('"Kết quả: A" -> A', (() => { const r = f('Kết quả: A'); return r && r.key === 'A'; })(), 'n/a');
  check('văn bản thường -> null', f('Câu hỏi bình thường không có đáp án') === null, 'n/a');
}

console.log('\n[5b] Gắn đáp án đã tiết lộ vào câu hỏi');
{
  const html = `<!DOCTYPE html><body>
    <div class="q">
      <p class="q-title">Câu hỏi?</p>
      <p>A. Một</p><p>B. Hai</p><p>C. Ba</p>
      <div class="feedback">Đáp án: B</div>
    </div></body>`;
  const { result } = detect(html);
  const q = result.questions[0];
  check('phát hiện câu hỏi', !!q, 'n/a');
  if (q) {
    const b = q.options.find(o => o.key === 'B');
    check('đáp án B được đánh dấu revealed', b && b.revealed === true,
      b ? String(b.revealed) : 'n/a');
    const a = q.options.find(o => o.key === 'A');
    check('đáp án A không bị đánh dấu', !a || a.revealed !== true, 'n/a');
  }
}

/* ============================================================
 * TEST 6 — Không nhận nhầm khi có nhiều câu cạnh nhau
 * ============================================================ */
console.log('\n[6] Hai câu hỏi liền nhau không bị gộp');
{
  const html = `<!DOCTYPE html><body>
    <div class="q1">
      <p class="q-title">Câu một?</p>
      <p>A. x</p><p>B. y</p>
    </div>
    <div class="q2">
      <p class="q-title">Câu hai?</p>
      <p>A. z</p><p>B. w</p>
    </div></body>`;
  const { result } = detect(html);
  check('phát hiện 2 câu hỏi', result.questions.length === 2, 'got ' + result.questions.length);
  const texts = result.questions.map(q => q.question).join('|');
  check('câu 1 và câu 2 tách biệt', /Câu một/.test(texts) && /Câu hai/.test(texts), texts);
  result.questions.forEach((q, i) => {
    check('  câu ' + (i + 1) + ' có đúng 2 đáp án', q.options.length === 2,
      'got ' + q.options.length);
  });
}

/* ============================================================
 * TEST 7 — AI: phân loại lỗi
 * ============================================================ */
console.log('\n[7] AI — phân loại lỗi theo tầng');
{
  const w = boot();
  const f = w.QH.ai.isModelLevelError;
  check('"No active credentials" -> lỗi model', f('No active credentials for provider: openai'), 'n/a');
  check('"channel verification" -> lỗi model', f('Request blocked. channel verification'), 'n/a');
  check('"request illegal" -> lỗi model', f('[400] request illegal'), 'n/a');
  check('"No such model" -> lỗi model', f('AiError: No such model: xyz'), 'n/a');
  check('"model_not_found" -> lỗi model', f('code: model_not_found'), 'n/a');
  check('401 -> KHÔNG phải lỗi model (dừng luôn)', !f('API key required for remote API access'), 'n/a');
  check('lỗi mạng -> KHÔNG phải lỗi model', !f('Failed to fetch'), 'n/a');
  check('timeout -> KHÔNG phải lỗi model', !f('Yêu cầu quá thời gian chờ'), 'n/a');
}

/* ============================================================
 * TEST 8 — AI: chuỗi dự phòng model
 * ============================================================ */
async function testAIFallbacks() {
  console.log('\n[8] AI — thử lần lượt nhiều model');
  {
    const w = boot();
    // Giả lập chrome.runtime.sendMessage
    const calls = [];
    let failFirst = true;
    w.chrome = {
      runtime: {
        sendMessage(msg, cb) {
          calls.push(msg.payload && msg.payload.model);
          const model = msg.payload && msg.payload.model;
          if (failFirst) {
            failFirst = false;
            cb({ ok: false, error: 'No active credentials for provider: openai' });
            return;
          }
          cb({ ok: true, data: { text: '{"answer":"C","confidence":0.88,"reason":"vì lý do"}', model: model } });
        }
      }
    };

    const res = await w.QH.ai.suggest('Câu hỏi?', [
      { key: 'A', text: 'x' }, { key: 'B', text: 'y' }, { key: 'C', text: 'z' }
    ], { model: 'model-lo', fallbackModels: ['model-fallback-1', 'model-fallback-2'] });

    check('gọi model chính trước', calls[0] === 'model-lo', JSON.stringify(calls));
    check('sau lỗi thì thử model dự phòng', calls[1] === 'model-fallback-1', JSON.stringify(calls));
    check('trả về đáp án đúng', res.answer === 'C', JSON.stringify(res));
    check('giữ confidence', Math.abs(res.confidence - 0.88) < 0.01, String(res.confidence));
    check('giữ lý do', res.reason === 'vì lý do', res.reason);
  }

  console.log('\n[8b] AI — lỗi mạng thì dừng ngay, không thử tiếp');
  {
    const w = boot();
    const calls = [];
    w.chrome = {
      runtime: {
        sendMessage(msg, cb) {
          calls.push(msg.payload && msg.payload.model);
          cb({ ok: false, error: 'Failed to fetch' });
        }
      }
    };
    let threw = null;
    try {
      await w.QH.ai.suggest('Câu hỏi?', [{ key: 'A', text: 'x' }], {
        model: 'm1', fallbackModels: ['m2', 'm3']
      });
    } catch (e) { threw = e; }
    check('báo lỗi', !!threw, 'n/a');
    check('chỉ gọi 1 model', calls.length === 1, JSON.stringify(calls));
    check('thông báo có thông tin hữu ích', threw && /Failed to fetch/.test(threw.message), threw ? threw.message : 'n/a');
  }

  console.log('\n[8c] AI — hết chuỗi dự phòng thì báo rõ');
  {
    const w = boot();
    w.chrome = {
      runtime: {
        sendMessage(msg, cb) {
          cb({ ok: false, error: 'No active credentials for provider: openai' });
        }
      }
    };
    let threw = null;
    try {
      await w.QH.ai.suggest('Câu hỏi?', [{ key: 'A', text: 'x' }], {
        model: 'm1', fallbackModels: ['m2']
      });
    } catch (e) { threw = e; }
    check('báo lỗi', !!threw, 'n/a');
    check('liệt kê các model đã thử',
      threw && /m1/.test(threw.message) && /m2/.test(threw.message), threw ? threw.message : 'n/a');
  }
}

/* ============================================================
 * TEST 9 — Manifest: all_frames
 * ============================================================ */
console.log('\n[9] Manifest hỗ trợ iframe');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const cs = manifest.content_scripts[0];
  check('all_frames = true', cs.all_frames === true, String(cs.all_frames));
  check('match_about_blank = true', cs.match_about_blank === true, String(cs.match_about_blank));
  check('có script ai.js', cs.js.indexOf('src/content/ai.js') !== -1, cs.js.join(','));
  check('host_permissions đủ cho iframe', manifest.host_permissions.indexOf('<all_urls>') !== -1);
}

/* ============================================================
 * TEST 10 — Điều phối iframe trong index.js
 * ============================================================ */
console.log('\n[10] Logic điều phối iframe');
{
  const src = fs.readFileSync(path.join(EXT, 'src/content/index.js'), 'utf8');
  check('có hàm isTopFrame', /function isTopFrame/.test(src), 'n/a');
  check('có reportToTop dùng postMessage', /function reportToTop/.test(src) && /postMessage/.test(src), 'n/a');
  check('có listenFromFrames nhận message', /function listenFromFrames/.test(src) && /addEventListener\('message'/.test(src), 'n/a');
  check('frame con không tạo panel', /if \(top\) \{[\s\S]{0,200}QH\.panel\.create/.test(src), 'n/a');
  check('frame con gửi kết quả lên trên', /reportToTop\(data\)/.test(src), 'n/a');
}

/* ============================================================
 * TEST 11 — Panel hiển thị đáp án đã tiết lộ
 * ============================================================ */
console.log('\n[11] Panel hiển thị đáp án đã tiết lộ');
{
  const w = boot();
  const settings = Object.assign({}, w.QH.config.defaults);
  w.QH.panel.create(settings);
  w.QH.panel.render({
    questions: [{
      id: 'q1', question: 'Câu hỏi?', source: 'keyed-text',
      options: [
        { key: 'A', text: 'X', selected: false, revealed: false },
        { key: 'B', text: 'Y', selected: false, revealed: true }
      ]
    }]
  }, settings);
  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  const revealed = sr.querySelectorAll('.opt[data-revealed="true"]');
  check('đáp án revealed được đánh dấu', revealed.length === 1, 'got ' + revealed.length);
  check('đúng là đáp án B', revealed[0] && revealed[0].getAttribute('data-key') === 'B',
    revealed[0] ? revealed[0].getAttribute('data-key') : 'n/a');
  check('có nhãn "đáp án đúng"', /đáp án đúng/.test(sr.textContent), 'n/a');
}

/* ============================================================
 * KẾT QUẢ
 * ============================================================ */
testAIFallbacks().then(() => {
  console.log('\n================================');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  if (fail) {
    console.log('\nCác mục lỗi:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('Tất cả kiểm thử đạt.');
}).catch((e) => {
  console.error('LỖI:', e);
  process.exit(1);
});
