/* =============================================================
 * Quiz Lens — Bộ test cho lớp giao diện (panel + inline)
 * Chạy:  node tools/test-panel.js
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
  const dom = new JSDOM(html || '<!DOCTYPE html><body><div id="c"></div></body>', {
    pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://example.test/'
  });
  const w = dom.window;
  ['src/content/config.js', 'src/content/panel-styles.js', 'src/content/panel.js', 'src/content/inline.js']
    .forEach((f) => w.eval(fs.readFileSync(path.join(EXT, f), 'utf8')));
  return w;
}

/* ============================================================
 * TEST 1 — Panel tạo và render
 * ============================================================ */
console.log('\n[1] Panel render');
{
  const w = boot();
  const settings = Object.assign({}, w.QH.config.defaults);
  w.QH.panel.create(settings);

  check('host được gắn vào document', !!w.document.getElementById('qh-panel-host'));
  check('dùng Shadow DOM', !!w.document.getElementById('qh-panel-host').shadowRoot);

  const data = {
    questions: [
      {
        id: 'q1', question: 'Câu hỏi một?', source: 'input', confidence: 0.9,
        options: [
          { key: 'A', label: '', text: 'Hà Nội', selected: false },
          { key: 'B', label: '', text: 'Đà Nẵng', selected: true },
          { key: 'C', label: '', text: 'Hải Phòng', selected: false }
        ]
      }
    ]
  };
  w.QH.panel.render(data, settings);

  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  const body = sr.querySelector('.body');
  check('render 1 khối câu hỏi', body.querySelectorAll('.q').length === 1,
    'got ' + body.querySelectorAll('.q').length);
  check('render 3 đáp án', body.querySelectorAll('.opt').length === 3,
    'got ' + body.querySelectorAll('.opt').length);
  check('hiển thị nội dung câu hỏi', /Câu hỏi một\?/.test(body.textContent));
  check('hiển thị nội dung đáp án', /Hà Nội/.test(body.textContent));
  check('đánh dấu đáp án đã chọn',
    body.querySelectorAll('.opt[data-selected="true"]').length === 1,
    'got ' + body.querySelectorAll('.opt[data-selected="true"]').length);
  check('badge số câu cập nhật', /1 câu/.test(sr.querySelector('.brand-count').textContent),
    sr.querySelector('.brand-count').textContent);
}

/* ============================================================
 * TEST 2 — Thu gọn / mở rộng
 * ============================================================ */
console.log('\n[2] Thu gọn / mở rộng');
{
  const w = boot();
  const settings = Object.assign({}, w.QH.config.defaults);
  w.QH.panel.create(settings);
  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  const dock = sr.querySelector('.dock');

  check('mặc định mở rộng', dock.getAttribute('data-collapsed') === 'false');

  w.QH.panel.setCollapsed(true);
  check('thu gọn -> data-collapsed=true', dock.getAttribute('data-collapsed') === 'true');

  w.QH.panel.setCollapsed(false);
  check('mở rộng -> data-collapsed=false', dock.getAttribute('data-collapsed') === 'false');

  check('nút toggle tồn tại', !!sr.querySelector('.js-toggle'));
  sr.querySelector('.js-toggle').dispatchEvent(new w.Event('click'));
  check('bấm toggle -> thu gọn', dock.getAttribute('data-collapsed') === 'true');
  sr.querySelector('.js-toggle').dispatchEvent(new w.Event('click'));
  check('bấm toggle lần 2 -> mở rộng', dock.getAttribute('data-collapsed') === 'false');
}

/* ============================================================
 * TEST 3 — Chế độ, cạnh, bề rộng, theme
 * ============================================================ */
console.log('\n[3] Chế độ hiển thị');
{
  const w = boot();
  const settings = Object.assign({}, w.QH.config.defaults);
  w.QH.panel.create(settings);
  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  const dock = sr.querySelector('.dock');

  w.QH.panel.setMode('inline');
  check('mode inline -> ẩn dock', dock.style.display === 'none', 'got "' + dock.style.display + '"');

  w.QH.panel.setMode('dock');
  check('mode dock -> hiện dock', dock.style.display !== 'none');

  w.QH.panel.setSide('left');
  check('side left', dock.getAttribute('data-side') === 'left');
  w.QH.panel.setSide('right');
  check('side right', dock.getAttribute('data-side') === 'right');

  w.QH.panel.setWidth(420);
  check('set width ghi vào CSS var',
    dock.style.getPropertyValue('--qh-dock-w').indexOf('420') !== -1,
    dock.style.getPropertyValue('--qh-dock-w'));

  w.QH.panel.setTheme('light');
  check('theme light', w.document.getElementById('qh-panel-host').getAttribute('data-theme') === 'light');
  w.QH.panel.setTheme('dark');
  check('theme dark', w.document.getElementById('qh-panel-host').getAttribute('data-theme') === 'dark');
}

/* ============================================================
 * TEST 4 — Đẩy nội dung trang (không che vùng đọc)
 * ============================================================ */
