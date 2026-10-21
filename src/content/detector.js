/* =============================================================
 * Quiz Lens — LỚP PHÁT HIỆN CÂU HỎI & ĐÁP ÁN
 * ------------------------------------------------------------
 * Thuộc tính: window.QH.detector
 *
 * detect(root, settings) -> {
 *   questions: [{
 *     id, question, source, confidence,
 *     options: [{ key, label, text, selected, element }]
 *   }]
 * }
 *
 * Chiến lược phát hiện (theo thứ tự ưu tiên):
 *   A. Nhóm input[type=radio|checkbox]  -> dựng nhóm từ input
 *   B. Nhóm đáp án gắn nhãn A./B./C.   -> dựng nhóm từ mẫu chữ
 *   C. Phân tích văn bản fallback       -> quét text toàn trang
 * ============================================================= */
(function (global) {
  'use strict';

  const QH = (global.QH = global.QH || {});
  const H = () => QH.config.heuristics;

  /* ============================================================
   * TIỆN ÍCH
   * ============================================================ */

  const NBSP = /[\u00a0\u2007\u202f]/g;

  function normalize(text) {
    if (!text) return '';
    return String(text)
      .replace(NBSP, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /** Cắt ngắn nhưng không cắt giữa chữ (bỏ chữ cái cuối dính ký tự lạ). */
  function truncate(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
  }

  /**
   * Một số môi trường (ví dụ jsdom khi chạy test) không có layout engine:
   * getClientRects() luôn trả về mảng rỗng. Khi đó ta chỉ dựa vào CSS.
   */
  let _layoutAvailable = null;
  function layoutAvailable() {
    if (_layoutAvailable === null) {
      try {
        _layoutAvailable = !!document.documentElement.getClientRects().length;
      } catch (e) {
        _layoutAvailable = false;
      }
    }
    return _layoutAvailable;
  }

  /** Kiểm tra phần tử có đang hiển thị hay không. */
  function isVisible(el) {
    if (!el) return false;
    if (el.hidden) return false;
    const style = global.getComputedStyle ? global.getComputedStyle(el) : null;
    if (style) {
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.opacity !== '' && parseFloat(style.opacity) === 0) return false;
    }
    if (!layoutAvailable()) return true;   // không có layout -> tin CSS
    const rects = el.getClientRects();
    if (!rects || rects.length === 0) return false;
    return true;
  }

  /** Lấy text đã chuẩn hoá của phần tử. */
  function textOf(el) {
    if (!el) return '';
    let raw = '';
    if (typeof el.innerText === 'string' && el.innerText.trim()) raw = el.innerText;
    else raw = el.textContent || '';
    return normalize(raw);
  }

  /**
   * Lấy text của container nhưng loại bỏ các node con được đánh dấu.
   * Dùng để suy ra "phần câu hỏi" = text của container trừ text của các đáp án.
   */
  function textExcluding(container, markAttr) {
    if (!container) return '';
    const clone = container.cloneNode(true);
    clone.querySelectorAll(`[${markAttr}]`).forEach((n) => n.remove());
    H().ignoreSelectors.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((n) => n.remove());
    });
    return normalize(clone.textContent || '');
  }

  /** Gán nhãn tạm để đánh dấu node trong DOM (dùng để clone loại trừ). */
  let markCounter = 0;
  function markNodes(nodes) {
    const attr = 'data-qh-opt-mark';
    const id = 'm' + (++markCounter);
    nodes.forEach((n) => n.setAttribute(attr, id));
    return attr;
  }
  function unmarkNodes(attr) {
    document.querySelectorAll(`[${attr}]`).forEach((n) => n.removeAttribute(attr));
  }

  /** Tìm phần tử cha gần nhất chứa đủ đáp án, dừng khi gặp quá nhiều input. */
  function climbToGroupContainer(inputEl, radioLike) {
    const MAX = 40;               // trần số input trong một nhóm hợp lý
    let node = inputEl.parentElement;
    let depth = 0;

    while (node && depth < 12) {
      const cnt = node.querySelectorAll(radioLike).length;
      // Lấy container "chặt" nhất chứa >= 2 input
      if (cnt >= 2 && cnt <= MAX) return node;
      if (cnt > MAX) break; // đã lên tới container bao trùm cả trang
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  /** Tìm ảnh chung nhất của một danh sách phần tử. */
  function commonAncestor(elements) {
    if (!elements.length) return null;
    let node = elements[0];
    while (node) {
      if (elements.every((el) => node.contains(el))) return node;
      node = node.parentElement;
    }
    return document.body;
  }

  /** Tìm text câu hỏi trong container theo heuristic selector. */
  function findQuestionElement(container, settings) {
    const sels = (settings && settings.questionSelectors) || H().questionSelectors;
    const deep = settings ? settings.deepSearch !== false : true;
    for (const sel of sels) {
      let found;
      try { found = queryOneDeep(container, sel, deep); } catch (e) { continue; }
      if (found && found !== container) {
        const t = textOf(found);
        if (t) return { element: found, text: t };
      }
    }
    return null;
  }

  /**
   * Xác định "phạm vi" chứa cả câu hỏi lẫn nhóm đáp án.
   *
   * Vấn đề thực tế: nhiều website đặt phần câu hỏi là ANH EM của container đáp án
   * (ví dụ Moodle: .qtext nằm ngoài .answer). Vì vậy ta leo lên các cấp cha
   * cho tới khi tìm được câu hỏi, hoặc tới khi phần text còn lại đủ dài
   * để coi là câu hỏi.
   *
   * @returns {{scope: Element, question: string, questionEl: Element|null}}
   */
  function resolveScope(groupContainer, optionElements, settings) {
    const maxUp = 6;
    let scope = groupContainer;
    let fallback = null;

    for (let i = 0; i <= maxUp; i++) {
      if (!scope || scope === document.body) break;

      // 1) Có element câu hỏi theo selector?
      const qEl = findQuestionElement(scope, settings);
      if (qEl && qEl.text && qEl.text.length >= 3) {
        return { scope, question: qEl.text, questionEl: qEl.element };
      }

      // 2) Không có selector khớp -> thử suy ra từ text còn lại sau khi bỏ đáp án
      const attr = markNodes(optionElements.filter(Boolean));
      const rest = textExcluding(scope, attr);
      unmarkNodes(attr);

      if (rest && rest.length >= 5) {
        // Ghi nhớ phạm vi hẹp nhất có nội dung, nhưng ưu tiên leo tiếp nếu cha có
        // element câu hỏi rõ ràng hơn
        if (!fallback) fallback = { scope, question: rest, questionEl: null };
      }

      scope = scope.parentElement;
    }

    return fallback || { scope: groupContainer, question: '', questionEl: null };
  }

  /* ============================================================
   * PHÂN TÍCH TIỀN TỐ KHOÁ ĐÁP ÁN (A. / (A) / A) / A: )
   * ============================================================ */

  const KEY_RE = /^\s*[\(\[]?\s*([A-Ha-h])\s*[\)\]]?\s*(?:[\.\:]\s*|[\-–—]\s+|\s+)(?=\S)/;

  /** Khoá đứng một mình trong thẻ con: "A.", "(B)", "C)" — không kèm nội dung. */
  const KEY_ONLY_RE = /^\s*[\(\[]?\s*([A-Ha-h])\s*[\)\]]?\s*[\.\:]?\s*$/;

  function parseKeyPrefix(text) {
    if (!text) return null;
    const m = KEY_RE.exec(text);
    if (!m) return null;
    const key = m[1].toUpperCase();
    const rest = text.slice(m[0].length).trim();
    return { key, rest, matchedLength: m[0].length };
  }

  /** Chỉ nhận khoá, không nhận nội dung (dùng cho thẻ khoá riêng). */
  function parseKeyOnly(text) {
    if (!text) return null;
    const m = KEY_ONLY_RE.exec(text);
    if (!m) return null;
    return { key: m[1].toUpperCase(), rest: '' };
  }

  /* ============================================================
   * CHIẾN LƯỢC A — NHÓM TỪ INPUT RADIO / CHECKBOX
   * ============================================================ */

  function collectOptionLabel(input) {
    // 1) <label for="id">
    if (input.id) {
      const lab = queryOneDeep(document, `label[for="${cssEscape(input.id)}"]`, true);
      if (lab) {
        const t = textOf(lab);
        if (t) return { element: lab, text: t };
      }
    }
    // 2) label cha
    const parentLabel = input.closest('label');
    if (parentLabel) {
      const t = textOf(parentLabel);
      if (t) return { element: parentLabel, text: t };
    }
    // 3) div/span cha liền kề chứa text
    const sib = input.parentElement;
    if (sib) {
      const t = textOf(sib);
      if (t) return { element: sib, text: t };
    }
    // 4) ông bà bậc 2
    const gp = sib && sib.parentElement;
    if (gp) {
      const t = textOf(gp);
      if (t && t.length <= 400) return { element: gp, text: t };
    }
    return { element: input, text: normalize(input.value) || '' };
  }

  function cssEscape(value) {
    if (global.CSS && typeof global.CSS.escape === 'function') return global.CSS.escape(value);
    return String(value).replace(/([^\w-])/g, '\\$1');
  }

  function detectFromInputs(root, settings) {
    const radioLike = 'input[type="radio"], input[type="checkbox"]';
    const inputs = queryAllDeep(root, radioLike, settings.deepSearch !== false).filter((el) => {
      if (settings.includeHidden) return true;
      if (isVisible(el)) return true;
      // Radio ẩn bằng CSS thường có label hiện -> kiểm tra label
      const lab = el.id ? document.querySelector(`label[for="${cssEscape(el.id)}"]`) : el.closest('label');
      return !!(lab && isVisible(lab));
    });

    if (!inputs.length) return [];

    /* ---------------------------------------------------------
     * Gom nhóm.
     * Ưu tiên 1: radio cùng `name` -> cùng một câu hỏi (tín hiệu mạnh nhất).
     * Ưu tiên 2: container DOM gần nhất chứa >= 2 input.
     * --------------------------------------------------------- */
    const byName = new Map();
    const nameless = [];

    inputs.forEach((input) => {
      const name = input.getAttribute('name');
      if (name && input.type === 'radio') {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(input);
      } else {
        nameless.push(input);
      }
    });

    const groups = [];   // { container, inputs }
    const used = new Set();

    // Nhóm theo name (radio)
    byName.forEach((list) => {
      if (list.length < 2) return; // radio lẻ không phải nhóm câu hỏi
      const container = commonAncestor(list.map((i) => i.parentElement).filter(Boolean));
      groups.push({ container: container || list[0].parentElement, inputs: list });
      list.forEach((i) => used.add(i));
    });

    // Nhóm theo container cho phần còn lại (checkbox, radio không có name)
    const byContainer = new Map();
    nameless.forEach((input) => {
      if (used.has(input)) return;
      const container = climbToGroupContainer(input, radioLike);
      if (!container) return;
      if (!byContainer.has(container)) byContainer.set(container, []);
      byContainer.get(container).push(input);
    });
    byContainer.forEach((list, container) => {
      if (list.length < 2) return;
      groups.push({ container, inputs: list });
      list.forEach((i) => used.add(i));
    });

    /* ---------------------------------------------------------
     * Dựng kết quả cho từng nhóm
     * --------------------------------------------------------- */
    const questions = [];

    groups.forEach((group) => {
      const inputList = group.inputs;
      const container = group.container;
      if (!container) return;

      const opts = inputList.map((input, idx) => {
        const { element, text } = collectOptionLabel(input);
        const parsed = parseKeyPrefix(text);
        return {
          key: parsed ? parsed.key : String.fromCharCode(65 + idx),
          text: parsed && settings.stripKeyPrefix ? parsed.rest : text,
          rawText: text,
          selected: !!input.checked,
          element,
          input
        };
      });

      // Loại bỏ đáp án rỗng
      const clean = opts.filter((o) => o.text && o.text.length > 0);
      if (clean.length < (settings.minOptions || 2)) return;

      // Câu hỏi: tìm trong phạm vi rộng hơn container đáp án
      const scope = resolveScope(container, clean.map((o) => o.element), settings);
      let question = scope.question;
      question = truncate(question, settings.maxQuestionLength || 1200);

      if (!question || question.length < 3) return;

      questions.push({
        question,
        options: clean.map((o) => ({
          key: o.key,
          label: o.label || '',
          text: truncate(o.text, settings.maxOptionLength || 600),
          selected: o.selected,
          element: o.element
        })),
        source: 'input',
        confidence: 0.9,
        scope: scope.scope
      });
    });

    return questions;
  }

  /* ============================================================
   * CHIẾN LƯỢC A2 — NHÓM THEO VAI TRÒ ARIA (role=radio / option)
   * ------------------------------------------------------------
   * Google Forms, Moodle mới và nhiều SPA dùng div[role="radio"]
   * thay vì input[type=radio] thật.
   * ============================================================ */

  const ROLE_SELECTOR = '[role="radio"], [role="option"], [role="checkbox"], [role="menuitemradio"]';

  function detectFromRoleElements(root, settings) {
    const nodes = queryAllDeep(root, ROLE_SELECTOR, settings.deepSearch !== false).filter((el) => {
      if (settings.includeHidden) return true;
      return isVisible(el);
    });
    if (nodes.length < (settings.minOptions || 2)) return [];

    // Gom nhóm theo container cha gần nhất chứa >= 2 phần tử cùng vai trò
    const byContainer = new Map();
    nodes.forEach((el) => {
      let container = null;
      let node = el.parentElement;
      let depth = 0;
      while (node && depth < 8) {
        const cnt = node.querySelectorAll(ROLE_SELECTOR).length;
        if (cnt >= 2 && cnt <= 40) { container = node; break; }
        if (cnt > 40) break;
        node = node.parentElement;
        depth++;
      }
      if (!container) return;
      if (!byContainer.has(container)) byContainer.set(container, []);
      byContainer.get(container).push(el);
    });

    const questions = [];

    byContainer.forEach((list, container) => {
      if (list.length < (settings.minOptions || 2)) return;

      // Tránh trùng với nhóm đã xử lý bởi chiến lược input
      const hasRealInput = list.some((el) => el.querySelector('input[type="radio"], input[type="checkbox"]'));
      if (hasRealInput) return;

      const opts = list.map((el, idx) => {
        const parsed = parseKeyPrefix(textOf(el));
        return {
          key: parsed ? parsed.key : String.fromCharCode(65 + idx),
          text: parsed && settings.stripKeyPrefix ? parsed.rest : textOf(el),
          selected: el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true',
          element: el
        };
      });

      const clean = opts.filter((o) => o.text && o.text.length > 0);
      if (clean.length < (settings.minOptions || 2)) return;

      const scope = resolveScope(container, clean.map((o) => o.element), settings);
      let question = truncate(scope.question, settings.maxQuestionLength || 1200);
      if (!question || question.length < 3) return;

      questions.push({
        question,
        options: clean.map((o) => ({
          key: o.key,
          label: o.label || '',
          text: truncate(o.text, settings.maxOptionLength || 600),
          selected: o.selected,
          element: o.element
        })),
        source: 'aria',
        confidence: 0.85,
        scope: scope.scope
      });
    });

    return questions;
  }

  /* ============================================================
   * CHIẾN LƯỢC B — NHÓM ĐÁP ÁN THEO MẪU "A. / B. / C."
   * ------------------------------------------------------------
   * Thu thập ứng viên từ nhiều dạng trình bày:
   *   1. Text trực tiếp của node:            <p>A. Hà Nội</p>
   *   2. Khoá nằm trong thẻ con đầu tiên:    <div><span>A.</span> Hà Nội</div>
   *   3. <ol type="A"> / <ul type="A">:        <ol type="A"><li>Hà Nội</li></ol>
   *   4. Ô bảng:                             <td>A. Hà Nội</td>
   * ============================================================ */

  /** Text trực tiếp của node (không tính text của các thẻ con). */
  function directText(node) {
    return Array.from(node.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.nodeValue)
      .join(' ')
      .trim();
  }

  /**
   * Thử lấy khoá từ thẻ con đầu tiên.
   * Ví dụ: <div><span class="key">A.</span><span>Hà Nội</span></div>
   */
  function keyFromFirstChild(node) {
    const child = node.children && node.children[0];
    if (!child) return null;
    if (!['SPAN', 'B', 'STRONG', 'I', 'EM', 'SUP', 'SMALL', 'MARK'].includes(child.tagName)) return null;

    const childText = directText(child);
    // Thẻ khoá chỉ chứa khoá ("A.") hoặc chứa cả nội dung ("A. Hà Nội")
    const parsed = parseKeyOnly(childText) || parseKeyPrefix(childText);
    if (!parsed) return null;

    // Phần text còn lại của node sau khi bỏ thẻ khoá
    let rest = '';
    const clone = node.cloneNode(true);
    const first = clone.children[0];
    if (first) first.remove();
    rest = normalize(clone.textContent || '');

    return { key: parsed.key, rest: rest, child: child };
  }

  /** Gom ứng viên đáp án từ mọi dạng trình bày. */
  function collectKeyedCandidates(root, settings) {
    const candidates = [];
    const deep = settings ? settings.deepSearch !== false : true;
    const roots = collectRoots(root, deep);
    const minOptions = settings.minOptions || 2;

    roots.forEach((r) => {
      /* --- 1 & 2: node có khoá trong text trực tiếp hoặc trong thẻ con đầu --- */
      const walker = document.createTreeWalker(r, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME', 'BUTTON'].includes(node.tagName)) continue;

        const own = directText(node);

        // 2) Khoá trong thẻ con đầu tiên — ưu tiên hơn vì giữ được cấu trúc
        const fromChild = keyFromFirstChild(node);
        if (fromChild && fromChild.rest) {
          candidates.push({
            element: node,
            key: fromChild.key,
            text: fromChild.rest.trim(),
            raw: own
          });
          continue;
        }

        // 1) Khoá trong text trực tiếp
        if (!own) continue;
        const parsed = parseKeyPrefix(own);
        if (!parsed) continue;

        // Bỏ qua node bọc cả khối (có con mang thẻ cấu trúc) — tránh lấy trùm
        let hasBlockChild = false;
        for (const child of node.children) {
          if (['P', 'DIV', 'LI', 'TD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'FORM'].includes(child.tagName)) {
            hasBlockChild = true;
            break;
          }
        }
        if (hasBlockChild) continue;

        candidates.push({
          element: node,
          key: parsed.key,
          text: parsed.rest.trim(),
          raw: own
        });
      }

      /* --- 3: <ol type="A"> / <ul type="A"> --- */
      const lists = Array.from(r.querySelectorAll('ol[type="A"], ul[type="A"], ol[type="a"], ul[type="a"]'));
      lists.forEach((list) => {
        const items = Array.from(list.children).filter((li) => li.tagName === 'LI');
        if (items.length < minOptions) return;
        items.forEach((li, idx) => {
          const t = textOf(li);
          if (!t) return;
          candidates.push({
            element: li,
            key: String.fromCharCode(65 + idx),
            text: t,
            raw: t
          });
        });
      });

      /* --- 4: ô bảng chứa khoá --- */
      const cells = Array.from(r.querySelectorAll('td, th'));
      cells.forEach((cell) => {
        const own = directText(cell);
        const parsed = parseKeyPrefix(own);
        if (!parsed) return;
        candidates.push({
          element: cell,
          key: parsed.key,
          text: parsed.rest.trim(),
          raw: own
        });
      });
    });

    return candidates.filter((c) => c.text && c.text.length > 0);
  }

  function detectFromKeyedText(root, settings) {
    const candidates = collectKeyedCandidates(root, settings);
    const minOptions = settings.minOptions || 2;
    if (candidates.length < minOptions) return [];

    /* ------------------------------------------------------------
     * Gom nhóm.
     *
     * Mỗi ứng viên leo lên từ element của nó, tìm container gần nhất
     * chứa tập khoá liên tiếp bắt đầu từ A. Cách này xử lý được các
     * trường hợp ứng viên nằm rải rác ở nhiều cấp (ví dụ <li> trong <ol>,
     * ô <td> trong <tr>) và tránh gom nhầm hai câu hỏi nằm cạnh nhau.
     * ------------------------------------------------------------ */
    const groups = new Map();   // container -> Map(key -> candidate)

    const isContiguousFromA = (keys) => {
      const uniq = Array.from(new Set(keys)).sort();
      if (uniq.length < minOptions) return false;
      const start = 'A'.charCodeAt(0);
      return uniq.every((k, i) => k.charCodeAt(0) === start + i);
    };

    candidates.forEach((cand) => {
      let node = cand.element;
      let found = null;

      for (let depth = 0; depth < 8 && node && node !== document.body; depth++) {
        // Các ứng viên nằm trong subtree của node
        const inScope = candidates.filter((c) => node.contains(c.element));
        const byKey = new Map();
        inScope.forEach((c) => {
          if (!byKey.has(c.key)) byKey.set(c.key, c);
        });

        if (isContiguousFromA(Array.from(byKey.keys()))) {
          found = { container: node, byKey };
          break;
        }
        node = node.parentElement;
      }

      if (!found) return;
      const bucket = groups.get(found.container) || new Map();
      found.byKey.forEach((v, k) => {
        if (!bucket.has(k)) bucket.set(k, v);
      });
      groups.set(found.container, bucket);
    });

    const questions = [];

    groups.forEach((byKey, container) => {
      const keys = Array.from(byKey.keys()).sort();
      if (keys.length < minOptions) return;
      if (!isContiguousFromA(keys)) return;

      const sorted = keys.map((k) => byKey.get(k));
      const options = sorted.map((o) => ({
        key: o.key,
        label: o.text,
        text: truncate(o.text, settings.maxOptionLength || 600),
        selected: false,
        element: o.element
      }));

      const scope = resolveScope(container, sorted.map((o) => o.element), settings);
      let question = truncate(scope.question, settings.maxQuestionLength || 1200);
      if (!question || question.length < 3) return;

      questions.push({
        question,
        options,
        source: 'keyed-text',
        confidence: 0.75,
        scope: scope.scope
      });
    });

    return questions;
  }

  /* ============================================================
   * CHIẾN LƯỢC D — ĐÁP ÁN ĐÃ ĐƯỢC TRANG WEB TIẾT LỘ
   * ------------------------------------------------------------
   * Nhiều trang hiển thị luôn đáp án đúng sau khi nộp bài, ví dụ:
   *   "Đáp án: B"  |  "Correct answer: B"  |  "Answer: C. Hà Nội"
   *   "✓ Đáp án đúng là B"
   * Đây là nguồn đối chiếu chính xác tuyệt đối — ưu tiên cao nhất.
   * ============================================================ */

  const REVEAL_PATTERNS = [
    /(?:đáp\s*án(?:\s*đúng)?(?:\s*là)?|câu\s*trả\s*lời(?:\s*đúng)?|kết\s*quả(?:\s*đúng)?|correct\s*answer(?:\s*is)?|the\s*answer\s*is|right\s*answer)\s*[:\-–—]?\s*\(?\s*([A-Ha-h])\s*\)?\b/i,
    /^\s*([A-Ha-h])\s*[\.\)]\s*(?:✓|✔|√|đúng|đáp\s*án\s*đúng)/i,
    /(?:✓|✔|√)\s*(?:đáp\s*án\s*đúng|đúng)\s*[:\-–—]?\s*\(?\s*([A-Ha-h])\s*\)?\b/i
  ];

  /** Tìm đáp án đã tiết lộ trong một vùng text. */
  function findRevealedAnswer(text) {
    if (!text) return null;
    for (const re of REVEAL_PATTERNS) {
      const m = re.exec(text);
      if (m) {
        const key = m[1].toUpperCase();
        return { key, matched: m[0].trim().slice(0, 80) };
      }
    }
    return null;
  }

  /**
   * Gắn đáp án đã tiết lộ vào các câu hỏi tương ứng.
   *
   * Dò từ phần tử đáp án CUỐI CÙNG đi lên, **dừng ở phạm vi câu hỏi** (q.scope).
   * Ranh giới này quan trọng: nếu leo quá xa, dấu hiệu "Đáp án: B" của câu cuối
   * sẽ bị gán nhầm cho mọi câu hỏi nằm trong cùng container.
   *
   * @param {Array} questions  kết quả từ detect()
   * @param {Element} root
   */
  function attachRevealedAnswers(questions, root) {
    if (!questions || !questions.length) return questions;

    questions.forEach((q) => {
      if (!q.options || q.options.length < 2) return;

      const lastOpt = q.options[q.options.length - 1];
      let node = (lastOpt && lastOpt.element) || null;
      if (!node) node = q.scope || null;
      if (!node) return;

      // Ranh giới: không leo ra ngoài phạm vi câu hỏi (nếu có)
      const boundary = q.scope || null;

      for (let i = 0; i < 6 && node && node !== root && node !== document.body; i++) {
        const revealed = findRevealedAnswer(textOf(node));
        if (revealed) {
          const opt = q.options.find((o) => o.key === revealed.key);
          if (opt) {
            opt.revealed = true;
            opt.revealedBy = revealed.matched;
          }
          return;
        }

        // Đã tới biên của câu hỏi mà vẫn không thấy dấu hiệu -> dừng
        if (boundary && node === boundary) return;
        // Sắp leo ra ngoài biên -> dừng
        if (boundary && !boundary.contains(node.parentElement)) return;

        node = node.parentElement;
      }
    });

    return questions;
  }

  /* ============================================================
   * CHIẾN LƯỢC C — FALLBACK PHÂN TÍCH VĂN BẢN
   * ============================================================ */

  function detectFromPlainText(root, settings) {
    const text = textOf(root);
    if (!text || text.length < 20) return [];

    // Tìm các đoạn: "Câu hỏi ... A. xxx B. xxx C. xxx"
    const re = /([^\n]{6,}?)\s*((?:\b[A-H][\.\)]\s[^\n]+){2,})/g;
    const out = [];
    let m;
    let guard = 0;

    while ((m = re.exec(text)) !== null && guard++ < 200) {
      const question = normalize(m[1]);
      const block = m[2];
      const optRe = /([A-H])[\.\)]\s([^\n]+?)(?=\s+[A-H][\.\)]\s|$)/g;
      const options = [];
      let om;
      while ((om = optRe.exec(block)) !== null) {
        const t = normalize(om[2]);
        if (t) options.push({ key: om[1], label: t, text: truncate(t, settings.maxOptionLength || 600), selected: false, element: null });
      }
      if (options.length < (settings.minOptions || 2)) continue;
      if (!question || question.length < 6) continue;

      out.push({
        question: truncate(question, settings.maxQuestionLength || 1200),
        options,
        source: 'plain-text',
        confidence: 0.45
      });
    }
    return out;
  }

  /* ============================================================
   * HỢP NHẤT & LÀM SẠCH
   * ============================================================ */

  function dedupe(list) {
    const seen = new Set();
    const out = [];
    list.forEach((q) => {
      const sig = normalize(q.question).toLowerCase().slice(0, 120);
      if (!sig || seen.has(sig)) return;
      seen.add(sig);
      out.push(q);
    });
    return out;
  }

  /** Bỏ tiền tố đánh số đầu câu hỏi: "Câu 1.", "Question 2:", "3)" */
  function stripLeadingNumber(text) {
    if (!text) return '';
    return String(text)
      .replace(/^\s*(câu\s*\d+[\.\:\)]?|question\s*\d+[\.\:\)]?|\d+[\.\)])\s*/i, '')
      .trim();
  }

  /* ============================================================
   * QUÉT XUYÊN SHADOW DOM
   * ------------------------------------------------------------
   * Nhiều website hiện đại (React/Vue/web component) đặt nội dung
   * bên trong ShadowRoot. querySelector thường KHÔNG đi xuyên được
   * ranh giới này -> phải duyệt thủ công.
   * ============================================================ */

  /** Thu thập tất cả "gốc" cần quét: root + các ShadowRoot bên trong. */
  function collectRoots(root, deep) {
    const roots = [root];
    if (!deep) return roots;

    const seen = new Set();
    const walk = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);

      // ShadowRoot gắn trực tiếp
      const host = node.shadowRoot;
      if (host) {
        roots.push(host);
        walk(host);
      }
      // ShadowRoot lồng trong các phần tử con
      const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const el of all) {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          walk(el.shadowRoot);
        }
      }
    };

    walk(root);
    return roots;
  }

  /** querySelectorAll xuyên shadow root (trả về mảng). */
  function queryAllDeep(root, selector, deep) {
    const out = [];
    const seen = new Set();
    const roots = collectRoots(root, deep);

    roots.forEach((r) => {
      let list;
      try { list = r.querySelectorAll(selector); } catch (e) { return; }
      list.forEach((el) => { if (!seen.has(el)) { seen.add(el); out.push(el); } });
    });
    return out;
  }

  /** querySelector xuyên shadow root (phần tử đầu tiên). */
  function queryOneDeep(root, selector, deep) {
    const list = queryAllDeep(root, selector, deep);
    return list.length ? list[0] : null;
  }

  /* ============================================================
   * API CÔNG KHAI
   * ============================================================ */

  function detect(root, settings) {
    const cfg = Object.assign({}, QH.config.defaults, settings || {});
    cfg.questionSelectors = H().questionSelectors;
    const deep = cfg.deepSearch !== false;

    let questions = [];

    // A. Ưu tiên input
    const fromInputs = detectFromInputs(root, cfg);
    questions = questions.concat(fromInputs);

    // A2. Vai trò ARIA (div[role=radio]...) — bỏ qua nhóm đã có input thật
    const fromRoles = detectFromRoleElements(root, cfg);
    if (fromRoles.length) {
      const inputQuestions = new Set(fromInputs.map((q) => normalize(q.question).toLowerCase().slice(0, 120)));
      const extra = fromRoles.filter((q) => !inputQuestions.has(normalize(q.question).toLowerCase().slice(0, 120)));
      questions = questions.concat(extra);
    }

    // B. Nhóm theo khoá chữ — chỉ dùng khi thiếu, hoặc dùng cho các câu không có input
    const fromKeys = detectFromKeyedText(root, cfg);
    if (fromKeys.length) {
      const inputQuestions = new Set(fromInputs.map((q) => normalize(q.question).toLowerCase().slice(0, 120)));
      const extra = fromKeys.filter((q) => !inputQuestions.has(normalize(q.question).toLowerCase().slice(0, 120)));
      questions = questions.concat(extra);
    }

    // C. Văn bản thuần — chỉ khi còn thiếu
    if (!questions.length && cfg.enableTextFallback) {
      questions = questions.concat(detectFromPlainText(root, cfg));
    }

    // D. Quét theo vùng người dùng chọn (dùng tay) — bổ sung cho mọi kết quả trên
    if (cfg.manualScan && state.manualRoots && state.manualRoots.length) {
      const manual = [];
      state.manualRoots.forEach((r) => {
        try {
          manual.push.apply(manual, detectFromKeyedText(r, cfg));
        } catch (e) { /* bỏ qua */ }
      });
      const known = new Set(questions.map((q) => normalize(q.question).toLowerCase().slice(0, 120)));
      questions = questions.concat(
        manual.filter((q) => !known.has(normalize(q.question).toLowerCase().slice(0, 120)))
      );
    }

    // Làm sạch & sắp xếp theo vị trí DOM
    questions = dedupe(questions)
      .map((q) => {
        const node = (q.options.find((o) => o.element) || {}).element;
        return Object.assign(q, { node });
      })
      .filter((q) => q.options.length >= (cfg.minOptions || 2));

    questions.sort((a, b) => {
      const ay = a.node ? a.node.getBoundingClientRect().top + global.scrollY : 0;
      const by = b.node ? b.node.getBoundingClientRect().top + global.scrollY : 0;
      return ay - by;
    });

    if (cfg.maxQuestions && questions.length > cfg.maxQuestions) {
      questions = questions.slice(0, cfg.maxQuestions);
    }

    // E. Gắn đáp án do trang web đã tiết lộ ("Đáp án: B", "Correct answer: C")
    if (cfg.detectRevealed !== false) {
      try { attachRevealedAnswers(questions, root); } catch (e) { /* bỏ qua */ }
    }

    return {
      questions: questions.map((q, i) => ({
        id: 'q' + (i + 1),
        question: stripLeadingNumber(q.question),
        source: q.source,
        confidence: q.confidence,
        options: q.options.map((o) => ({
          key: o.key,
          label: o.label || '',
          text: o.text,
          selected: !!o.selected,
          revealed: !!o.revealed,
          revealedBy: o.revealedBy || '',
          element: o.element || null
        }))
      }))
    };
  }

  /* ------------------------------------------------------------
   * Quét thủ công: người dùng bôi đen vùng cần phân tích
   * ------------------------------------------------------------ */
  const state = { manualRoots: [] };

  function clearManual() {
    state.manualRoots = [];
  }

  /**
   * Phân tích một vùng DOM cụ thể.
   * Dùng khi trang không dùng radio/checkbox: người dùng bôi đen khối
   * câu hỏi rồi bấm "Quét vùng đã chọn".
   */
  function detectIn(element, settings) {
    const cfg = Object.assign({}, QH.config.defaults, settings || {});
    cfg.questionSelectors = H().questionSelectors;

    const results = [];
    const push = (arr) => {
      arr.forEach((q) => {
        const sig = normalize(q.question).toLowerCase().slice(0, 120);
        if (sig && !results.some((r) => normalize(r.question).toLowerCase().slice(0, 120) === sig)) {
          results.push(q);
        }
      });
    };

    push(detectFromKeyedText(element, cfg));
    push(detectFromInputs(element, cfg));
    push(detectFromRoleElements(element, cfg));
    if (!results.length && cfg.enableTextFallback) {
      push(detectFromPlainText(element, cfg));
    }

    return results.map((q, i) => ({
      id: 'm' + (i + 1),
      question: stripLeadingNumber(q.question),
      source: q.source,
      confidence: q.confidence,
      options: q.options.map((o) => ({
        key: o.key, label: o.label || '', text: o.text,
        selected: !!o.selected, element: o.element || null
      }))
    }));
  }

  QH.detector = {
    detect,
    detectIn,
    clearManual,
    addManualRoot: function (el) {
      if (el && state.manualRoots.indexOf(el) === -1) state.manualRoots.push(el);
    },
    parseKeyPrefix,
    parseKeyOnly,
    findRevealedAnswer,
    isVisible,
    normalize,
    truncate,
    textOf,
    queryAllDeep,
    queryOneDeep,
    // Nội bộ, hữu ích khi chẩn đoán trên một website cụ thể
    resolveScope,
    findQuestionElement,
    collectOptionLabel,
    collectKeyedCandidates
  };
})(typeof window !== 'undefined' ? window : globalThis);
