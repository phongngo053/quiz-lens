# Quiz Lens

Extension trình duyệt (Manifest V3) đọc câu hỏi và các đáp án **đang hiển thị** trên
trang web, rồi hiện bảng đối chiếu ngay bên cạnh nội dung — kèm tuỳ chọn gợi ý đáp án
bằng AI.

Chạy hoàn toàn cục bộ. Không backend, không telemetry, API key không nằm trong mã nguồn.

---

## 1. Tính năng

| Nhóm | Mô tả |
|---|---|
| **Phát hiện** | 4 chiến lược: `input[type=radio/checkbox]`, `role="radio"/"option"` (ARIA), mẫu chữ `A. B. C.`, và phân tích văn bản thuần |
| **Nhiều kiểu trình bày** | Nhận dạng được đáp án dạng `<p>A. …</p>`, `<ol type="A"><li>`, `<div><span>A.</span>…`, ô `<td>`, và `<div class="opt"><b>A)</b>…` |
| **Đáp án đã lộ** | Nếu trang hiển thị sẵn đáp án đúng (`Đáp án: B`, `Correct answer: C`) → đánh dấu **★ đáp án đúng** |
| **Quét sâu** | Xuyên Shadow DOM (web component) — bật/tắt được |
| **Iframe** | Câu hỏi trong iframe được tìm thấy và hiển thị lên panel của trang chính |
| **Panel** | Shadow DOM riêng → không xung đột CSS với trang; ghim mép trái/phải; thu gọn 46px; chế độ chèn inline cạnh câu hỏi |
| **Không che vùng đọc** | Đẩy nội dung trang sang một bên; tự thu gọn + làm mờ + `pointer-events:none` khi người dùng đang gõ |
| **Cập nhật tự động** | `MutationObserver` + sự kiện `change`/`input`; debounce; cập nhật theo tab đang hoạt động |
| **AI** | Gợi ý đáp án theo câu, chọn model từ danh sách API, tự thử model dự phòng khi model chính bị lỗi cấp quyền |
| **Quét thủ công** | Bôi đen vùng câu hỏi rồi bấm nút → quét phần đó |

---

## 2. Cài đặt

### Từ mã nguồn (khuyến nghị)

1. Mở `chrome://extensions` (Chrome) hoặc `edge://extensions` (Edge).
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục `quiz-lens-extension/`.

> **Lưu ý Chrome 137+**: Chrome đã chặn cờ `--load-extension` khi khởi động tự động.
> Cách cài thủ công ở trên vẫn hoạt động bình thường. Nếu bạn định chạy kiểm thử tự động,
> dùng `tools/e2e-extension.js` (xem mục 5).

### Từ file .crx/.zip

Giải nén rồi làm như bước 1–4.

---

## 3. Sử dụng

| Thao tác | Kết quả |
|---|---|
| Bấm icon extension trên toolbar | Bật/tắt panel trên tab hiện tại |
| `Alt` + `Shift` + `Q` | Thu gọn / mở rộng panel (đổi được ở `chrome://extensions/shortcuts`) |
| Bấm `↻` trên panel | Quét lại trang |
| Bấm biểu tượng **bôi đen** trên panel | Bôi đen khối câu hỏi rồi bấm lại → quét vùng đã chọn |
| Bấm **Gợi ý AI** | Model suy luận đáp án, hiện ký hiệu + độ tin cậy + lý do |
| Bấm **chọn** trên một đáp án | Click vào đáp án tương ứng trên trang |
| Bấm ⚙ | Mở trang cài đặt |

### Khi đang gõ chữ

Khi bạn đặt con trỏ vào ô nhập trên trang, panel **tự mờ đi, không bắt chuột và tự thu gọn** —
để không che hay chặn thao tác gõ (quan trọng với bài có phần điền từ).
Panel tự mở lại khi bạn rời khỏi ô nhập.

Tắt hành vi này ở *Cài đặt → Không chặn khi đang gõ*.

---

## 4. Cấu trúc mã nguồn

