/* =============================================================
 * Quiz Lens — STYLE CHO PANEL
 * ------------------------------------------------------------
 * Thuộc tính: window.QH.panelStyles
 *
 * Toàn bộ CSS của panel được nạp vào Shadow DOM nên không bị
 * CSS của trang web ghi đè, và ngược lại panel không làm hỏng
 * giao diện trang.
 * ============================================================= */
(function (global) {
  'use strict';

  const QH = (global.QH = global.QH || {});

  const CSS = `
:host {
  all: initial;
  --qh-bg: #11161f;
  --qh-bg-2: #171e2a;
  --qh-bg-3: #1f2836;
  --qh-border: #2a3646;
  --qh-text: #e6edf6;
  --qh-muted: #93a3b8;
  --qh-accent: #4f9cf9;
  --qh-accent-soft: rgba(79, 156, 249, 0.14);
  --qh-ok: #35c98a;
  --qh-warn: #f0b429;
  --qh-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
  --qh-radius: 10px;
  --qh-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --qh-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

:host([data-theme="light"]) {
  --qh-bg: #ffffff;
  --qh-bg-2: #f6f8fb;
  --qh-bg-3: #eceff5;
  --qh-border: #d8dee9;
  --qh-text: #16202e;
  --qh-muted: #5c6b80;
  --qh-accent: #1668dc;
  --qh-accent-soft: rgba(22, 104, 220, 0.1);
  --qh-shadow: 0 8px 30px rgba(20, 35, 60, 0.16);
}

* { box-sizing: border-box; }

.root { font-family: var(--qh-font); color: var(--qh-text); }

/* ---------- DOCK (panel ghim bên cạnh) ---------- */
.dock {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: var(--qh-dock-w, 340px);
  display: flex;
  flex-direction: column;
  background: var(--qh-bg);
  border-left: 1px solid var(--qh-border);
  box-shadow: var(--qh-shadow);
  z-index: 2147483600;
  transition: width .18s ease, transform .18s ease;
}
.dock[data-side="left"] {
  right: auto;
  left: 0;
  border-left: none;
  border-right: 1px solid var(--qh-border);
}

/* trạng thái thu gọn */
.dock[data-collapsed="true"] { width: 46px; }
.dock[data-collapsed="true"] .header-body,
.dock[data-collapsed="true"] .body,
.dock[data-collapsed="true"] .footer { display: none; }
.dock[data-collapsed="true"] .header { justify-content: center; padding: 10px 0; }
.dock[data-collapsed="true"] .brand-text { display: none; }
.dock[data-collapsed="true"] .toggle { transform: rotate(180deg); }

.collapsed-rail {
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
}
.dock[data-collapsed="true"] .collapsed-rail { display: flex; }
.rail-badge {
  background: var(--qh-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
}
.rail-label {
  writing-mode: vertical-rl;
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--qh-muted);
  white-space: nowrap;
}

/* ---------- HEADER ---------- */
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--qh-border);
  background: var(--qh-bg-2);
  flex: 0 0 auto;
}
.brand { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
.brand-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--qh-accent);
  box-shadow: 0 0 0 3px var(--qh-accent-soft);
  flex: 0 0 auto;
}
.brand-text { font-weight: 650; font-size: 13px; letter-spacing: .01em; white-space: nowrap; }
.brand-count {
  font-size: 11px;
  color: var(--qh-muted);
  background: var(--qh-bg-3);
  border: 1px solid var(--qh-border);
  border-radius: 999px;
  padding: 1px 7px;
  white-space: nowrap;
}
.actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }

.icon-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--qh-muted);
  width: 26px; height: 26px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: background .12s, color .12s;
}
.icon-btn:hover { background: var(--qh-bg-3); color: var(--qh-text); }
.icon-btn:focus-visible { outline: 2px solid var(--qh-accent); outline-offset: 1px; }
.toggle { transition: transform .18s ease; }

/* ---------- BODY ---------- */
.body {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 12px 20px;
  scrollbar-width: thin;
  scrollbar-color: var(--qh-border) transparent;
}
.body::-webkit-scrollbar { width: 9px; }
.body::-webkit-scrollbar-thumb { background: var(--qh-border); border-radius: 9px; border: 2px solid var(--qh-bg); }

.empty {
  text-align: center;
  color: var(--qh-muted);
  font-size: 12.5px;
  line-height: 1.6;
  padding: 28px 12px;
  border: 1px dashed var(--qh-border);
  border-radius: var(--qh-radius);
}
.empty strong { display: block; color: var(--qh-text); font-size: 13px; margin-bottom: 6px; }
.empty kbd {
  font-family: var(--qh-mono);
  font-size: 11px;
  background: var(--qh-bg-3);
  border: 1px solid var(--qh-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 1px 5px;
}

/* ---------- CÂU HỎI ---------- */
.q {
  background: var(--qh-bg-2);
  border: 1px solid var(--qh-border);
  border-radius: var(--qh-radius);
  padding: 10px 11px;
  margin-bottom: 10px;
}
.q-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.q-badge {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--qh-accent);
  background: var(--qh-accent-soft);
  border-radius: 4px;
  padding: 2px 6px;
}
.q-src {
  font-size: 10px;
  color: var(--qh-muted);
  font-family: var(--qh-mono);
  opacity: .8;
}
.q-text {
  font-size: 13px;
  line-height: 1.55;
  color: var(--qh-text);
  margin-bottom: 9px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---------- DANH SÁCH ĐÁP ÁN ---------- */
.opts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.opt {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: var(--qh-bg-3);
  color: var(--qh-text);
  word-break: break-word;
}
.opt-key {
  flex: 0 0 auto;
  width: 19px; height: 19px;
  border-radius: 5px;
  background: var(--qh-bg);
  border: 1px solid var(--qh-border);
  color: var(--qh-muted);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.opt-text { flex: 1 1 auto; white-space: pre-wrap; }
.opt[data-selected="true"] {
  border-color: var(--qh-ok);
  background: color-mix(in srgb, var(--qh-ok) 12%, var(--qh-bg-3));
}
.opt[data-selected="true"] .opt-key {
  background: var(--qh-ok);
  border-color: var(--qh-ok);
  color: #06281a;
}
.opt-mark {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: var(--qh-ok);
  font-weight: 600;
  white-space: nowrap;
}

/* Đáp án do trang web đã tiết lộ — độ tin cậy tuyệt đối */
.opt-reveal {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: #fff;
  background: var(--qh-accent);
  border-radius: 4px;
  padding: 1px 5px;
  font-weight: 700;
  white-space: nowrap;
}
.opt[data-revealed="true"] {
  border-color: var(--qh-accent);
  background: var(--qh-accent-soft);
}
.opt[data-revealed="true"] .opt-key {
  background: var(--qh-accent);
  border-color: var(--qh-accent);
  color: #fff;
}

/* ---------- GỢI Ý AI ---------- */
.ai-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--qh-border);
}
.ai-btn {
  appearance: none;
  border: 1px solid var(--qh-border);
  background: var(--qh-bg-3);
  color: var(--qh-text);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 550;
  padding: 4px 9px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s, border-color .12s, opacity .12s;
}
.ai-btn:hover:not(:disabled) { border-color: var(--qh-accent); background: var(--qh-accent-soft); }
.ai-btn:disabled { opacity: .55; cursor: progress; }
.ai-btn.primary { background: var(--qh-accent); border-color: var(--qh-accent); color: #fff; }
.ai-btn.primary:hover:not(:disabled) { filter: brightness(1.1); background: var(--qh-accent); }

.ai-answer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  min-width: 0;
}
.ai-badge {
  flex: 0 0 auto;
  width: 20px; height: 20px;
  border-radius: 5px;
  background: var(--qh-accent);
  color: #fff;
  font-size: 11.5px;
  font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}
.ai-badge[data-conf="high"] { background: var(--qh-ok); color: #06281a; }
.ai-badge[data-conf="low"] { background: var(--qh-warn); color: #3a2a00; }
.ai-reason {
  color: var(--qh-muted);
  font-size: 11px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.ai-error { color: #ff7b72; font-size: 11px; }
.ai-spin {
  width: 12px; height: 12px;
  border: 2px solid var(--qh-border);
  border-top-color: var(--qh-accent);
  border-radius: 50%;
  animation: qh-spin .7s linear infinite;
  flex: 0 0 auto;
}
@keyframes qh-spin { to { transform: rotate(360deg); } }

/* Nút chọn nhanh trong panel: điền đáp án vào trang */
.opt-pick {
  flex: 0 0 auto;
  appearance: none;
  border: 1px solid var(--qh-border);
  background: transparent;
  color: var(--qh-muted);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s;
}
.opt:hover .opt-pick { opacity: 1; }
.opt-pick:hover { border-color: var(--qh-accent); color: var(--qh-accent); }

/* Cảnh báo khi panel có thể che nội dung */
.dock[data-dim="true"] { opacity: .35; }
.dock { transition: width .18s ease, transform .18s ease, opacity .2s ease; }

/* Chế độ đang gõ: panel trong suốt cho chuột để không chặn thao tác */
.dock[data-typing="true"] {
  pointer-events: none;
  opacity: .25;
}

/* ---------- FOOTER ---------- */
.footer {
  flex: 0 0 auto;
  border-top: 1px solid var(--qh-border);
  background: var(--qh-bg-2);
  padding: 7px 12px;
  font-size: 11px;
  color: var(--qh-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.footer a { color: var(--qh-accent); text-decoration: none; cursor: pointer; }
.footer a:hover { text-decoration: underline; }
.footer-time { font-family: var(--qh-mono); font-size: 10px; }

/* ---------- CHẾ ĐỘ INLINE (chèn cạnh khối câu hỏi) ---------- */
.inline-card {
  all: initial;
  font-family: var(--qh-font);
  display: block;
  margin: 10px 0 14px;
  border: 1px solid var(--qh-border);
  border-left: 3px solid var(--qh-accent);
  border-radius: 8px;
  background: var(--qh-bg-2);
  color: var(--qh-text);
  padding: 9px 11px;
  max-width: 720px;
}
.inline-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.inline-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--qh-accent);
}
.inline-count { font-size: 10.5px; color: var(--qh-muted); }
.inline-q {
  font-size: 12.5px;
  line-height: 1.5;
  margin-bottom: 7px;
  color: var(--qh-text);
  white-space: pre-wrap;
}
.inline-opts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 4px;
}
.inline-opt {
  display: flex;
  gap: 7px;
  align-items: flex-start;
  font-size: 12px;
  line-height: 1.45;
  padding: 4px 7px;
  border-radius: 6px;
  background: var(--qh-bg-3);
  word-break: break-word;
}
.inline-opt[data-selected="true"] {
  outline: 1px solid var(--qh-ok);
  background: color-mix(in srgb, var(--qh-ok) 12%, var(--qh-bg-3));
}
.inline-key {
  flex: 0 0 auto;
  font-weight: 700;
  font-size: 11px;
  color: var(--qh-accent);
  min-width: 14px;
}
.inline-opt[data-selected="true"] .inline-key { color: var(--qh-ok); }

/* ---------- TRẠNG THÁI ẨN ---------- */
.hidden { display: none !important; }

/* ---------- RESPONSIVE ---------- */
@media (max-width: 900px) {
  .dock { width: min(var(--qh-dock-w, 340px), 92vw); }
}
`;

  QH.panelStyles = { CSS };
})(typeof window !== 'undefined' ? window : globalThis);
