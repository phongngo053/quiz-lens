/* =============================================================
 * Quiz Lens — Bộ test cho lớp phát hiện
 * Chạy bằng:  node tools/test-detector.js
 * Yêu cầu: jsdom (đã cài ở workspace Node)
 * ============================================================= */
'use strict';

const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    failures.push(name + (extra ? ' -> ' + extra : ''));
    console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

/* ------------------------------------------------------------
 * Nạp detector vào một JSDOM window
 * ------------------------------------------------------------ */
function makeWindow(html) {
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: 'https://example.test/'
  });
  const w = dom.window;
  // Nạp config + detector vào window (chạy trong ngữ cảnh của jsdom)
  w.eval(require('fs').readFileSync(path.join(EXT, 'src/content/config.js'), 'utf8'));
  w.eval(require('fs').readFileSync(path.join(EXT, 'src/content/detector.js'), 'utf8'));
  return w;
}

function detect(html, overrides) {
  const w = makeWindow(html);
  const settings = Object.assign({}, w.QH.config.defaults, overrides || {});
  return { result: w.QH.detector.detect(w.document.body, settings), window: w };
}

/* ============================================================
 * TEST 1 — Nhóm radio (layout Moodle-like)
 * ============================================================ */
console.log('\n[1] Nhóm radio cùng name');
{
  const html = `<!DOCTYPE html><body>
    <div class="que">
      <div class="qtext"><p>Thủ đô của Việt Nam là thành phố nào?</p></div>
      <div class="answer">
        <div class="r0"><input type="radio" name="q1" id="opt1"><label for="opt1">Hà Nội</label></div>
        <div class="r1"><input type="radio" name="q1" id="opt2"><label for="opt2">Đà Nẵng</label></div>
        <div class="r2"><input type="radio" name="q1" id="opt3"><label for="opt3">Hải Phòng</label></div>
        <div class="r3"><input type="radio" name="q1" id="opt4"><label for="opt4">Cần Thơ</label></div>
      </div>
    </div>
  </body>`;
  const { result } = detect(html);
  check('phát hiện 1 câu hỏi', result.questions.length === 1, 'got ' + result.questions.length);
  const q = result.questions[0] || {};
  check('câu hỏi chứa nội dung đúng', /Thủ đô/.test(q.question || ''), q.question);
  check('có 4 đáp án', (q.options || []).length === 4, 'got ' + (q.options || []).length);
  check('nhãn đáp án A/B/C/D', q.options && q.options.map(o => o.key).join('') === 'ABCD',
    q.options ? q.options.map(o => o.key).join(',') : 'n/a');
  check('nội dung đáp án đầu là "Hà Nội"', q.options && /Hà Nội/.test(q.options[0].text), q.options && q.options[0].text);
  check('source = input', q.source === 'input', q.source);
}

/* ============================================================
 * TEST 2 — Label bao quanh input
 * ============================================================ */
console.log('\n[2] Label bao quanh input');
{
  const html = `<!DOCTYPE html><body>
    <div class="card">
      <h3 class="question-title">2 + 2 bằng mấy?</h3>
      <label class="opt"><input type="radio" name="q2" value="1"> A. 3</label>
      <label class="opt"><input type="radio" name="q2" value="2"> B. 4</label>
      <label class="opt"><input type="radio" name="q2" value="3"> C. 5</label>
      <label class="opt"><input type="radio" name="q2" value="4"> D. 6</label>
    </div>
  </body>`;
  const { result } = detect(html);
  check('phát hiện 1 câu hỏi', result.questions.length === 1, 'got ' + result.questions.length);
  const q = result.questions[0] || {};
  check('câu hỏi lấy từ .question-title', /2 \+ 2/.test(q.question || ''), q.question);
  check('có 4 đáp án', (q.options || []).length === 4, 'got ' + (q.options || []).length);
  check('tiền tố "A." được bỏ khi stripKeyPrefix',
    q.options && q.options[0].text.trim() === '3', q.options && JSON.stringify(q.options[0].text));
  check('giữ nguyên tiền tố khi tắt stripKeyPrefix',
    (() => {
      const r2 = detect(html, { stripKeyPrefix: false }).result;
      return r2.questions[0] && /A\./.test(r2.questions[0].options[0].text);
    })(), 'n/a');
}

