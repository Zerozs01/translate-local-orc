// src/background.ts

import { CaptureTabMessage, CaptureTabResponse } from './types';

let creating: Promise<void> | undefined;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'perform-ocr-in-offscreen') {
        setupOffscreenDocument(request.imageData);
        return true;
    }
    
    if (request.type === 'captureTab') {
        const windowId = sender.tab?.windowId;
        if (typeof windowId === 'undefined') {
            sendResponse({ error: 'Cannot get window ID' });
            return true;
        }
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ dataUrl });
            }
        });
        return true;
    }
});

async function setupOffscreenDocument(imageData: string) {
    // --- จุดที่แก้ไข Bug สุดท้าย ---
    // เปลี่ยนจาก GetContextsFilter เป็น ContextFilter ตามที่ TypeScript แนะนำ
    const filter: chrome.runtime.ContextFilter = {
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType]
    };
    
    const existingContexts: chrome.runtime.ExtensionContext[] = await chrome.runtime.getContexts(filter);

    if (existingContexts.length > 0) {
        chrome.runtime.sendMessage({
            type: 'ocr-offscreen-request',
            imageData: imageData
        });
        return;
    }

    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
            justification: 'Required for Tesseract.js OCR Web Worker'
        });
        await creating;
        creating = undefined;
    }

    chrome.runtime.sendMessage({
        type: 'ocr-offscreen-request',
        imageData: imageData
    });
}