console.log('\n[4] Đẩy nội dung trang');
{
  const w = boot();
  w.QH.panel.create(Object.assign({}, w.QH.config.defaults));
  const html = w.document.documentElement;

  w.QH.panel.setPushContent(true, 'right', 340);
  check('bật -> margin-right = 340px', html.style.marginRight === '340px', html.style.marginRight);

  w.QH.panel.setPushContent(false, 'right', 340);
  check('tắt -> margin-right rỗng', html.style.marginRight === '', '"' + html.style.marginRight + '"');

  w.QH.panel.setPushContent(true, 'left', 300);
  check('side left -> margin-left = 300px', html.style.marginLeft === '300px', html.style.marginLeft);
}

/* ============================================================
 * TEST 5 — Chèn inline cạnh câu hỏi
 * ============================================================ */
console.log('\n[5] Chèn inline');
{
  const html = `<!DOCTYPE html><body><div class="q" id="q1">
      <p class="q-title">Câu hỏi?</p>
      <p>A. Một</p><p>B. Hai</p>
    </div></body>`;
  const w = boot(html);

  const questions = [{
    id: 'q1', question: 'Câu hỏi?', source: 'keyed-text',
    options: [
      { key: 'A', text: 'Một', selected: false, element: w.document.querySelectorAll('#q1 p')[1] },
      { key: 'B', text: 'Hai', selected: false, element: w.document.querySelectorAll('#q1 p')[2] }
    ]
  }];

  const n = w.QH.inline.render(questions, w.QH.config.defaults);
  check('chèn 1 card inline', n === 1, 'got ' + n);

  const card = w.document.querySelector('[data-qh-inline-card]');
  check('card nằm trong light DOM', !!card);
  check('card có class qh-inline-card', !!w.document.querySelector('.qh-inline-card'));
  check('card chứa nội dung câu hỏi', card && /Câu hỏi\?/.test(card.textContent));
  check('card chứa 2 đáp án', card && card.querySelectorAll('.qh-inline-opt').length === 2,
    card ? String(card.querySelectorAll('.qh-inline-opt').length) : 'n/a');

  // Vị trí: card phải nằm sau phần tử đáp án cuối
  const last = w.document.querySelectorAll('#q1 p')[2];
  check('card được chèn ngay sau đáp án cuối', last.nextElementSibling === card);

  // Dọn dẹp
  w.QH.inline.clear();
  check('clear() xoá hết card', w.document.querySelectorAll('[data-qh-inline-card]').length === 0);
}

/* ============================================================
 * TEST 6 — Không tạo card trùng khi render lại
 * ============================================================ */
console.log('\n[6] Render lại không nhân bản');
{
  const w = boot('<!DOCTYPE html><body><div id="q1"><p>A. Một</p><p>B. Hai</p></div></body>');
  const ps = w.document.querySelectorAll('#q1 p');
  const questions = [{
    id: 'q1', question: 'Q?', source: 'keyed-text',
    options: [
      { key: 'A', text: 'Một', selected: false, element: ps[0] },
      { key: 'B', text: 'Hai', selected: false, element: ps[1] }
    ]
  }];
  w.QH.inline.render(questions, w.QH.config.defaults);
  w.QH.inline.render(questions, w.QH.config.defaults);
  check('vẫn chỉ có 1 card', w.document.querySelectorAll('[data-qh-inline-card]').length === 1,
    'got ' + w.document.querySelectorAll('[data-qh-inline-card]').length);
}

/* ============================================================
 * TEST 7 — Renders an toàn (chống XSS)
 * ============================================================ */
console.log('\n[7] An toàn nội dung');
{
  const w = boot();
  w.QH.panel.create(w.QH.config.defaults);
  w.QH.panel.render({
    questions: [{
      id: 'q1', question: '<img src=x onerror=alert(1)>', source: 'input',
      options: [{ key: 'A', text: '<script>alert(2)<\/script>', selected: false }]
    }]
  }, w.QH.config.defaults);

  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  check('không tạo thẻ img từ nội dung câu hỏi', sr.querySelectorAll('img').length === 0,
    'got ' + sr.querySelectorAll('img').length);
  check('không tạo thẻ script từ nội dung đáp án', sr.querySelectorAll('script').length === 0);
  check('nội dung hiển thị dạng text thô', sr.querySelector('.q-text').textContent.includes('<img'));
}

/* ============================================================
 * TEST 8 — Panel rỗng
 * ============================================================ */
console.log('\n[8] Không có câu hỏi');
{
  const w = boot();
  w.QH.panel.create(w.QH.config.defaults);
  w.QH.panel.render({ questions: [] }, w.QH.config.defaults);
  const sr = w.document.getElementById('qh-panel-host').shadowRoot;
  check('hiện thông báo rỗng', !!sr.querySelector('.empty'));
  check('badge là 0 câu', /0 câu/.test(sr.querySelector('.brand-count').textContent));
}

/* ============================================================
 * TEST 9 — Destroy
 * ============================================================ */
console.log('\n[9] Dọn dẹp');
{
  const w = boot();
  w.QH.panel.create(w.QH.config.defaults);
  check('host tồn tại trước khi destroy', !!w.document.getElementById('qh-panel-host'));
  w.QH.panel.destroy();
  check('host bị gỡ sau destroy', !w.document.getElementById('qh-panel-host'));
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
