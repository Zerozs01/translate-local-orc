// src/background.ts

import { CaptureTabMessage, CaptureTabResponse } from './types';

// เหลือแค่ Listener สำหรับ captureTab อย่างเดียว
chrome.runtime.onMessage.addListener((
  request: CaptureTabMessage,
  sender,
  sendResponse: (response: CaptureTabResponse) => void
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
});