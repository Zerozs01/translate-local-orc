// src/offscreen.js

// Import Tesseract.js library
import { createWorker } from 'tesseract.js';

// ฟังก์ชันสำหรับ OCR (เหมือนกับที่เราเคยทำใน background.ts)
async function performOcr(imageData) {
  console.log('[Offscreen] OCR process started.');
  let worker;
  try {
    worker = await createWorker('kor+jpn+chi_sim', 1, {
      // ไม่ต้องใช้ getURL แล้ว เพราะรันใน context ของ extension page โดยตรง
      corePath: 'tesseract.js-core/tesseract-core.wasm.js',
      logger: (m) => console.log(`[Offscreen-Tesseract] ${m.status}: ${(m.progress * 100).toFixed(2)}%`),
    });

    const { data } = await worker.recognize(imageData);
    const blocks = data.blocks || [];
    const allLines = blocks.flatMap(block =>
      block.paragraphs.flatMap(para => para.lines)
    );
    const textAnnotations = allLines.map(line => ({
      description: line.text.replace(/\s/g, ''),
      boundingPoly: {
        vertices: [
          { x: line.bbox.x0, y: line.bbox.y0 },
          { x: line.bbox.x1, y: line.bbox.y0 },
          { x: line.bbox.x1, y: line.bbox.y1 },
          { x: line.bbox.x0, y: line.bbox.y1 }
        ]
      }
    }));
    return { responses: [{ textAnnotations }] };
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}

// รอรับ Message จาก background script
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'ocr-offscreen-request') {
    performOcr(request.imageData)
      .then(result => {
        // ส่งผลลัพธ์กลับ
        chrome.runtime.sendMessage({
          type: 'ocr-offscreen-response',
          data: result
        });
      })
      .catch(error => {
        // ส่ง Error กลับ
        chrome.runtime.sendMessage({
          type: 'ocr-offscreen-response',
          error: error.message
        });
      });
  }
});