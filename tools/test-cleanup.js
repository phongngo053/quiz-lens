/* Kiểm tra cơ chế dọn thư mục tạm */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const cleanup = require('./cleanup');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// 1. Tạo thư mục giả có nội dung (tên phải khớp prefix để cleanupStale nhận ra)
const d = path.join(os.tmpdir(), 'qh-e2e-cleanup-test-' + Date.now());
fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(d, 'a.bin'), Buffer.alloc(1024 * 1024));
check('tao thu muc gia ok', fs.existsSync(d));

// 2. cleanupStale voi maxAge=0 -> phai xoa
const r = cleanup.cleanupStale(0);
check('cleanupStale xoa thu muc vua tao', !fs.existsSync(d), 'freed=' + r.freed);
check('cleanupStale bao cao dung so luong', r.count >= 1, 'count=' + r.count);
check('cleanupStale bao cao dung dung luong', r.freed >= 1024 * 1024, 'freed=' + r.freed);

// 3. track + cleanupNow
const d2 = path.join(os.tmpdir(), 'qh-e2e-cleanup-test2-' + Date.now());
fs.mkdirSync(d2, { recursive: true });
fs.writeFileSync(path.join(d2, 'b.bin'), Buffer.alloc(512 * 1024));
cleanup.track(d2);
const freed = cleanup.cleanupNow(true);
check('cleanupNow xoa thu muc da track', !fs.existsSync(d2), 'freed=' + freed);
check('cleanupNow bao cao dung dung luong', freed >= 512 * 1024, 'freed=' + freed);

// 4. Khong xoa nham thu muc khong lien quan
const keep = path.join(os.tmpdir(), 'khong-dung-xoa-' + Date.now());
fs.mkdirSync(keep, { recursive: true });
cleanup.cleanupStale(0);
check('khong xoa thu muc khong lien quan', fs.existsSync(keep));
fs.rmSync(keep, { recursive: true, force: true });

// 5. Danh sach tien to
check('co tien to ql-vid-', cleanup.PREFIXES.indexOf('ql-vid-') !== -1);
check('co tien to qh-e2e-', cleanup.PREFIXES.indexOf('qh-e2e-') !== -1);

console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
