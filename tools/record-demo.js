/* =============================================================
 * Quiz Lens — Quay video demo (CDP screencast + ffmpeg)
 * Chạy: node tools/record-demo.js
 *
 * Vì sao không dùng recordVideo của Playwright?
 *   Bản Chromium 129 + Playwright 1.64 không ghi được file .webm
 *   (file video bị xoá trước khi copy ra ngoài). Ta tự chụp frame
 *   qua CDP Page.startScreencast rồi ghép bằng ffmpeg — chắc chắn hơn.
 * ============================================================= */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const cleanup = require('./cleanup');

// Don thu muc tam cua cac lan chay truoc (gioi han 2 gio)
const stale = cleanup.cleanupStale(2);
if (stale.count) {
  console.log('  Da don ' + stale.count + ' thu muc tam cu (' +
    (stale.freed / 1024 / 1024).toFixed(1) + ' MB)');
}
cleanup.autoCleanup();

const EXT = path.resolve(__dirname, '..');
const CHROMIUM = 'C:\\Users\\ngoti\\AppData\\Local\\ms-playwright\\chromium-1134\\chrome-win\\chrome.exe';
const FFMPEG = 'C:\\Program Files\\ffmpeg-master-latest-win64-gpl-shared\\bin\\ffmpeg.exe';
const PORT = 8805;
const DBG_PORT = 9357;
const OUT_DIR = path.join(EXT, 'docs');
const FPS = 15;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(EXT, req.url === '/' ? 'test-fixture.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => console.log('  [' + new Date().toISOString().slice(11, 19) + '] ' + m);

/* ------------------------------------------------------------
 * Ghi frame ra file PNG (ffmpeg đọc theo thứ tự tên)
 * ------------------------------------------------------------ */
class FrameWriter {
  constructor(dir) {
    this.dir = dir;
    this.n = 0;
    fs.mkdirSync(dir, { recursive: true });
  }
  write(base64) {
    const f = path.join(this.dir, 'f' + String(this.n++).padStart(5, '0') + '.png');
    fs.writeFileSync(f, Buffer.from(base64, 'base64'));
  }
}

/* ------------------------------------------------------------
 * Overlay chú thích
 * ------------------------------------------------------------ */
const OVERLAY_CSS = `
#demo-caption {
  position:fixed; left:24px; bottom:24px; z-index:2147483647;
  max-width:640px; padding:13px 20px; border-radius:12px;
  background:rgba(9,13,20,.9); border:1px solid rgba(255,255,255,.16);
  box-shadow:0 10px 40px rgba(0,0,0,.55);
  font-family:"Segoe UI",system-ui,sans-serif; color:#eaf1fb;
  font-size:18px; line-height:1.45; pointer-events:none;
  opacity:0; transition:opacity .25s ease;
}
#demo-caption code { background:rgba(255,255,255,.12); padding:1px 5px; border-radius:4px; }
`;

async function makeOverlay(page) {
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(() => {
    const o = document.createElement('div');
    o.id = 'demo-caption';
    document.documentElement.appendChild(o);
    window.__caption = (html) => { o.innerHTML = html; o.style.opacity = '1'; };
    window.__captionHide = () => { o.style.opacity = '0'; };
  });
}

async function caption(page, html, hold = 2200) {
  await page.evaluate((h) => window.__caption(h), html);
  await sleep(hold);
}

async function captionHide(page) {
  await page.evaluate(() => window.__captionHide());
  await sleep(350);
}

/** Đổi cài đặt qua options page (chrome.storage chỉ có trong ngữ cảnh extension). */
async function setMode(context, mode) {
  const list = await (await fetch('http://127.0.0.1:' + DBG_PORT + '/json/list')).json();
  const sw = list.find((t) => t.type === 'service_worker');
  if (!sw) throw new Error('khong thay service worker');
  const extId = sw.url.split('/')[2];

  const opt = await context.newPage();
  await opt.goto('chrome-extension://' + extId + '/src/options/options.html', { waitUntil: 'load' });
  await opt.evaluate((m) => new Promise((resolve) => {
    chrome.storage.sync.get('qh.settings', (res) => {
      const s = Object.assign({}, res['qh.settings'] || {}, { mode: m });
      chrome.storage.sync.set({ 'qh.settings': s }, resolve);
    });
  }), mode);
  await opt.close();
}

/* ------------------------------------------------------------
 * Ghép frame thành video
 * ------------------------------------------------------------ */
function encode(framesDir, outFile) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-framerate', String(FPS),
      '-i', path.join(framesDir, 'f%05d.png'),
      '-c:v', 'libvpx-vp9', '-b:v', '2M', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=1280:720',
      outFile
    ];
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exit ' + code + '\n' + err.split('\n').slice(-8).join('\n')));
    });
    p.on('error', reject);
  });
}

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const framesDir = cleanup.track(path.join(os.tmpdir(), 'ql-frames-' + Date.now()));
  const writer = new FrameWriter(framesDir);

  step('Khoi dong Chromium voi --load-extension');
  const profileDir = cleanup.track(path.join(os.tmpdir(), 'ql-prof-' + Date.now()));
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: CHROMIUM,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--load-extension=' + EXT,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run', '--no-default-browser-check',
      '--window-size=1280,760',
      '--remote-debugging-port=' + DBG_PORT
    ],
    viewport: { width: 1280, height: 720 }
  });
  step('Browser da len');

  for (const p of context.pages()) { try { await p.close(); } catch (_) {} }
  const page = await context.newPage();

  // Bắt đầu screencast
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.startScreencast', {
    format: 'png', quality: 90, everyNthFrame: 1, maxWidth: 1280, maxHeight: 720
  });
  cdp.on('Page.screencastFrame', async (f) => {
    try { writer.write(f.data); } catch (_) {}
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (_) {}
  });
  step('Screencast bat dau');

  try {
    step('Mo trang thu nghiem');
    await page.goto('http://127.0.0.1:' + PORT + '/test-fixture.html', { waitUntil: 'load' });
    await sleep(2800);
    await makeOverlay(page);

    const n = await page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      return sr.querySelectorAll('.q').length;
    });
    step('Panel nhan dien ' + n + ' cau');

    await caption(page,
      '<b style="color:#4f9cf9">Quiz Lens</b> — tự đọc câu hỏi &amp; đáp án trên trang<br>' +
      '<span style="opacity:.8;font-size:15px">Không backend, không gửi dữ liệu đi đâu</span>', 2400);
    await captionHide(page);

    await caption(page,
      'Panel nhận diện <b>' + n + ' câu</b>: radio, mẫu chữ <code>A./B./C.</code>, ' +
      '<code>&lt;ol type="A"&gt;</code>, khoá trong <code>&lt;span&gt;</code>', 2400);
    await captionHide(page);

    await caption(page, 'Nội dung trang được <b>đẩy sang trái</b> để panel không che vùng đọc', 2100);
    await captionHide(page);

    step('Tick dap an');
    await page.click('#q-radio input[value="b"]');
    await sleep(1400);
    await caption(page, 'Tick đáp án → panel tự đánh dấu <b>✓ đã chọn</b>', 2100);
    await captionHide(page);

    step('Cau da lo dap an');
    await page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      for (const q of sr.querySelectorAll('.q')) {
        if (/2 \+ 2/.test(q.textContent)) { q.scrollIntoView({ block: 'center' }); break; }
      }
    });
    await sleep(1100);
    await caption(page,
      'Trang đã lộ đáp án (<code>Đáp án: B</code>) → panel đánh dấu <b style="color:#4f9cf9">★ đáp án đúng</b><br>' +
      '<span style="opacity:.8;font-size:15px">Đối chiếu chính xác tuyệt đối, không cần AI</span>', 2600);
    await captionHide(page);

    step('Them cau hoi (SPA)');
    await page.click('#addRadio');
    await sleep(1400);
    const n2 = await page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      return sr.querySelectorAll('.q').length;
    });
    step('Sau khi them: ' + n2 + ' cau');
    await caption(page, 'Thêm câu hỏi vào trang (SPA) → panel <b>tự cập nhật</b> lên ' + n2 + ' câu', 2100);
    await captionHide(page);

    step('Che do go');
    await page.evaluate(() => {
      const i = document.createElement('input');
      i.id = 'demo-input';
      i.placeholder = 'Nhập câu trả lời ở đây…';
      i.style.cssText = 'display:block;margin:16px 0;padding:10px 12px;width:320px;' +
        'background:#1c2532;border:1px solid #2f3b4d;border-radius:8px;color:#dbe4ef;font-size:14px';
      document.getElementById('host').appendChild(i);
      i.focus();
    });
    await sleep(1300);
    const typing = await page.evaluate(() => {
      const sr = document.getElementById('qh-panel-host').shadowRoot;
      const d = sr.querySelector('.dock');
      return { typing: d.getAttribute('data-typing'), pe: getComputedStyle(d).pointerEvents };
    });
    step('Che do go: ' + JSON.stringify(typing));
    await caption(page,
      'Đang gõ chữ → panel <b>mờ đi, không bắt chuột</b> và tự thu gọn<br>' +
      '<span style="opacity:.8;font-size:15px">Không che, không chặn thao tác gõ</span>', 2600);
    await captionHide(page);
    await page.evaluate(() => {
      const i = document.getElementById('demo-input');
      if (i) i.remove();
      if (document.activeElement) document.activeElement.blur();
    });
    await sleep(1000);

    step('Thu gon / mo rong');
    await page.evaluate(() => document.getElementById('qh-panel-host').shadowRoot.querySelector('.js-toggle').click());
    await sleep(1300);
    await caption(page, 'Thu gọn panel còn <b>46px</b> — gọn cho trang', 1900);
    await page.evaluate(() => document.getElementById('qh-panel-host').shadowRoot.querySelector('.js-toggle').click());
    await sleep(1300);
    await captionHide(page);

    step('Che do inline');
    await setMode(context, 'inline');
    await sleep(1900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(800);
    const inline = await page.evaluate(() => document.querySelectorAll('[data-qh-inline-card]').length);
    step('Card inline: ' + inline);
    await caption(page,
      'Chế độ <b>inline</b> — bảng đáp án chèn ngay cạnh từng câu hỏi trong trang', 2400);
    await captionHide(page);

    step('Ket thuc');
    await setMode(context, 'dock');
    await sleep(1900);
    await caption(page,
      '<b style="color:#4f9cf9">Quiz Lens</b> — Manifest V3 · Chrome/Edge · 100% cục bộ<br>' +
      '<span style="opacity:.85;font-size:15px">github.com/phongngo053/quiz-lens</span>', 3000);

  } catch (e) {
    console.error('LOI TRONG QUAY:', e.message);
  }

  step('Dung screencast');
  try { await cdp.send('Page.stopScreencast'); } catch (_) {}
  await sleep(800);

  step('Frame: ' + writer.n);
  await context.close().catch(() => {});

  if (writer.n < 10) {
    console.error('Khong du frame (' + writer.n + ')');
    server.close();
    process.exit(1);
  }

  step('Ghep video bang ffmpeg...');
  const out = path.join(OUT_DIR, 'demo-quiz-lens.webm');
  try {
    await encode(framesDir, out);
    step('Video: ' + out + ' (' + (fs.statSync(out).size / 1024 / 1024).toFixed(2) + ' MB)');
  } catch (e) {
    console.error('Loi ffmpeg:', e.message);
    server.close();
    process.exit(1);
  }

  try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch (_) {}

  server.close();
  step('Xong');
  process.exit(0);
})().catch((e) => {
  console.error('LOI:', e);
  server.close();
  process.exit(1);
}).finally(() => {
  // Dam bao don thu muc tam ke ca khi loi
  cleanup.cleanupNow();
});
