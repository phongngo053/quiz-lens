/* =============================================================
 * Quiz Lens — LỚP CẤU HÌNH
 * ------------------------------------------------------------
 * Toàn bộ hằng số có thể chỉnh được nằm ở file này.
 * Không được để logic phát hiện/giao diện nhúng hằng số riêng.
 * ============================================================= */
(function (global) {
  'use strict';

  const QH = (global.QH = global.QH || {});

  /* ------------------------------------------------------------
   * 1. Cài đặt mặc định — người dùng ghi đè từ trang tuỳ chọn
   * ------------------------------------------------------------ */
  const DEFAULTS = {
    enabled: true,          // bật/tắt toàn cục
    mode: 'dock',           // 'dock' (ghim bên) | 'inline' (chèn cạnh câu hỏi) | 'both'
    side: 'right',          // 'right' | 'left'
    theme: 'auto',          // 'auto' | 'dark' | 'light'
    width: 340,             // bề rộng panel (px)
    pushContent: true,      // đẩy nội dung trang sang trái để không che vùng đọc
    autoCollapse: true,     // tự thu gọn panel khi không tìm thấy câu hỏi nào
    showKeyBadge: true,     // hiện nhãn A/B/C/D
    stripKeyPrefix: true,   // bỏ tiền tố "A." trong nội dung đáp án
    includeHidden: false,   // có quét cả phần tử bị ẩn hay không
    minOptions: 2,          // số đáp án tối thiểu để coi là một câu hỏi
    maxQuestions: 300,      // trần số câu hiển thị
    maxOptionLength: 600,
    maxQuestionLength: 1200,
    enableTextFallback: true, // nhận dạng theo mẫu "A. B. C." khi trang không có input
    detectRevealed: true,   // nhận dạng đáp án trang đã tiết lộ ("Đáp án: B")
    blockedHosts: [],       // danh sách domain không chạy
    customProfiles: [],     // hồ sơ CSS do người dùng tự định nghĩa

    /* ----- AI ----- */
    aiEnabled: false,       // bật gợi ý đáp án bằng AI
    aiBaseUrl: '',          // Base URL API (người dùng tự nhập ở trang Cài đặt)
    aiApiKey: '',           // khoá API — KHÔNG lưu ở đây, lưu riêng trong storage.local
    aiModel: '',            // để trống = dùng model mặc định của server
    aiFallbackModels: [     // thử lần lượt nếu model chính bị lỗi cấp quyền
      'gemma4',
      'ollama/gpt-oss:120b',
      'gpt-5.6-luna',
      'ollama/beam:cloud'
    ],
    aiAuto: false,          // tự động gợi ý mỗi câu khi phát hiện
    aiConcurrency: 2,       // số request AI song song

    /* ----- Hiển thị / an toàn ----- */
    deepSearch: true,       // quét xuyên Shadow DOM
    autoCollapseOnFocus: true, // tự thu gọn khi người dùng đang gõ vào ô nhập
    manualScan: true        // cho phép quét thủ công theo vùng người dùng chọn
  };

  /* ------------------------------------------------------------
   * 2. Ngưỡng nhận dạng chung (heuristics)
   * ------------------------------------------------------------ */
  const HEURISTICS = {
    /* Các selector thường chứa phần câu hỏi, thử theo thứ tự */
    questionSelectors: [
      'legend',
      '[class*="question-title" i]',
      '[class*="questiontext" i]',
      '[class*="question-text" i]',
      '[class*="quiz-question" i]',
      '[class*="subject-name" i]',
      '[class*="stem" i]',
      '[class*="prompt-text" i]',
      '[aria-label*="câu hỏi" i]',
      '[aria-label*="question" i]',
      '.qtext',
      '.q-title',
      '.question-title',
      '.question-text',
      '.questionText',
      '.question_content',
      '.stem',
      '.prompt',
      '.quiz-question-title',
      '.exam-title',
      '.topic-title'
    ],

    /* Mẫu tiền tố khoá đáp án: "(A)", "A.", "A)", "A:", "A -" */
    keyPatterns: [
      /^\s*[\(\[]\s*([A-Ha-h])\s*[\)\]]\s*[:\.\-–—]?\s*/,
      /^\s*([A-Ha-h])\s*\)\s*[:\.\-–—]?\s*/,
      /^\s*([A-Ha-h])\s*[\.\:]\s*/,
      /^\s*([A-Ha-h])\s*[\-–—]\s+/
    ],

    /* Loại bỏ khi lấy text */
    ignoreSelectors: [
      'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
      '[data-qh-generated="1"]',
      /* Nhãn phụ thông tin (badge/chip) thường đứng trước câu hỏi */
      '[class*="badge" i]', '[class*="chip" i]', '[class*="tag" i]',
      '[class*="meta" i]', '[class*="eyebrow" i]', '[class*="category" i]',
      '[class*="question-number" i]', '[class*="q-number" i]', '[class*="q-index" i]',
      '[class*="points" i]', '[class*="score" i]', '[class*="difficulty" i]'
    ],

    /* Selector chứa nhóm đáp án (dùng khi mỗi đáp án có name khác nhau) */
    groupSelectors: [
      'fieldset',
      '[role="radiogroup"]',
      '[role="listbox"]',
      '[role="group"]',
      '[class*="option" i]',
      '[class*="answer" i]',
      '[class*="choice" i]'
    ]
  };

  /* ------------------------------------------------------------
   * 3. Hồ sơ theo website (selector đặc thù)
   *    container: vùng chứa cả câu hỏi lẫn đáp án
   *    question:  selector của phần câu hỏi bên trong container
   *    option:    selector của từng đáp án bên trong container
   *    optionText: selector lấy text đáp án (tuỳ chọn)
   *    hosts:     chuỗi con khớp với hostname, hoặc regex dạng /mẫu/
   * ------------------------------------------------------------ */
  const SITE_PROFILES = [
    {
      id: 'google-forms',
      label: 'Google Forms',
      hosts: ['docs.google.com'],
      container: '.freebirdFormviewerViewQuestion, .freebirdFormviewerViewQuestionContent',
      question: '.freebirdFormviewerViewQuestionTitle, [role="heading"][aria-level="3"]',
      option: '[role="radio"], .freebirdFormviewerViewRadioOption'
    },
    {
      id: 'moodle',
      label: 'Moodle',
      hosts: ['moodle'],
      container: '.que, .formulation, .quiz .question',
      question: '.qtext, .formulation .text, .question .text',
      option: 'input[type="radio"]'
    },
    {
      id: 'canvas',
      label: 'Canvas LMS',
      hosts: ['instructure.com', 'canvas'],
      container: '.quiz-question-item, .quiz_question, #question_container',
      question: '.quiz-question-title, .question-text, .display_name',
      option: 'input[type="radio"]'
    },
    {
      id: 'blackboard',
      label: 'Blackboard',
      hosts: ['blackboard'],
      container: '.bb-question, .question, .item',
      question: '.bb-question-title, .question-title, .stem',
      option: 'input[type="radio"]'
    },
    {
      id: 'ms-forms',
      label: 'Microsoft Forms',
      hosts: ['forms.office.com', 'forms.microsoft.com'],
      container: '[id^="question-"], .question',
      question: '.question-title, h2, .question-text',
      option: 'input[type="radio"]'
    },
    {
      id: 'quizizz',
      label: 'Quizizz',
      hosts: ['quizizz.com'],
      container: '[class*="question" i]',
      question: '[class*="question-text" i], [class*="prompt" i]',
      option: '[class*="option" i]'
    },
    {
      id: 'kahoot',
      label: 'Kahoot',
      hosts: ['kahoot.it', 'kahoot.com'],
      container: '[class*="question" i], .question-text',
      question: '[class*="question-text" i]',
      option: '[class*="answer" i], .answer'
    },
    {
      id: 'quizlet',
      label: 'Quizlet',
      hosts: ['quizlet.com'],
      container: '[class*="question" i], .set-study-card',
      question: '[class*="question" i] p, .question-prompt',
      option: '.set-study-card-answer, [class*="answer" i]'
    },
    {
      id: 'edx',
      label: 'edX',
      hosts: ['edx.org'],
      container: '.problem, .check',
      question: '.problem-title, .problem-copy p',
      option: '.choice, input[type="radio"]'
    },
    {
      id: 'coursera',
      label: 'Coursera',
      hosts: ['coursera.org'],
      container: '[class*="quiz" i], [class*="question" i]',
      question: '[class*="prompt" i], [class*="question-title" i]',
      option: '[role="radio"], label'
    },
    {
      id: 'testbook',
      label: 'Testbook / Byju\'s / Unacademy (dạng đề trắc nghiệm)',
      hosts: ['testbook.com', 'byjus.com', 'unacademy.com', 'adda247.com', 'sarthaks.com', 'doubtnut.com', 'careerwill.com'],
      container: '[class*="question" i], [class*="ques" i], [class*="mcq" i]',
      question: '[class*="question-text" i], [class*="ques-text" i], [class*="stem" i]',
      option: 'input[type="radio"], [class*="option" i]'
    },
    {
      id: 'generic',
      label: 'Chung (mọi website)',
      hosts: [],
      container: '',
      question: '',
      option: ''
    }
  ];

  QH.config = {
    version: 1,
    storageKey: 'qh.settings',
    defaults: DEFAULTS,
    heuristics: HEURISTICS,
    siteProfiles: SITE_PROFILES
  };
})(typeof window !== 'undefined' ? window : globalThis);
