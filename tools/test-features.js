/* =============================================================
 * Quiz Lens — Test cho tính năng mới:
 *   - AI (parse JSON, build prompt)
 *   - Chế độ "đang gõ" (không chặn khi gõ)
 *   - Quét xuyên Shadow DOM
 *   - Quét thủ công theo vùng chọn
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

/* ============================================================
 * TEST 1 — AI: parseJsonLoose
 * ============================================================ */
console.log('\n[1] AI — bóc JSON từ phản hồi model');
{
  const w = boot();
  const p = w.QH.ai.parseJsonLoose;

  check('JSON thuần', (() => {
    const r = p('{"answer":"B","confidence":0.9,"reason":"Vì X"}');
    return r && r.answer === 'B' && Math.abs(r.confidence - 0.9) < 0.01 && r.reason === 'Vì X';
  })(), 'n/a');

  check('JSON bọc trong ```json', (() => {
    const r = p('```json\n{"answer":"C","confidence":0.8,"reason":"r"}\n```');
    return r && r.answer === 'C';
  })(), 'n/a');

  check('JSON có text thừa trước/sau', (() => {
    const r = p('Đây là kết quả: {"answer":"D","confidence":0.7} Hết.');
    return r && r.answer === 'D';
  })(), 'n/a');

  check('dạng "answer: B" không có JSON', (() => {
    const r = p('answer: A\nconfidence: 0.5\nreason: "abc"');
    return r && r.answer === 'A' && Math.abs(r.confidence - 0.5) < 0.01;
  })(), 'n/a');

  check('chuỗi rác -> null', p('không có gì cả') === null, 'n/a');
}

/* ============================================================
 * TEST 2 — AI: buildPrompt chứa câu hỏi và lựa chọn
 * ============================================================ */
console.log('\n[2] AI — prompt');
{
  const w = boot();
  const prompt = w.QH.ai.buildPrompt('Thủ đô Việt Nam?', [
    { key: 'A', text: 'Hà Nội' }, { key: 'B', text: 'Đà Nẵng' }
  ]);
  check('chứa câu hỏi', /Thủ đô Việt Nam\?/.test(prompt), 'n/a');
  check('chứa đáp án A', /A\. Hà Nội/.test(prompt), 'n/a');
  check('chứa đáp án B', /B\. Đà Nẵng/.test(prompt), 'n/a');
  check('yêu cầu trả về JSON', /JSON/i.test(prompt), 'n/a');
}

/* ============================================================
 * TEST 3 — Chế độ "đang gõ": panel không chặn
 * ============================================================ */
console.log('\n[3] Chế độ đang gõ');
{
  const w = boot('<!DOCTYPE html><body><input id="txt"></body>');
  w.QH.panel.create(w.QH.config.defaults);
  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  const dock = sr.querySelector('.dock');

  check('mặc định chưa ở chế độ gõ', dock.getAttribute('data-typing') !== 'true');

  w.QH.panel.setTypingMode(true);
  check('bật -> data-typing=true', dock.getAttribute('data-typing') === 'true');
  check('bật -> panel tự thu gọn', dock.getAttribute('data-collapsed') === 'true');

  w.QH.panel.setTypingMode(false);
  check('tắt -> data-typing=false', dock.getAttribute('data-typing') === 'false');
  check('tắt -> panel mở rộng lại', dock.getAttribute('data-collapsed') === 'false');
}

/* ============================================================
 * TEST 4 — CSS chống chặn thao tác
 * ============================================================ */
console.log('\n[4] CSS chống chặn thao tác');
{
  const w = boot();
  const css = w.QH.panelStyles.CSS;
  check('có pointer-events: none khi đang gõ',
    /data-typing="true"[^}]*pointer-events:\s*none/.test(css), 'n/a');
  check('có opacity khi đang gõ',
    /data-typing="true"[^}]*opacity/.test(css), 'n/a');
  check('dock dùng position: fixed', /\.dock\s*\{[^}]*position:\s*fixed/.test(css), 'n/a');
  check('panel có z-index cao', /\.dock\s*\{[^}]*z-index:\s*2147/.test(css), 'n/a');
}