/* ============================================================
 * TEST 3 — Đáp án dạng chữ A./B./C. (không có input)
 * ============================================================ */
console.log('\n[3] Đáp án dạng chữ A./B./C.');
{
  const html = `<!DOCTYPE html><body>
    <div class="q">
      <p class="q-title">Nguyên tử có tối đa bao nhiêu electron lớp ngoài cùng?</p>
      <div class="opts">
        <p>A. 2</p>
        <p>B. 4</p>
        <p>C. 8</p>
        <p>D. 16</p>
      </div>
    </div>
  </body>`;
  const { result } = detect(html);
  check('phát hiện 1 câu hỏi', result.questions.length === 1, 'got ' + result.questions.length);
  const q = result.questions[0] || {};
  check('source = keyed-text', q.source === 'keyed-text', q.source);
  check('có 4 đáp án', (q.options || []).length === 4, 'got ' + (q.options || []).length);
  check('nhãn A/B/C/D đúng', q.options && q.options.map(o => o.key).join('') === 'ABCD',
    q.options ? q.options.map(o => o.key).join(',') : 'n/a');
  check('nội dung đáp án đúng', q.options && q.options[0].text === '2', q.options && JSON.stringify(q.options[0].text));
  check('câu hỏi có nội dung', /electron/.test(q.question || ''), q.question);
}

/* ============================================================
 * TEST 4 — Checkbox (multi-select)
 * ============================================================ */
console.log('\n[4] Checkbox nhiều lựa chọn');
{
  const html = `<!DOCTYPE html><body>
    <div class="question">
      <p class="question-text">Chọn các ngôn ngữ chạy trên JVM</p>
      <label><input type="checkbox" name="langs" value="1"> Java</label>
      <label><input type="checkbox" name="langs" value="2"> Kotlin</label>
      <label><input type="checkbox" name="langs" value="3"> Python</label>
      <label><input type="checkbox" name="langs" value="4"> Scala</label>
    </div>
  </body>`;
  const { result } = detect(html);
  check('phát hiện 1 câu hỏi', result.questions.length === 1, 'got ' + result.questions.length);
  const q = result.questions[0] || {};
  check('có 4 đáp án', (q.options || []).length === 4, 'got ' + (q.options || []).length);
  check('câu hỏi lấy đúng', /JVM/.test(q.question || ''), q.question);
}

/* ============================================================
 * TEST 5 — Đánh dấu đáp án đã chọn
 * ============================================================ */
console.log('\n[5] Đáp án đã chọn');
{
  const html = `<!DOCTYPE html><body>
    <div class="que">
      <div class="qtext"><p>Câu hỏi?</p></div>
      <input type="radio" name="q5" id="a"><label for="a">Alpha</label>
      <input type="radio" name="q5" id="b" checked><label for="b">Beta</label>
      <input type="radio" name="q5" id="c"><label for="c">Gamma</label>
    </div>
  </body>`;
  const { result } = detect(html);
  const q = result.questions[0] || {};
  check('3 đáp án', (q.options || []).length === 3, 'got ' + (q.options || []).length);
  check('đáp án B được đánh dấu selected',
    q.options && q.options[1] && q.options[1].selected === true,
    q.options ? JSON.stringify(q.options.map(o => o.selected)) : 'n/a');
  check('các đáp án khác không selected',
    q.options && q.options[0].selected === false && q.options[2].selected === false, 'n/a');
}

/* ============================================================
 * TEST 6 — Nhiều câu hỏi độc lập
 * ============================================================ */