```
quiz-lens-extension/
├── manifest.json                 # Manifest V3
├── icons/                        # icon 16/32/48/128
├── test-fixture.html             # trang thử nghiệm mẫu
├── src/
│   ├── background/
│   │   └── service-worker.js     # MV3 SW: toggle, cầu nối cài đặt, PROXY gọi AI
│   ├── content/
│   │   ├── config.js             # ★ CẤU HÌNH: mặc định, heuristic, hồ sơ website
│   │   ├── detector.js           # ★ PHÁT HIỆN: DOM → câu hỏi + đáp án
│   │   ├── panel.js              # ★ GIAO DIỆN: dựng & điều khiển panel
│   │   ├── panel-styles.js       # CSS của panel (nạp vào Shadow DOM)
│   │   ├── inline.js             # chèn card đáp án cạnh câu hỏi (light DOM)
│   │   ├── inline.css            # CSS của card inline
│   │   ├── ai.js                 # lớp AI (gọi qua service worker)
│   │   └── index.js              # điều phối: settings, quét, observer, message
│   └── options/
│       ├── options.html/.css/.js # trang cài đặt
└── tools/                        # script kiểm thử (không đóng gói vào extension)
```

Ba lớp được tách riêng đúng như yêu cầu:

- **`config.js`** — mọi hằng số, ngưỡng nhận dạng và hồ sơ selector theo website.
  Muốn thêm website mới chỉ cần sửa file này.
- **`detector.js`** — thuần logic đọc DOM, không chạm gì tới giao diện. Có thể test độc lập.
- **`panel.js` + `panel-styles.js`** — thuần giao diện, nhận dữ liệu và vẽ ra.

---

## 5. Kiểm thử

```bash
# Unit test (jsdom) — không cần trình duyệt
node tools/test-detector.js     # 42 kiểm thử: phát hiện đáp án
node tools/test-panel.js        # 39 kiểm thử: giao diện panel
node tools/test-features.js     # 47 kiểm thử: AI, chế độ gõ, Shadow DOM, bảo mật key
node tools/test-v2.js           # 61 kiểm thử: dạng đáp án mới, đáp án đã lộ, iframe, AI dự phòng

# End-to-end (nạp extension thật vào Chromium)
node tools/e2e-extension.js     # 23 kiểm thử: manifest, SW, content script, UI
```

Cần `jsdom` và `playwright-core` (đã có sẵn trong workspace Node).
Tổng: **189 unit test + 23 e2e**.

### Kiểm thử thủ công nhanh

1. Mở `test-fixture.html` trong trình duyệt (mở trực tiếp từ đĩa cũng được).
2. Panel phải hiện **2 câu** (một câu dùng radio, một câu dùng mẫu chữ `A./B./C.`).
3. Bấm **Thêm câu hỏi** → panel phải tự cập nhật lên 3 câu.
4. Tick một đáp án → panel phải đánh dấu `✓ đã chọn`.
5. Gõ vào ô nhập → panel phải mờ đi và tự thu gọn.

---

## 6. Cấu hình AI

Extension không nhúng sẵn API key. Bạn tự nhập ở *Cài đặt → Trợ lý AI*.

1. **Địa chỉ API** — Base URL tương thích OpenAI. `/v1` được thêm tự động nếu thiếu.
2. **Khoá API** — lưu trong `chrome.storage.local` của **trình duyệt này**.
   - Không nằm trong cài đặt đồng bộ (`chrome.storage.sync`).
   - Không nằm trong mã nguồn, không bị commit.
   - Chỉ được đọc trong service worker rồi gửi thẳng tới API; **không bao giờ** được
     tiêm vào DOM của trang web.
3. **Model** — bấm *Kiểm tra & tải model* để lấy danh sách, có ô tìm kiếm.
4. **Model dự phòng** — mỗi dòng một model. Khi model chính bị lỗi cấp quyền
   (`No active credentials`, `channel verification`), extension tự thử lần lượt các model này.
5. **Gợi ý tự động** — mặc định **tắt**. Bật sẽ gọi API cho mỗi câu ngay khi phát hiện,
   tốn hạn mức hơn nhiều.

> **Cảnh báo hạn mức**: một số gateway chặn request không đúng "kênh" chính thức
> (lỗi `channel verification` / `request illegal`). Lỗi này **không** phải do thiếu header —
> nó nằm ở tầng upstream. Cách xử lý là đổi model, và extension đã tự làm việc này.

---

## 7. Bảo mật

- API key: `chrome.storage.local`, không đồng bộ, không trong repo, không lọt vào trang web.
- Nội dung câu hỏi/đáp án được render bằng `textContent` + escape → không có XSS.
- Panel chạy trong Shadow DOM → không rò CSS ra trang, không để trang CSS tấn công ngược lại.
- Không thu thập, không gửi dữ liệu đi đâu ngoài API do **bạn** cấu hình.

---

## 8. Giấy phép

MIT — xem `LICENSE`.