/* ============================================================
 * TEST 5 — Quét xuyên Shadow DOM
 * ============================================================ */
console.log('\n[5] Quét xuyên Shadow DOM');
{
  const w = boot('<!DOCTYPE html><body><div id="host"></div></body>');

  // Tạo Shadow DOM (jsdom không chạy inline script nên phải gọi trực tiếp)
  w.eval(`
    const sr = document.getElementById('host').attachShadow({ mode: 'open' });
    sr.innerHTML =
      '<div class="quiz">' +
      '<p class="q-title">Câu hỏi trong shadow DOM?</p>' +
      '<p>A. Một</p><p>B. Hai</p><p>C. Ba</p>' +
      '</div>';
  `);

  const deep = w.QH.detector.detect(w.document.body, { deepSearch: true });
  const shallow = w.QH.detector.detect(w.document.body, { deepSearch: false });

  check('bật deepSearch -> tìm thấy câu hỏi trong shadow', deep.questions.length === 1,
    'got ' + deep.questions.length);
  check('câu hỏi trong shadow đúng nội dung',
    deep.questions[0] && /shadow DOM/.test(deep.questions[0].question),
    deep.questions[0] ? deep.questions[0].question : 'n/a');
  check('3 đáp án trong shadow', deep.questions[0] && deep.questions[0].options.length === 3,
    deep.questions[0] ? String(deep.questions[0].options.length) : 'n/a');
  check('tắt deepSearch -> không thấy', shallow.questions.length === 0,
    'got ' + shallow.questions.length);
}

/* ============================================================
 * TEST 6 — Quét thủ công theo vùng chọn
 * ============================================================ */
console.log('\n[6] Quét thủ công theo vùng chọn');
{
  const html = `<!DOCTYPE html><body>
    <div id="target">
      <p>Đây là câu hỏi cần quét?</p>
      <p>A. Alpha</p><p>B. Beta</p>
    </div>
  </body>`;
  const w = boot(html);
  const target = w.document.getElementById('target');

  const found = w.QH.detector.detectIn(target, w.QH.config.defaults);
  check('phát hiện được trong vùng chọn', found.length >= 1, 'got ' + found.length);
  check('có 2 đáp án', found[0] && found[0].options.length === 2,
    found[0] ? String(found[0].options.length) : 'n/a');
  check('nhãn A/B đúng', found[0] && found[0].options.map(o => o.key).join('') === 'AB',
    found[0] ? found[0].options.map(o => o.key).join(',') : 'n/a');
}

/* ============================================================
 * TEST 7 — Nút AI trong panel
 * ============================================================ */
console.log('\n[7] Nút AI trong panel');
{
  const w = boot();
  const settings = Object.assign({}, w.QH.config.defaults, { aiEnabled: true });
  w.QH.panel.create(settings);

  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  check('nút "Gợi ý AI" cho tất cả câu hiện',
    sr.querySelector('.js-ai-all') && !sr.querySelector('.js-ai-all').hidden);

  w.QH.panel.render({
    questions: [{
      id: 'q1', question: 'Câu hỏi?', source: 'input',
      options: [{ key: 'A', text: 'X', selected: false }, { key: 'B', text: 'Y', selected: false }]
    }]
  }, settings);

  check('mỗi câu có nút "Gợi ý AI"', sr.querySelectorAll('.js-ai-ask').length === 1,
    'got ' + sr.querySelectorAll('.js-ai-ask').length);
  check('có chỗ hiển thị kết quả', !!sr.querySelector('.js-ai-slot'));

  // Hiển thị kết quả
  w.QH.panel.showAI('q1', { answer: 'B', confidence: 0.92, reason: 'Vì lý do X' });
  const slot = sr.querySelector('.js-ai-slot');
  check('hiện ký hiệu đáp án', slot.innerHTML.indexOf('>B<') !== -1, slot.innerHTML.slice(0, 90));
  check('hiện lý do', /Vì lý do X/.test(slot.textContent), slot.textContent.slice(0, 90));
  check('badge độ tin cậy cao', sr.querySelector('.ai-badge').getAttribute('data-conf') === 'high');

  // Trạng thái loading
  w.QH.panel.showAI('q1', { loading: true });
  check('hiện spinner khi đang tải', !!sr.querySelector('.ai-spin'), 'n/a');
  check('nút bị disable khi đang tải', sr.querySelector('.js-ai-ask').disabled);

  // Lỗi
  w.QH.panel.showAI('q1', { error: 'Không kết nối được' });
  check('hiện lỗi', /Không kết nối được/.test(slot.textContent), slot.textContent.slice(0, 80));
}

