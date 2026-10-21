/* =============================================================
 * Quiz Lens — Kiểm thử end-to-end với extension THẬT
 * Chạy: node tools/e2e-extension.js
 *
 * Dùng Chromium 129 của Playwright (--load-extension còn hoạt động)
 * để kiểm chứng manifest V3, service worker, content script và UI.
 * ============================================================= */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const cleanup = require('./cleanup');

// Don thu muc tam cua cac lan chay truoc
const stale = cleanup.cleanupStale(2);
if (stale.count) {
  console.log('  Da don ' + stale.count + ' thu muc tam cu (' +
    (stale.freed / 1024 / 1024).toFixed(1) + ' MB)');
}
cleanup.autoCleanup();

const EXT = path.resolve(__dirname, '..');
const CHROMIUM = 'C:\\Users\\ngoti\\AppData\\Local\\ms-playwright\\chromium-1134\\chrome-win\\chrome.exe';
const PORT = 8798;
const DEBUG_PORT = 9334;

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++; failures.push(name + (extra ? ' -> ' + extra : ''));
    console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(EXT, req.url === '/' ? 'test-fixture.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chụp ảnh màn hình.
 * Playwright chờ "fonts loaded" + requestAnimationFrame, nhưng trang có panel
 * fixed đôi khiến bước này treo vô hạn -> dùng CDP trực tiếp làm phương án dự phòng.
 */
async function capture(page, file) {
  try {
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', timeout: 12000 });
    return;
  } catch (e) {
    console.log('    (screenshot qua Playwright bị treo, dùng CDP fallback)');
  }
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  const dir = cleanup.track(path.join(os.tmpdir(), 'qh-e2e-real-' + Date.now()));
  fs.mkdirSync(dir, { recursive: true });

  console.log('Khởi động Chromium với --load-extension...\n');
  const proc = spawn(CHROMIUM, [
    '--user-data-dir=' + dir,
    '--load-extension=' + EXT,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    '--remote-debugging-port=' + DEBUG_PORT,
    'about:blank'
  ], { stdio: 'ignore' });

  await sleep(6000);

  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + DEBUG_PORT);
  const ctx = browser.contexts()[0];
  const errors = [];

  try {
    console.log('[1] Manifest V3 & service worker');
    const targets = await (await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/list')).json();
    const sw = targets.find((t) => t.type === 'service_worker');
    check('service worker đã đăng ký', !!sw, 'không thấy SW');
    check('service worker trỏ đúng file', sw && sw.url.endsWith('/src/background/service-worker.js'),
      sw ? sw.url : 'n/a');
    const extId = sw ? sw.url.split('/')[2] : null;
    console.log('    extension id =', extId);

    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    console.log('\n[2] Trang tuỳ chọn (options page)');
    const optPage = await ctx.newPage();
    const optErrs = [];
    optPage.on('pageerror', (e) => optErrs.push(e.message));
    await optPage.goto('chrome-extension://' + extId + '/src/options/options.html', { waitUntil: 'load' });
    await sleep(1500);
    const opt = await optPage.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : null,
      cards: document.querySelectorAll('.card').length,
      enabled: document.getElementById('enabled') ? document.getElementById('enabled').checked : null,
      mode: document.getElementById('mode') ? document.getElementById('mode').value : null,
      width: document.getElementById('width') ? document.getElementById('width').value : null,
      fields: document.querySelectorAll('input, select, textarea').length
    }));
    console.log('    ' + JSON.stringify(opt));
    check('options page tải được', !!opt.h1, JSON.stringify(opt).slice(0, 120));
    check('tiêu đề đúng', opt.h1 === 'Quiz Lens', opt.h1);
    check('có đủ các khối cài đặt', opt.cards >= 7, 'got ' + opt.cards);
    check('cài đặt mặc định được nạp', opt.enabled === true && opt.mode === 'dock', JSON.stringify(opt));
    check('không có lỗi JS ở options page', optErrs.length === 0, optErrs.slice(0, 2).join(' | '));
    await optPage.screenshot({ path: path.join(EXT, 'docs', 'screenshot-options.png') });
    console.log('    -> đã chụp docs/screenshot-options.png');

    console.log('\n[3] Content script trên trang thử nghiệm');
    await page.goto('http://127.0.0.1:' + PORT + '/test-fixture.html', { waitUntil: 'load' });
    await sleep(3000);

    const host = await page.evaluate(() => !!document.getElementById('qh-panel-host'));
    check('content script đã mount panel', host);

    const summary = await page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      const qs = sr.querySelectorAll('.q');
      return {
        badge: sr.querySelector('.brand-count').textContent.trim(),
        count: qs.length,
        qs: Array.from(qs).map((q) => ({
          text: q.querySelector('.q-text').textContent.trim(),
          opts: Array.from(q.querySelectorAll('.opt')).map((o) => o.querySelector('.opt-key').textContent.trim())
        }))
      };
    });
    console.log('    badge =', summary.badge);
    summary.qs.forEach((q) => console.log('    • ' + q.text + '  [' + q.opts.join('') + ']'));
    check('phát hiện 5 câu hỏi', summary.count === 5, 'got ' + summary.count);
    check('badge "5 câu"', /5 câu/.test(summary.badge), summary.badge);
    check('nhãn A/B/C/D đúng', summary.qs[0] && summary.qs[0].opts.join('') === 'ABCD',
      summary.qs[0] ? summary.qs[0].opts.join(',') : 'n/a');
    check('câu 2 nhận dạng bằng mẫu chữ', summary.qs[1] && /electron/.test(summary.qs[1].text),
      summary.qs[1] ? summary.qs[1].text : 'n/a');
    check('câu 3 nhận dạng <ol type="A">', summary.qs[2] && /Hành tinh Đỏ/.test(summary.qs[2].text),
      summary.qs[2] ? summary.qs[2].text : 'n/a');
    check('câu 3 có 4 đáp án A-D', summary.qs[2] && summary.qs[2].opts.join('') === 'ABCD',
      summary.qs[2] ? summary.qs[2].opts.join(',') : 'n/a');
    check('câu 4 nhận dạng khoá trong thẻ con', summary.qs[3] && /Pháp/.test(summary.qs[3].text),
      summary.qs[3] ? summary.qs[3].text : 'n/a');
    check('câu 4 có 3 đáp án A-C', summary.qs[3] && summary.qs[3].opts.join('') === 'ABC',
      summary.qs[3] ? summary.qs[3].opts.join(',') : 'n/a');
    check('câu 5 nhận dạng câu đã lộ đáp án', summary.qs[4] && /2 \+ 2/.test(summary.qs[4].text),
      summary.qs[4] ? summary.qs[4].text : 'n/a');

    console.log('\n[4] Panel không che vùng đọc');
    const layout = await page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      const d = sr.querySelector('.dock').getBoundingClientRect();
      return {
        mr: document.documentElement.style.marginRight,
        right: d.right, cw: document.documentElement.clientWidth,
        h: d.height, w: d.width, innerH: window.innerHeight
      };
    });
    console.log('    ' + JSON.stringify(layout));
    check('nội dung trang bị đẩy sang trái', layout.mr === '340px', layout.mr);
    check('panel sát mép phải', Math.abs(layout.right - layout.cw) < 3, layout.right + ' vs ' + layout.cw);
    check('panel cao bằng viewport', Math.abs(layout.h - layout.innerH) < 4, 'h=' + layout.h + ' innerH=' + layout.innerH);

    console.log('\n[5] Thu gọn / mở rộng');
    await page.bringToFront();
    const dockWidth = () => page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      return sr.querySelector('.dock').getBoundingClientRect().width;
    });
    const toggleState = () => page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      const d = sr.querySelector('.dock');
      return { w: d.getBoundingClientRect().width, attr: d.getAttribute('data-collapsed'), innerH: window.innerHeight };
    });

    console.log('    trước:', JSON.stringify(await toggleState()));
    await page.evaluate(() => document.getElementById('qh-panel-host').shadowRoot.querySelector('.js-toggle').click());
    // Chờ transition CSS hoàn tất thay vì dùng sleep cố định
    await page.waitForFunction(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      return sr.querySelector('.dock').getBoundingClientRect().width < 60;
    }, { timeout: 8000 }).catch(() => {});
    const collapsed = await toggleState();
    console.log('    sau click 1:', JSON.stringify(collapsed));
    check('thu gọn còn ~46px', collapsed.w < 60, 'w=' + collapsed.w);
    check('data-collapsed=true', collapsed.attr === 'true', collapsed.attr);

    const collapsedMargin = await page.evaluate(() => document.documentElement.style.marginRight);
    check('nội dung trang được thu hồi còn 46px', collapsedMargin === '46px', collapsedMargin);

    await page.evaluate(() => document.getElementById('qh-panel-host').shadowRoot.querySelector('.js-toggle').click());
    // Chờ transition CSS ổn định (width về đúng giá trị cấu hình)
    await page.waitForFunction(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      const d = sr.querySelector('.dock');
      return d.getBoundingClientRect().width >= 339 &&
        d.getBoundingClientRect().width <= 341;
    }, { timeout: 8000 }).catch(() => {});
    const expandedState = await toggleState();
    console.log('    sau click 2:', JSON.stringify(expandedState));
    check('mở rộng lại 340px', Math.abs(expandedState.w - 340) < 2, 'w=' + expandedState.w);
    const expandedMargin = await page.evaluate(() => document.documentElement.style.marginRight);
    check('nội dung trang trở lại 340px', expandedMargin === '340px', expandedMargin);

    console.log('\n[6] Cập nhật tự động khi DOM thay đổi (SPA)');
    await page.click('#addRadio');
    await sleep(1500);
    const afterAdd = await page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      return { n: sr.querySelectorAll('.q').length, badge: sr.querySelector('.brand-count').textContent.trim() };
    });
    console.log('    badge =', afterAdd.badge);
    check('số câu tăng lên 6', afterAdd.n === 6, 'got ' + afterAdd.n);

    console.log('\n[7] Đáp án đã chọn được đánh dấu');
    await page.click('#q-radio input[value="b"]');
    await sleep(1500);
    const sel = await page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      return Array.from(sr.querySelector('.q').querySelectorAll('.opt')).map((o) => o.getAttribute('data-selected'));
    });
    check('đáp án B được đánh dấu', sel[1] === 'true', JSON.stringify(sel));

    console.log('\n[7b] Đáp án do trang tiết lộ được đánh dấu ★');
    const revealed = await page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      const items = Array.from(sr.querySelectorAll('.opt[data-revealed="true"]'));
      return {
        count: items.length,
        key: items[0] ? items[0].getAttribute('data-key') : null,
        label: items[0] ? items[0].textContent.trim() : null
      };
    });
    console.log('    ' + JSON.stringify(revealed));
    check('có đúng 1 đáp án được tiết lộ', revealed.count === 1, 'got ' + revealed.count);
    check('là đáp án B', revealed.key === 'B', String(revealed.key));
    check('có nhãn "đáp án đúng"', /đáp án đúng/.test(revealed.label || ''), revealed.label);

    console.log('\n[8] Đồng bộ cài đặt giữa các tab');
    await optPage.evaluate(() => new Promise((resolve) => {
      chrome.storage.sync.get('qh.settings', (res) => {
        const s = Object.assign({}, res['qh.settings'] || {}, { mode: 'inline' });
        chrome.storage.sync.set({ 'qh.settings': s }, resolve);
      });
    }));
    await sleep(2000);
    const inlineState = await page.evaluate(() => ({
      cards: document.querySelectorAll('[data-qh-inline-card]').length,
      dockHidden: document.getElementById('qh-panel-host').shadowRoot.querySelector('.dock').style.display === 'none'
    }));
    console.log('    ' + JSON.stringify(inlineState));
    check('tab trang áp dụng được cài đặt mới', inlineState.cards >= 5 && inlineState.dockHidden,
      JSON.stringify(inlineState));

    console.log('\n[9] Điều khiển qua service worker (bấm icon extension)');
    const swTarget = (await (await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/list')).json())
      .find((t) => t.type === 'service_worker');
    check('service worker vẫn sống', !!swTarget, 'SW đã chết');

    console.log('\n[10] Không có lỗi JavaScript');
    const realErrors = errors.filter((e) => !/favicon|ERR_FILE|net::|Failed to load resource/i.test(e));
    check('không có lỗi JS trên trang', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

    // Chụp ảnh panel ở chế độ dock
    await optPage.evaluate(() => new Promise((resolve) => {
      chrome.storage.sync.get('qh.settings', (res) => {
        const s = Object.assign({}, res['qh.settings'] || {}, { mode: 'dock' });
        chrome.storage.sync.set({ 'qh.settings': s }, resolve);
      });
    }));
    await sleep(1500);
    await page.bringToFront();
    await capture(page, path.join(EXT, 'docs', 'screenshot-panel.png'));
    console.log('    -> đã chụp docs/screenshot-panel.png');

    // Chụp ảnh chế độ inline
    await optPage.evaluate(() => new Promise((resolve) => {
      chrome.storage.sync.get('qh.settings', (res) => {
        const s = Object.assign({}, res['qh.settings'] || {}, { mode: 'inline' });
        chrome.storage.sync.set({ 'qh.settings': s }, resolve);
      });
    }));
    await sleep(1800);
    await page.bringToFront();
    await capture(page, path.join(EXT, 'docs', 'screenshot-inline.png'));
    console.log('    -> đã chụp docs/screenshot-inline.png');

  } finally {
    await browser.close().catch(() => {});
    try { proc.kill(); } catch (e) {}
    server.close();
  }

  console.log('\n================================');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  if (fail) {
    console.log('\nCác mục lỗi:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('Kiểm thử end-to-end với extension thật ĐẠT.');
})().catch((e) => {
  console.error('\nLỖI:', e);
  server.close();
  process.exit(1);
});
