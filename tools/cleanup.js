/* =============================================================
 * Quiz Lens — Dọn thư mục tạm
 * ------------------------------------------------------------
 * Các script kiểm thử tạo profile Chromium + frame PNG trong %TEMP%.
 * Nếu không dọn, mỗi lần chạy ăn ~10-20 MB và tích luỹ nhanh.
 *
 * Dùng:
 *   const cleanup = require('./cleanup');
 *   cleanup.track(dir);           // đánh dấu thư mục cần xoá
 *   cleanup.cleanupNow();         // xoá ngay (gọi trong finally)
 *   cleanup.cleanupStale(maxAgeH);// xoá thư mục cũ của các lần chạy trước
 * ============================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/* Tiền tố thư mục tạm do các script này tạo */
const PREFIXES = [
  'ql-vid-', 'ql-frames-', 'ql-prof-', 'ql-video-', 'ql-edge-',
  'qh-e2e-', 'qh-dbg-', 'qh-shot-', 'qh-dev-', 'qh-probe', 'qh-b-',
  'qh-c129-', 'qh-hl-', 'qh-real', 'qh-tog-', 'qh-bcdp-', 'qh-edge-'
];

const tracked = new Set();

/** Đánh dấu một thư mục để xoá khi kết thúc. */
function track(dir) {
  if (dir) tracked.add(dir);
  return dir;
}

/** Xoá các thư mục đã đánh dấu. */
function cleanupNow(verbose) {
  let freed = 0;
  tracked.forEach((dir) => {
    try {
      const size = dirSize(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      freed += size;
    } catch (e) {
      if (verbose) console.error('  [cleanup] khong xoa duoc ' + dir + ': ' + e.message);
    }
  });
  tracked.clear();
  return freed;
}

function dirSize(dir) {
  try {
    let total = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          try { total += fs.statSync(p).size; } catch (_) {}
        }
      }
    };
    walk(dir);
    return total;
  } catch (_) { return 0; }
}

/**
 * Xoá thư mục tạm cũ của các lần chạy trước.
 * @param {number} maxAgeHours tuổi tối đa được giữ (mặc định 2 giờ)
 */
function cleanupStale(maxAgeHours) {
  const maxAge = (maxAgeHours === undefined ? 2 : maxAgeHours) * 3600 * 1000;
  const now = Date.now();
  const tmp = os.tmpdir();
  let count = 0;
  let freed = 0;

  let entries = [];
  try { entries = fs.readdirSync(tmp, { withFileTypes: true }); } catch (_) { return { count: 0, freed: 0 }; }

  entries.forEach((e) => {
    if (!e.isDirectory()) return;
    if (!PREFIXES.some((p) => e.name.startsWith(p))) return;

    const full = path.join(tmp, e.name);
    let st;
    try { st = fs.statSync(full); } catch (_) { return; }
    if (now - st.mtimeMs < maxAge) return;

    const size = dirSize(full);
    try {
      fs.rmSync(full, { recursive: true, force: true });
      count++;
      freed += size;
    } catch (_) { /* bỏ qua */ }
  });

  return { count, freed };
}

/** Gắn xoá tự động khi tiến trình kết thúc (kể cả khi bị kill). */
function autoCleanup() {
  const run = () => { try { cleanupNow(); } catch (_) {} };
  process.on('exit', run);
  process.on('SIGINT', () => { run(); process.exit(130); });
  process.on('SIGTERM', () => { run(); process.exit(143); });
}

module.exports = { track, cleanupNow, cleanupStale, autoCleanup, PREFIXES };