console.log('\n[6] Nhiều câu hỏi');
{
  const html = `<!DOCTYPE html><body>
    <div class="que"><div class="qtext"><p>Câu một?</p></div>
      <input type="radio" name="a1"><label for="x1">A1</label>
      <input type="radio" name="a1"><label for="x2">B1</label></div>
    <div class="que"><div class="qtext"><p>Câu hai?</p></div>
      <input type="radio" name="a2"><label for="x3">A2</label>
      <input type="radio" name="a2"><label for="x4">B2</label></div>
    <div class="que"><div class="qtext"><p>Câu ba?</p></div>
      <input type="radio" name="a3"><label for="x5">A3</label>
      <input type="radio" name="a3"><label for="x6">B3</label></div>
  </body>`;
  const { result } = detect(html);
  check('phát hiện 3 câu hỏi', result.questions.length === 3, 'got ' + result.questions.length);
  const qs = result.questions.map(q => q.question).join('|');
  check('chứa cả 3 nội dung câu hỏi', /Câu một/.test(qs) && /Câu hai/.test(qs) && /Câu ba/.test(qs), qs);
}

/* ============================================================
 * TEST 7 — Không có câu hỏi nào
 * ============================================================ */
console.log('\n[7] Trang không có trắc nghiệm');
{
  const html = `<!DOCTYPE html><body><p>Đây là một bài viết bình thường về lịch sử Việt Nam.</p>
    <p>Không có ô radio hay đáp án nào ở đây cả.</p></body>`;
  const { result } = detect(html);
  check('không phát hiện câu hỏi giả', result.questions.length === 0, 'got ' + result.questions.length);
}

/* ============================================================
 * TEST 8 — minOptions
 * ============================================================ */
console.log('\n[8] Ngưỡng minOptions');
{
  const html = `<!DOCTYPE html><body>
    <div><p class="q-title">Chỉ có một đáp án</p>
      <input type="radio" name="z" id="z1"><label for="z1">Duy nhất</label>
      <input type="radio" name="z" id="z2"><label for="z2">Hai</label>
    </div></body>`;
  const r1 = detect(html, { minOptions: 2 }).result;
  const r2 = detect(html, { minOptions: 3 }).result;
  check('minOptions=2 -> nhận câu', r1.questions.length === 1, 'got ' + r1.questions.length);
  check('minOptions=3 -> bỏ qua', r2.questions.length === 0, 'got ' + r2.questions.length);
}

/* ============================================================
 * TEST 9 — parseKeyPrefix
 * ============================================================ */
console.log('\n[9] parseKeyPrefix');
{
  const w = makeWindow('<!DOCTYPE html><body></body>');
  const p = w.QH.detector.parseKeyPrefix;
  check('"A. Hà Nội" -> key A, rest "Hà Nội"', (() => { const r = p('A. Hà Nội'); return r && r.key === 'A' && r.rest === 'Hà Nội'; })(), 'n/a');
  check('"(B) Đà Nẵng" -> key B', (() => { const r = p('(B) Đà Nẵng'); return r && r.key === 'B'; })(), 'n/a');
  check('"C) Hải Phòng" -> key C', (() => { const r = p('C) Hải Phòng'); return r && r.key === 'C'; })(), 'n/a');
  check('"D: Cần Thơ" -> key D', (() => { const r = p('D: Cần Thơ'); return r && r.key === 'D'; })(), 'n/a');
  check('"Không có khoá" -> null', p('Không có khoá') === null, 'n/a');
}

/* ============================================================
 * TEST 10 — Fallback văn bản thuần
 * ============================================================ */
console.log('\n[10] Fallback văn bản thuần');
{
  const html = `<!DOCTYPE html><body><pre>
Câu hỏi về lịch sử ?
A. Một
B. Hai
C. Ba
  </pre></body>`;
  const r = detect(html, { enableTextFallback: true }).result;
  check('tìm được ít nhất 1 câu', r.questions.length >= 1, 'got ' + r.questions.length);
  check('đáp án lấy từ văn bản', r.questions[0] && r.questions[0].options.length >= 2,
    r.questions[0] ? String(r.questions[0].options.length) : 'n/a');
}