/* ============================================================
 * TEST 8 — Không có AI -> không hiện nút
 * ============================================================ */
console.log('\n[8] Tắt AI -> ẩn nút');
{
  const w = boot();
  const settings = Object.assign({}, w.QH.config.defaults, { aiEnabled: false });
  w.QH.panel.create(settings);
  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  check('nút AI bị ẩn', sr.querySelector('.js-ai-all').hidden === true);

  w.QH.panel.render({
    questions: [{ id: 'q1', question: 'Q?', source: 'input',
      options: [{ key: 'A', text: 'X', selected: false }, { key: 'B', text: 'Y', selected: false }] }]
  }, settings);
  check('không có nút "Gợi ý AI" trong câu hỏi', sr.querySelectorAll('.js-ai-ask').length === 0);
}

/* ============================================================
 * TEST 9 — An toàn: khoá API không nằm trong cài đặt đồng bộ
 * ============================================================ */
console.log('\n[9] An toàn khoá API');
{
  const w = boot();
  const cfg = w.QH.config.defaults;
  check('cấu hình không chứa aiApiKey trong defaults',
    cfg.aiApiKey === undefined || cfg.aiApiKey === '', 'got ' + cfg.aiApiKey);

  const sw = fs.readFileSync(path.join(EXT, 'src/background/service-worker.js'), 'utf8');
  check('service worker dùng storage.local cho khoá',
    /chrome\.storage\.local/.test(sw), 'n/a');
  check('service worker KHÔNG dùng storage.sync cho khoá',
    !/chrome\.storage\.sync\.set\(\s*\{\s*\[SECRET_KEY\]/.test(sw), 'n/a');
  check('source KHÔNG chứa khoá API dạng chữ',
    !/sk-[a-zA-Z0-9_\-]{10,}/.test(sw), 'n/a');

  const opts = fs.readFileSync(path.join(EXT, 'src/options/options.js'), 'utf8');
  check('options.js lưu khoá qua storage.local',
    /chrome\.storage\.local\.set/.test(opts), 'n/a');
  check('options.js xoá aiApiKey khỏi cài đặt đồng bộ',
    /delete s\.aiApiKey/.test(opts), 'n/a');
}

/* ============================================================
 * TEST 10 — Không rò rỉ khoá vào DOM trang web
 * ============================================================ */
console.log('\n[10] Khoá không rò vào trang web');
{
  const w = boot();
  const ai = fs.readFileSync(path.join(EXT, 'src/content/ai.js'), 'utf8');
  check('content script không tự chứa khoá',
    !/sk-[a-zA-Z0-9_\-]{10,}/.test(ai), 'n/a');
  check('content script không gọi fetch trực tiếp tới API',
    !/fetch\s*\(\s*['"`]https?:/.test(ai), 'n/a');
  check('content script đi qua service worker',
    /chrome\.runtime\.sendMessage/.test(ai), 'n/a');
}

/* ============================================================
 * TEST 11 — Nút quét thủ công
 * ============================================================ */
console.log('\n[11] Nút quét thủ công');
{
  const w = boot();
  const settings = Object.assign({}, w.QH.config.defaults, { manualScan: true });
  w.QH.panel.create(settings);
  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  check('nút quét vùng hiện', sr.querySelector('.js-manual') && !sr.querySelector('.js-manual').hidden);

  const settings2 = Object.assign({}, w.QH.config.defaults, { manualScan: false });
  w.QH.panel.applySettings(settings2);
  check('tắt -> nút quét vùng ẩn', sr.querySelector('.js-manual').hidden === true);
}

/* ============================================================
 * KẾT QUẢ
 * ============================================================ */
console.log('\n================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
if (fail) {
  console.log('\nCác mục lỗi:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('Tất cả kiểm thử đạt.');
