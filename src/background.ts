// src/background.ts

import { createWorker, Line } from 'tesseract.js';
import { CaptureTabMessage, CaptureTabResponse } from './types';

async function performOcr(imageData: string) {
  const worker = await createWorker('kor+jpn+chi_sim', 1, {
    // --- แก้ไข Path ตรงนี้ ---
    // ชี้ไปยัง Path ที่จะถูกสร้างใน dist โดยตรง
    corePath: chrome.runtime.getURL('tesseract.js-core/tesseract-core.wasm.js'),
    logger: (m: any) => console.log(m.status, m.progress),
  });

  try {
    const { data } = await worker.recognize(imageData);
    console.log('Tesseract recognize data structure:', data);

    const blocks = data.blocks || [];
    const allLines: Line[] = blocks.flatMap(block =>
      block.paragraphs.flatMap(para => para.lines)
    );

    const textAnnotations = allLines.map((line: Line) => ({
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

  } catch (error) {
    console.error('Tesseract OCR Error:', error);
    throw new Error('Failed to process image with Tesseract.js');
  } finally {
    await worker.terminate();
  }
}

// Listener ไม่มีการเปลี่ยนแปลง
chrome.runtime.onMessage.addListener((
  request: any,
  sender,
  sendResponse
) => {
  if (request.type === 'captureTab') {
    const windowId = sender.tab?.windowId;
    if (typeof windowId === 'undefined') {
      sendResponse({ error: 'Cannot get window ID' });
      return true;
    }
    chrome.tabs.captureVisibleTab(
      windowId,
      { format: 'png' },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ dataUrl });
        }
      }
    );
    return true;
  }
  if (request.type === 'performOcr') {
    performOcr(request.imageData)
      .then(result => sendResponse({ data: result }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});