/* ============================================================
 * TEST 11 — maxQuestions
 * ============================================================ */
console.log('\n[11] maxQuestions');
{
  let html = '<!DOCTYPE html><body>';
  for (let i = 1; i <= 5; i++) {
    html += `<div class="que"><div class="qtext"><p>Câu ${i}</p></div>
      <input type="radio" name="m${i}"><label for="m${i}a">A${i}</label>
      <input type="radio" name="m${i}"><label for="m${i}b">B${i}</label></div>`;
  }
  html += '</body>';
  const r = detect(html, { maxQuestions: 3 }).result;
  check('giới hạn còn 3 câu', r.questions.length === 3, 'got ' + r.questions.length);
}

/* ============================================================
 * TEST 12 — maxOptionLength / truncate
 * ============================================================ */
console.log('\n[12] Cắt ngắn chuỗi dài');
{
  const w = makeWindow('<!DOCTYPE html><body></body>');
  const long = 'x'.repeat(1000);
  const t = w.QH.detector.truncate(long, 100);
  check('độ dài <= 101 (bao gồm dấu …)', t.length <= 101, 'got ' + t.length);
  check('kết thúc bằng dấu …', /…$/.test(t), 'n/a');
}

/* ============================================================
 * TEST 13 — Radio lẻ (chỉ 1 input) bị bỏ qua
 * ============================================================ */
console.log('\n[13] Radio lẻ bị bỏ qua');
{
  const html = `<!DOCTYPE html><body>
    <div class="que"><div class="qtext"><p>Chỉ một radio</p></div>
      <input type="radio" name="only"><label for="o1">Một</label>
    </div></body>`;
  const r = detect(html).result;
  check('không tạo câu hỏi từ radio lẻ', r.questions.length === 0, 'got ' + r.questions.length);
}

/* ============================================================
 * TEST 14 — Câu hỏi suy ra từ container khi không có selector riêng
 * ============================================================ */
console.log('\n[14] Suy ra câu hỏi từ container');
{
  const html = `<!DOCTYPE html><body>
    <div class="quiz-block">
      <p>Water boils at what temperature in Celsius?</p>
      <input type="radio" name="w1" id="w1"><label for="w1">50</label>
      <input type="radio" name="w1" id="w2"><label for="w2">100</label>
      <input type="radio" name="w1" id="w3"><label for="w3">150</label>
    </div></body>`;
  const r = detect(html).result;
  check('phát hiện 1 câu hỏi', r.questions.length === 1, 'got ' + r.questions.length);
  check('câu hỏi chứa nội dung hỏi',
    r.questions[0] && /boils at what temperature/i.test(r.questions[0].question),
    r.questions[0] ? r.questions[0].question : 'n/a');
}

/* ============================================================
 * TEST 15 — Trang thực tế: Google Forms-like
 * ============================================================ */
console.log('\n[15] Google Forms-like');
{
  const html = `<!DOCTYPE html><body>
    <div class="freebirdFormviewerViewQuestion">
      <div class="freebirdFormviewerViewQuestionTitle" role="heading" aria-level="3">Bạn thích màu nào?</div>
      <div class="freebirdFormviewerViewQuestionContent">
        <div class="freebirdFormviewerViewRadioOption" role="radio"><div id="i1">Đỏ</div></div>
        <div class="freebirdFormviewerViewRadioOption" role="radio"><div id="i2">Xanh</div></div>
        <div class="freebirdFormviewerViewRadioOption" role="radio"><div id="i3">Vàng</div></div>
      </div>
    </div></body>`;
  const r = detect(html).result;
  check('phát hiện được câu hỏi', r.questions.length >= 1, 'got ' + r.questions.length);
}

/* ============================================================
 * KẾT QUẢ
 * ============================================================ */
console.log('\n================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
if (fail) {
  console.log('\nCác mục lỗi:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('Tất cả kiểm thử đạt.');
