import { createWorker, Line } from 'tesseract.js';
import {
  CaptureTabMessage,
  CaptureTabResponse,
  TextAnnotation,
  TranslationObserver
} from './types';
import improveTranslation from './gemini';

// เพิ่มตัวแปร API Key
const API_KEY = 'AIzaSyCBjP5Ouh7Cg888JZ96CYqfOqxncQ89iUA';

// แยก API Keys สำหรับแต่ละ service
const GOOGLE_TRANSLATE_API_KEY = 'YOUR_TRANSLATE_API_KEY';
const GOOGLE_VISION_API_KEY = 'YOUR_VISION_API_KEY';

// เพิ่ม cache สำหรับเก็บคำแปล
const translationCache = new Map<string, {
  text: string;
  timestamp: number;
  rect: DOMRect;
  overlayElement: HTMLElement;
}>();


// เพิ่ม cache สำหรับลการวิเคราะห์สี
const colorAnalysisCache = new Map<string, {
  result: { background: string; text: string };
  timestamp: number;
}>();


// เพิ่มตัวแปร global สำหรับ observer
let translationObserver: TranslationObserver | null = null;
let isTranslating = false;


// เพิ่มตัวแปร global สำหรับค่า font size multiplier
let fontSizeMultiplier = 1.0;


// เพิ่มตัวแปร global สำหรับค่า spread threshold
let spreadThreshold = 0.61;


// เพิ่มตัวแปร global สำหรับภาษาที่เลือก
let targetLanguage: 'th' | 'en' | 'ja' | 'ko' | 'zh' = 'th';



// เพิ่มตัวแปรสำหรับ controls
let spreadControls: HTMLDivElement | null = null;
let spreadDisplay: HTMLSpanElement | null = null;



// เพิ่ม style sheet สำหรับ responsive design
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  .translation-overlay-container {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(2px);
    border-radius: 2px;
    opacity: 0;
    transition: opacity 0.2s ease-in-out;
    pointer-events: none;
    z-index: 10000;
    transform-origin: top left;
  }

  .translation-text {
    width: 100%;
    text-align: center;
    color: #000;
    line-height: 1.2;
    padding: 2px 4px;
    word-break: break-word;
    overflow-wrap: break-word;
  }

`;
document.head.appendChild(styleSheet);


// ปรับปรุง style ของปุ่มควบคุมทั้งหมด
const buttonBaseStyle = `
  padding: 5px 10px;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 15px;
  background: linear-gradient(to bottom, #ffffff, #f5f5f5);
  color: #333;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  text-shadow: 1px 1px 1px rgba(255,255,255,0.5);
  transition: all 0.2s ease;
  min-width: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const buttonHoverStyle = `
  background: linear-gradient(to bottom, #f5f5f5, #e8e8e8);
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
`;

const buttonActiveStyle = `
  background: linear-gradient(to bottom, #e8e8e8, #d8d8d8);
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
`;

// เพิ่มระบบจัดการ Error แบบ Toast
const createToast = () => {
  const toastContainer = document.createElement('div');
  toastContainer.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10002;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
};

const showToast = (message: string, type: 'error' | 'success' = 'error') => {
  const container = document.querySelector('.toast-container') || createToast();
  const toast = document.createElement('div');
  toast.style.cssText = `
    padding: 12px 24px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    animation: fadeIn 0.3s ease;
    ${type === 'error' 
      ? 'background: linear-gradient(to right, #ff4b4b, #ff416c);' 
      : 'background: linear-gradient(to right, #00b09b, #96c93d);'
    }
  `;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

// เพิ่ม style สำหรับ animation
const toastStyle = document.createElement('style');
toastStyle.textContent = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeOut {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(-20px); }
  }
`;
document.head.appendChild(toastStyle);

// ปรับปรุงระบบ Batch Translation
const BATCH_SIZE = 5;
const translationQueue: {
  text: string;
  resolve: (value: string) => void;
  reject: (error: any) => void;
}[] = [];

let isProcessingBatch = false;

async function processBatchTranslation() {
  if (isProcessingBatch || translationQueue.length === 0) return;
  
  isProcessingBatch = true;
  
  try {
    while (translationQueue.length > 0) {
      const batch = translationQueue.splice(0, BATCH_SIZE);
      const texts = batch.map(item => item.text);
      
      try {
        const response = await fetch(
          `https://translation.googleapis.com/language/translate/v2?key=${API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              q: texts,
              target: targetLanguage,
              format: 'text'
            })
          }
        );

        if (!response.ok) throw new Error(`Translation API error: ${response.status}`);

        const data = await response.json();
        const translations = data.data?.translations || [];

        batch.forEach((item, index) => {
          item.resolve(translations[index]?.translatedText || item.text);
        });

      } catch (error) {
        batch.forEach(item => item.reject(error));
        showToast('การแปลผิดพลาด กรุณาลองใหม่อีกครั้ง', 'error');
      }
    }
  } finally {
    isProcessingBatch = false;
  }
}

// ปรับปรุงฟังก์ชัน translateText
async function translateText(text: string): Promise<string> {
  let retries = 3;
  while (retries > 0) {
    try {
      if (!text || text.trim() === '') return '';
      
      // ตรวจสอบใน cache ก่อน
      const cacheKey = `${text}:${targetLanguage}${isGeminiMode ? ':gemini' : ''}`;
      const cached = translationCache.get(cacheKey);
      if (cached) return cached.text;

      // ถ้าอยู่ในโหมด Gemini ให้ใช้ Gemini API แปลโดยตรง
      if (isGeminiMode) {
        try {
          const prompt = `แปลข้อความต่อไปนี้เป็นภาษา${
            targetLanguage === 'th' ? 'ไทย' :
            targetLanguage === 'en' ? 'อังกฤษ' :
            targetLanguage === 'ja' ? 'ญี่ปุ่น' :
            targetLanguage === 'ko' ? 'เกาหลี' : 'จีน'
          } โดยรักษาความหมายและทำให้เป็นธรรมชาติที่สุด:\n\n${text}`;
          
          const translatedText = await improveTranslation(text, prompt);
          if (translatedText) {
            // เก็บใน cache
            translationCache.set(cacheKey, {
              text: translatedText,
              timestamp: Date.now(),
              rect: new DOMRect(),
              overlayElement: document.createElement('div')
            });
            return translatedText;
          }
        } catch (error) {
          
          showToast('การแปลด้วย AI ผิดพลาด กรุณาลองใหม่อีกครั้ง', 'error');
        }
      }

      // ถ้าไม่ใช่โหมด Gemini หรือ Gemini แปลไม่สำเร็จ ให้ใช้ Google Translate
      return new Promise((resolve, reject) => {
        translationQueue.push({ text, resolve, reject });
        if (!isProcessingBatch) {
          processBatchTranslation();
        }
      });
    } catch (error) {
      retries--;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return text;
}

// ปรับปรุง UI สำหรับเลือกภาษา
function createLanguageSelector() {
  const container = document.createElement('div');
  container.style.cssText = `
    display: flex;
    align-items: center;
    gap: 1px;
    background: dark;
   padding: 4px 18px;
    border-radius: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  `;

  const select = document.createElement('select');
  select.style.cssText = `
    padding: 4px 10px;
    border: 1px solid #ddd;
    border-radius: 10px;
    font-size: 15px;
    outline: none;
    cursor: pointer;
  `;

  const languages = [
    { value: 'th', label: '🇹🇭 ไทย' },
    { value: 'en', label: '🇬🇧 English' },
    { value: 'ja', label: '🇯🇵 日本語' },
    { value: 'ko', label: '🇰🇷 한국어' },
    { value: 'zh', label: '🇨🇳 中文' }
  ];

  select.innerHTML = languages
    .map(lang => `<option value="${lang.value}">${lang.label}</option>`)
    .join('');

  select.value = targetLanguage;
  
  select.addEventListener('change', () => {
    targetLanguage = select.value as typeof targetLanguage;
    translationCache.clear();
    if (translationObserver) {
      translationObserver.disconnect();
      translationObserver = startRealTimeTranslation(
        document.querySelector('.translate-overlay') as HTMLElement
      );
    }
    showToast(`เปลี่ยนภาษาเป็น ${
      languages.find(l => l.value === targetLanguage)?.label
    }`, 'success');
  });

  container.appendChild(select);
  return container;
}

// แก้ไขฟังก์ชัน createTranslateOverlay เพื่อใช้ UI ใหม่
function createTranslateOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'translate-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10000;
  `;


  // สร้างปุ่มควบคุม
  const controls = document.createElement('div');
  controls.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-end;
    pointer-events: auto;
    z-index: 10001;
  `;


  // สร้างปุ่ม toggle translation
  const toggleButton = document.createElement('button');
  toggleButton.innerHTML = '🌐Translation';
  toggleButton.style.cssText = `
    ${buttonBaseStyle}
    background: linear-gradient(to bottom, #4285f4, #3b78e7);
    color: white;
    text-shadow: 1px 1px 1px rgba(0,0,0,0.2);
    padding: 25px 25px;
     font-size: 25px;

    &:hover {
      background: linear-gradient(to bottom, #5295ff, #4285f4);
    }

    &:active {
      background: linear-gradient(to bottom, #3b78e7, #3367d6);
    }
  `;


  // สร้างตัวควบคุมขนาดตัวอักษร
  const fontSizeControls = document.createElement('div');

  fontSizeControls.style.cssText = `
    display: none;
    align-items: center;
    gap: 6px;
    background: rgba(255,255,255,0.9);
    padding:4 26px;
    border-radius: 20px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
  `;


  // แสดงขนาดตัวอักษรปัจจุบัน
  const fontSizeDisplay = document.createElement('span');
  fontSizeDisplay.style.cssText = `
    min-width: 40px;
    text-align: center;
    font-size: 14px;
    color: black;
  `;
  fontSizeDisplay.textContent = '100%';


  // ปุ่มลดขนาด
  const decreaseButton = document.createElement('button');
  decreaseButton.innerHTML = '➖';
  decreaseButton.style.cssText = buttonBaseStyle;


  // ปุ่มเพิ่มขนาด
  const increaseButton = document.createElement('button');
  increaseButton.innerHTML = '➕';
  increaseButton.style.cssText = buttonBaseStyle;


  // ปร้างปุ่มควบคุมภาษา
  const languageSelector = createLanguageSelector();


  // จัดการการคลิกปุ่ม toggle
  toggleButton.addEventListener('click', () => {
    isTranslating = !isTranslating;
    toggleButton.innerHTML = isTranslating ? '⏹️ Stop Translation' : '🌐Translation';
    fontSizeControls.style.display = isTranslating ? 'flex' : 'none';
    languageSelector.style.display = isTranslating ? 'flex' : 'none';
    if (spreadControls) {
      spreadControls.style.display = isTranslating ? 'flex' : 'none';
    }
    grammarButton.style.display = isTranslating ? 'flex' : 'none';

    if (isTranslating) {
      translationObserver = startRealTimeTranslation(overlay);
    } else {
      stopRealTimeTranslation();
    }
    
    // เพิ่มการควบคุมปุ่ม Refresh
    refreshButton.style.display = isTranslating ? 'flex' : 'none';
  });


  // จัดการการคลิกปุ่มลดขนาด
  decreaseButton.addEventListener('click', () => {
    if (fontSizeMultiplier > 0.5) {
      fontSizeMultiplier -= 0.1;
      fontSizeDisplay.textContent = `${Math.round(fontSizeMultiplier * 100)}%`;
      // รีเฟรชการแปลเพื่อใช้ขนาดใหม่
      if (translationObserver) {
        translationObserver.disconnect();
        translationObserver = startRealTimeTranslation(overlay);
      }
    }
  });


  // จัดการการคลิกปุ่มเพิ่มขนาด
  increaseButton.addEventListener('click', () => {
    if (fontSizeMultiplier < 4.0) {
      fontSizeMultiplier += 0.1;
      fontSizeDisplay.textContent = `${Math.round(fontSizeMultiplier * 100)}%`;
      // รีเฟรชการแปลเพื่อใช้ขนาดใหม่
      if (translationObserver) {
        translationObserver.disconnect();
        translationObserver = startRealTimeTranslation(overlay);
      }
    }
  });


  // เพิ่ม elements เข้าไปใน fontSizeControls
  fontSizeControls.appendChild(decreaseButton);
  fontSizeControls.appendChild(fontSizeDisplay);
  fontSizeControls.appendChild(increaseButton);


  // สร้าง container สำหรับจัดกลุ่มปุ่มควบคุม
  const controlsGroup = document.createElement('div');
  controlsGroup.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 7px;
  `;


  // สร้าง controls สำหรับ spread threshold
  spreadControls = document.createElement('div');
  spreadControls.style.cssText = `
    display: none;
    align-items: center;
    gap: 1px;
    background: rgba(255,255,255,0.95);
    padding: 1px 1px;
    border-radius: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    border: 1px solid rgba(0,0,0,0.1);
  `;


  // แสดงค่า spread threshold ปัจจุบัน
  spreadDisplay = document.createElement('span');
  spreadDisplay.style.cssText = `
    min-width: 60px;
    text-align: center;
    font-size: 13px;
    font-weight: bold;
    color: #333;
    text-shadow: 1px 1px 1px rgba(255,255,255,0.5);
    padding: 1px 1px;
    background: rgba(255,255,255,0.8);
    border-radius: 10px;
  `;
  spreadDisplay.textContent = `${Math.round(spreadThreshold * 100)}%`;


  // ปุ่มลดค่า spread
  const decreaseSpread = document.createElement('button');
  decreaseSpread.innerHTML = '◀';
  decreaseSpread.style.cssText = buttonBaseStyle;


  // ปุ่มเพิ่มค่า spread
  const increaseSpread = document.createElement('button');
  increaseSpread.innerHTML = '▶';
  increaseSpread.style.cssText = buttonBaseStyle;


  // จัดการการคลิกปุ่มลดค่า
  decreaseSpread.addEventListener('click', () => {
    if (spreadThreshold > 0.1) {
      spreadThreshold -= 0.1;
      if (spreadDisplay) {
        spreadDisplay.textContent = `${Math.round(spreadThreshold * 100)}%`;
      }
      if (translationObserver) {
        translationObserver.disconnect();
        translationObserver = startRealTimeTranslation(overlay);
      }
    }
  });


  // จัดการการคลิกปุ่มเพิ่มค่า
  increaseSpread.addEventListener('click', () => {
    if (spreadThreshold < 0.9) {
      spreadThreshold += 0.1;
      if (spreadDisplay) {
        spreadDisplay.textContent = `${Math.round(spreadThreshold * 100)}%`;
      }
      if (translationObserver) {
        translationObserver.disconnect();
        translationObserver = startRealTimeTranslation(overlay);
      }
    }
  });


  // เพิ่ม elements เข้าไปใน spreadControls
  spreadControls.appendChild(decreaseSpread);
  spreadControls.appendChild(spreadDisplay);
  spreadControls.appendChild(increaseSpread);


  // เพิ่มปุ่มจัดไวยากรณ์
  const grammarButton = document.createElement('button');
  grammarButton.setAttribute('data-gemini-button', 'true');
  grammarButton.innerHTML = '🤖 แปลด้วย AI';
  grammarButton.style.cssText = buttonBaseStyle + `
    display: none;
    background: linear-gradient(to bottom, #34a853, #2d9144);
    color: white;
    text-shadow: 1px 1px 1px rgba(0,0,0,0.2);
    padding: 8px 18px;
  `;

  // เพิ่ม event listener สำหรับปุ่มแปลด้วย AI
  grammarButton.addEventListener('click', async () => {
    isGeminiMode = !isGeminiMode;
    grammarButton.disabled = true;
    grammarButton.innerHTML = isGeminiMode ? '⏳ กำลังแปล...' : '🤖 แปลด้วย AI';

    try {
      console.log('Switching to Gemini mode:', isGeminiMode);
      translationCache.clear();
      
      if (translationObserver) {
        translationObserver.disconnect();
        translationObserver = startRealTimeTranslation(
          document.querySelector('.translate-overlay') as HTMLElement
        );
      }
      
      showToast(
        isGeminiMode ? 'เปลี่ยนเป็นโหมดแปลด้วย AI แล้ว' : 'เปลี่ยนเป็นโหมดแปลปกติแล้ว',
        'success'
      );
    } finally {
      grammarButton.disabled = false;
      grammarButton.innerHTML = isGeminiMode ? '🔄 กลับสู่โหมดปกติ' : '🤖 แปลด้วย AI';
    }
  });

  // เพิ่มปุ่ม Refresh หลังปุ่ม Gemini
  const refreshButton = document.createElement('button');
  refreshButton.innerHTML = '🔄 Refresh';
  refreshButton.style.cssText = buttonBaseStyle + `
    display: none; // เริ่มต้นซ่อนไว้
    background: linear-gradient(to bottom, #ff6b6b, #ff5252);
    text-shadow: 1px 1px 1px rgba(0,0,0,0.2);
    color: dark;
    padding: 8px 28px;
  `;

  // เพิ่ม event listener สำหรับปุ่ม Refresh
  refreshButton.addEventListener('click', () => {
    // ลบ overlay ทั้งหมด
    document.querySelectorAll('.translation-overlay-container').forEach(el => el.remove());
    // รีสตาร์ทการแปล
    if (translationObserver) {
      translationObserver.disconnect();
      translationObserver = startRealTimeTranslation(overlay);
    }
  });

  // เพิ่มปุ่มเข้าไปใน controlsGroup
  controlsGroup.appendChild(languageSelector);
  controlsGroup.appendChild(fontSizeControls);
  controlsGroup.appendChild(spreadControls);
  controlsGroup.appendChild(grammarButton);
  controlsGroup.appendChild(refreshButton); 
  controlsGroup.appendChild(toggleButton);

  controls.appendChild(controlsGroup);

  document.body.appendChild(overlay);
  document.body.appendChild(controls);

  return { overlay, controls };
}
// เพิ่มตัวแปร global สำหรับเก็บเวลาแปลล่าสุด
let lastTranslationTimestamp = 0;

// เพิ่มตัวแปรควบคุมการ scroll
let isScrolling = false;
let lastScrollY = window.scrollY;
const SCROLL_THRESHOLD = 30; // ลดลงเพื่อให้ไวต่อการเลื่อนมากขึ้น
const SCROLL_DELAY = 200; // ลดลงเพื่อตอบสนองเร็วขึ้น
const CLEAR_DELAY = 280; // ลดลงเพื่อเริ่มแปลเร็วขึ้น
const MIN_SCROLL_TIME = 95; // ลดลงเพื่อให้ตรวจจับการหยุดได้เร็วขึ้น
const TRANSLATION_BUFFER = 100; // เพิ่มพื้นที่ buffer รอบๆ viewport


// ฟังก์ชันเริ่มการแปลแบบ real-time
function startRealTimeTranslation(overlay: HTMLElement): TranslationObserver {
  if (!isTranslating) {
    isTranslating = true;
  }

  let lastScrollPosition = window.scrollY;
  let scrollTimeout: NodeJS.Timeout;




  // ปรับปรุง scroll handler
  const scrollHandler = () => {
    if (!isTranslating) return;




    // ลบ overlays เมื่อเริ่มเล่อน
    if (Math.abs(window.scrollY - lastScrollPosition) > 180) {
      overlay.innerHTML = '';
      translationCache.clear();
      lastScrollPosition = window.scrollY;
      lastTranslationTimestamp = Date.now(); // อัพเดทเวลาการแปลครั้งล่าสุด
    }




    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      // หารูปที่มองเห็นในหน้าจอ
      const visibleImages = Array.from(document.getElementsByTagName('img'))
        .filter(img => {
          const rect = img.getBoundingClientRect();
          const style = window.getComputedStyle(img);

          return rect.top < window.innerHeight &&
                 rect.bottom > 0 &&
                 rect.left < window.innerWidth &&
                 rect.right > 0 &&
                 style.display !== 'none' &&
                 style.visibility !== 'hidden' &&
                 style.opacity !== '0' &&
                 img.offsetParent !== null &&
                 img.complete &&
                 img.naturalWidth > 0;
        });




      // แปลเฉพาะรูปที่มองเห็น
      visibleImages.forEach(img => translateImage(img, overlay));
    }, 150);
  };




  window.addEventListener('scroll', scrollHandler);
  scrollHandler(); // เริ่มการแปลรูปที่มองเห็นตอนเริ่มต้น



  return {
    disconnect: () => {
      isTranslating = false;
      window.removeEventListener('scroll', scrollHandler);
      clearTimeout(scrollTimeout);
      overlay.innerHTML = '';
    }
  };
}
async function performOcr(imageData: string) {
  console.log('[BG] Received OCR request. Starting process...');
  let worker;
  
  try {
    console.log('[BG] Step 1: Creating Tesseract worker...');
    worker = await createWorker('kor+jpn+chi_sim', 1, {
      corePath: chrome.runtime.getURL('tesseract.js-core/tesseract-core.wasm.js'),
      logger: (m: any) => console.log(`[BG-Tesseract] ${m.status}: ${(m.progress * 100).toFixed(2)}%`),
    });
    console.log('[BG] Step 1: Worker created successfully.');

    console.log('[BG] Step 2: Recognizing image...');
    const { data } = await worker.recognize(imageData);
    console.log('[BG] Step 2: Image recognized successfully. Data structure:', data);

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
    
    console.log('[BG] Step 3: OCR process completed. Sending data back.');
    return { responses: [{ textAnnotations }] };

  } catch (error) {
    console.error('[BG] FATAL OCR aERROR:', error);
    // ส่ง Error กลับไปให้ content script รู้
    throw new Error('Tesseract.js failed in background: ' + (error as Error).message);
  } finally {
    if (worker) {
      console.log('[BG] Terminating worker.');
      await worker.terminate();
    }
  }
}



// ฟังก์ชันแปลรูปภาพแต่ละรูป
async function translateImage(img: HTMLImageElement, overlay: HTMLElement) {
  try {
    if (isScrolling) return;

    const rect = img.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    // เปลี่ยนจาก const เป็น let เพื่อให้สามารถปรับค่าได้
    let extendedTop = -TRANSLATION_BUFFER * 2;
    let extendedBottom = viewportHeight + TRANSLATION_BUFFER * 2;
    
    // เพิ่มการตรวจสอบภาพแนวตั้งพิเศษ
    const isVerticalMangaImage = rect.height > window.innerHeight * 2 && rect.width < window.innerWidth * 0.8;
    if (isVerticalMangaImage) {
      // ขยาย buffer สำหรับภาพแนวตั้ง
      extendedTop = -TRANSLATION_BUFFER * 5;
      extendedBottom = viewportHeight + TRANSLATION_BUFFER * 5;
    }
    
    // ตรวจสอบว่ารูปอยู่ในพื้นที่ที่ขยายออก
    const isInExtendedView = 
      rect.bottom > extendedTop && 
      rect.top < extendedBottom &&
      rect.right > -TRANSLATION_BUFFER &&
      rect.left < (window.innerWidth + TRANSLATION_BUFFER);

    if (!isInExtendedView) return;

    // ตรวจสอบขนาดขั้นต่ำ
    if (rect.width < 100 || rect.height < 100) return;

    const currentTimestamp = Date.now();
    if (currentTimestamp - lastTranslationTimestamp < MIN_SCROLL_TIME) return;

    // ล้าง overlays เก่าและ cache ทั้งหมดถ้าเวลาการแปลครั้งล่าสุดเปลี่ยนไป
    if (lastTranslationTimestamp === null || currentTimestamp - lastTranslationTimestamp > 0) {
      overlay.innerHTML = '';
      translationCache.clear();
      lastTranslationTimestamp = currentTimestamp;
    }

    // ตรวจสอบว่ารูปมองเห็นได้จริง
    const style = window.getComputedStyle(img);
    if (style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        img.offsetParent === null) {
      return;
    }

    // ตรวจสอบว่ารูปเป็นรูปที่โหลดสมบูรณ์
    if (!img.complete || !img.naturalWidth) {
      return;
    }

    // จ้าง canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // กำหนดขนาด canvas
    const scale = window.devicePixelRatio;
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    ctx.scale(scale, scale);

    // จับภาพหน้าจอ
    const imageData = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Capture timeout'));
      }, 10000);

      chrome.runtime.sendMessage(
        {
          type: 'captureTab',
        } as CaptureTabMessage,
        (response: CaptureTabResponse) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error('Capture failed'));
          } else if (!response || !response.dataUrl) {
            resolve('');
          } else {
            resolve(response.dataUrl);
          }
        }
      );
    });
    


    // วาดภาพที่จับมาลง canvas
    const capturedImg = new Image();
    await new Promise<void>((resolve, reject) => {
      capturedImg.onload = () => {
        try {
          const sx = Math.round(rect.left * scale);
          const sy = Math.round(rect.top * scale);
          const sw = Math.round(rect.width * scale);
          const sh = Math.round(rect.height * scale);




          ctx.drawImage(
            capturedImg,
            sx, sy, sw, sh,
            0, 0, rect.width, rect.height
          );
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      capturedImg.onerror = reject;
      capturedImg.src = imageData;
    });




    // แปลง canvas เป็น base64
    const croppedImageData = canvas.toDataURL('image/png');




    // --- ส่วนที่เปลี่ยนแปลง ---
    // เดิม: ส่งรูปไป Vision API ด้วย fetch
    /*
    const visionResponse = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{
          image: {
            content: croppedImageData.split(',')[1]
          },
          features: [{
            type: 'TEXT_DETECTION',
            maxResults: 50
          }],
          imageContext: {
            languageHints: ['ko', 'ja', 'zh']
          }
        }]
      })
    });

    if (!visionResponse.ok) {
      throw new Error(`Vision API error: ${visionResponse.status}`);
    }
    const ocrResult = await visionResponse.json();
    */

 // ใหม่: ส่ง Message ไปให้ background script เพื่อให้จัดการ offscreen document
console.log('[CS] Sending request to background to handle OCR via Offscreen...');
const ocrResult = await new Promise<any>((resolve, reject) => {
    const listener = (message: any) => {
        if (message.type === 'ocr-offscreen-response') {
            chrome.runtime.onMessage.removeListener(listener);
            if (message.error) {
                reject(new Error(message.error));
            } else {
                resolve(message.data);
            }
        }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({
        type: 'perform-ocr-in-offscreen',
        imageData: croppedImageData
    });
});
console.log('[CS] Received OCR result from background/offscreen.');
    // --- สิ้นสุดส่วนที่เปลี่ยนแปลง ---


    if (!ocrResult.responses?.[0]?.textAnnotations?.length) {
      console.log('[CS] No text found in OCR result.');
      return;
    }





    // จัดกลุ่มละเเรียงลำดับข้อความจากบนลงล่าง
    const textGroups = groupNearbyText(ocrResult.responses[0].textAnnotations.slice(1))
      .sort((a, b) => {
        const aTop = Math.min(...a.map(t => t.boundingPoly.vertices[0].y));
        const bTop = Math.min(...b.map(t => t.boundingPoly.vertices[0].y));
        return aTop - bTop;
      });




    // สร้าง container หลักสำหรับทุก overlay
    const mainContainer = document.createElement('div');
    mainContainer.className = 'translation-main-container';
    mainContainer.dataset.imgId = img.src;
    mainContainer.style.cssText = `
      position: absolute;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      pointer-events: none;
      z-index: 10000;
      padding: '1px 30px',
    `;




    // แปลแต่ละกลุ่มข้อความ
    let previousBottom = -Infinity;
    for (const group of textGroups) {
      // คำนวณตำแหน่งที่แม่นยำ
      const bounds = {
        left: Math.min(...group.map(t => Math.min(...t.boundingPoly.vertices.map(v => v.x)))) / scale,
        right: Math.max(...group.map(t => Math.max(...t.boundingPoly.vertices.map(v => v.x)))) / scale,
        top: Math.min(...group.map(t => Math.min(...t.boundingPoly.vertices.map(v => v.y)))) / scale,
        bottom: Math.max(...group.map(t => Math.max(...t.boundingPoly.vertices.map(v => v.y)))) / scale
      };


      const actualLeft = rect.left + bounds.left;
      const actualTop = rect.top + bounds.top;
      const actualWidth = bounds.right - bounds.left;
      const actualHeight = bounds.bottom - bounds.top;


      // สิเคราะห์สีจากพื้นที่ข้อความต้นฉบับ
      const colors = analyzeColors(
        ctx,
        Math.round(bounds.left),
        Math.round(bounds.top),
        Math.round(actualWidth),
        Math.round(actualHeight)
      );




      // สร้าง container เหมือนเดิม แต่เพิ่มการกำหนดสี
      const container = document.createElement('div');
      container.className = 'translation-overlay-container';
      Object.assign(container.style, {
        position: 'absolute',
        left: `${actualLeft}px`,
        top: `${actualTop}px`,
        width: `${actualWidth}px`,
        height: `${actualHeight}px`,
        background: colors.background,
        backdropFilter: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1px 0px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
        lineHeight: '1.2',
        maxHeight: `${actualHeight * 1.5}px`
      });

      const translationText = document.createElement('div');
      translationText.className = 'translation-text';

      // คำนวณ fontSize
      const fontSize = Math.min(actualHeight * 0.99, window.innerWidth <= 480 ? 14 : 17) * fontSizeMultiplier;
      Object.assign(translationText.style, {
        fontSize: `${fontSize}px`,
        color: colors.text,
        lineHeight: '1.37',
        whiteSpace: 'normal',
        width: '100%',
        textAlign: 'center',
         wordBreak: 'break-word',
         padding: '0px', // เพิ่ม padding เพื่อสร้างพื้นที่ในกล่อง
      });




      // แปลละแสดงผล
      const originalText = group.map(t => t.description).join(' ');

      // เพิ่มการตรวจสอบก่อนแปล
      if (shouldSkipTranslation(originalText)) {
        continue; // ข้ามการแปลถ้าเป็นข้อความที่ไม่ต้องแปล
      }

      try {
        // สร้างฟังก์ชันสำหรับแสดงผลข้อความ
        const displayText = (text: string) => {
          // ใช้ textContent แทน innerHTML พื่ป้องกันการแปลง entities
          translationText.textContent = text
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
        };




        // แปลข้อความและแสดงผล
        const translatedResult = await translateText(originalText);
        displayText(translatedResult);
        container.appendChild(translationText);




        // ปรับ scale ถ้าข้อความยาวเกินไป
        requestAnimationFrame(() => {
          const textWidth = translationText.scrollWidth;
          if (textWidth > actualWidth) {
            const scale = actualWidth / textWidth;
            container.style.transform = `scale(${scale})`;
          }
        });




        overlay.appendChild(container);




        // แสดง animation
        requestAnimationFrame(() => {
          container.style.opacity = '1';
        });

        // ถ้าข้อความมีการขึ้นบรรทัดใหม่
        if (translatedResult.includes('\n')) {
          container.style.whiteSpace = 'pre-line'; // รักษาการขึ้นบรรทัดใหม่แต่รวมช่องว่างซ้ำ
        }
      } catch (error) {
        showToast('การแปลผิดพลาด กรุณาลองใหม่อีกครั้ง', 'error');
      }
    }




    // ลบ overlay เก่าก่อนเพิ่มอันใหม่
    const oldContainer = overlay.querySelector(`.translation-main-container[data-img-id="${img.src}"]`);
    if (oldContainer) {
      oldContainer.remove();
    }
    overlay.appendChild(mainContainer);







  } catch (error) {
    showToast('การแปลผิดพลาด กรุณาลองใหม่อีกครั้ง', 'error');
    console.error('[CS] Error in translateImage function:', error);
  }
}




// ฟังก์ชันหยุดการแปล
function stopRealTimeTranslation() {
  // ล้างค่า observer
  if (translationObserver) {
    translationObserver.disconnect();
    translationObserver = null;
  }

  // ล้างคำแปลทั้งหมด
  const translations = document.querySelectorAll('.translation-overlay-container, .translation-main-container');
  translations.forEach(translation => {
    translation.remove();
  });


  // รีเซ็ตค่าต่างๆ
  lastTranslationTimestamp = 0;
  isTranslating = false;
  fontSizeMultiplier = 1.0;
  spreadThreshold = 0.61;
  targetLanguage = 'th';
  isGeminiMode = false;
  translationCache.clear();
  colorAnalysisCache.clear();

  // รีเซ็ตการแสดงผล UI
  const fontSizeDisplay = document.querySelector('span') as HTMLSpanElement;
  if (fontSizeDisplay) {
    fontSizeDisplay.textContent = '100%';
  }
  if (spreadDisplay) {
    spreadDisplay.textContent = `${Math.round(spreadThreshold * 100)}%`;
  }

  // ล้าง overlay
  const overlay = document.querySelector('.translate-overlay');
  if (overlay) {
    overlay.innerHTML = '';
  }

  // รีเซ็ตโหมด AI
  isGeminiMode = false;
  
  // อัพเดทปุ่ม UI
  const grammarButton = document.querySelector('button[data-gemini-button]');
  if (grammarButton instanceof HTMLElement) {
    grammarButton.innerHTML = '🤖 แปลด้วย AI';
    grammarButton.style.background = 'linear-gradient(to bottom, #34a853, #2d9144)';
  }
}




// เพิ่มตัวแปรควบคุมโหมดการแปล
let isGeminiMode = false;




// เพิ่มฟังก์ชันสำหรับดึงค่าพิกัดจุดยอดด
interface Vertex {
  x: number;
  y: number;
}




function getVertexValue(vertices: Vertex[], index: number): Vertex {
  // ตรวจสอบความถูกต้องของ index
  if (index < 0 || index >= vertices.length) {
    throw new Error(`Invalid vertex index: ${index}`);
  }




  // ดึงค่าพิกัด x, y จากจุยอด
  const vertex = vertices[index];
  if (!vertex || typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
    throw new Error(`Invalid vertex data at index ${index}`);
  }




  return {
    x: Math.round(vertex.x), // ปัดเศษให้เป็นจำนวนต็ม
    y: Math.round(vertex.y)
  };
}




// ตรับปรุงฟังงก์ชัน groupNearbyText
function groupNearbyText(annotations: TextAnnotation[]): TextAnnotation[][] {
  // เรียงลำดับข้อความตามตำแหน่ง Y ก่อน
  const sortedAnnotations = [...annotations].sort((a, b) => {
    const aTop = Math.min(...a.boundingPoly.vertices.map(v => v.y));
    const bTop = Math.min(...b.boundingPoly.vertices.map(v => v.y));
    return aTop - bTop;
  });

  const groups: TextAnnotation[][] = [];
  const used = new Set<number>();
  const lineHeight = getAverageLineHeight(annotations);

  for (let i = 0; i < sortedAnnotations.length; i++) {
    if (used.has(i)) continue;

    const currentTop = Math.min(...sortedAnnotations[i].boundingPoly.vertices.map(v => v.y));
    const currentLine: TextAnnotation[] = [];

    // หาข้อความที่อยู่ในบรรทัดเดียวกัน
    for (let j = i; j < sortedAnnotations.length; j++) {
      if (used.has(j)) continue;

      const text = sortedAnnotations[j];
      const nextTop = Math.min(...text.boundingPoly.vertices.map(v => v.y));

      if (Math.abs(nextTop - currentTop) < lineHeight * 0.5) {
        currentLine.push(text);
        used.add(j);
      }
    }

    if (currentLine.length > 0) {
      // เรียงข้อความจากซ้ายไปขวา
      currentLine.sort((a, b) => {
        const aLeft = Math.min(...a.boundingPoly.vertices.map(v => v.x));
        const bLeft = Math.min(...b.boundingPoly.vertices.map(v => v.x));
        return aLeft - bLeft;
      });

      // ตรวจสอบว่าควรแยกกลุ่มหรือไม่
      const imageWidth = Math.max(...annotations.flatMap(a => a.boundingPoly.vertices.map(v => v.x)));
      const positions = currentLine.map(text => {
        const centerX = (Math.min(...text.boundingPoly.vertices.map(v => v.x)) +
                        Math.max(...text.boundingPoly.vertices.map(v => v.x))) / 2;
        return centerX / imageWidth; // คำนวณตำแหน่งเป็นเปอร์เซ็นต์
      });

      // ตรวจสอบการกระจายตัวของข้อความ
      const spread = Math.max(...positions) - Math.min(...positions);

      if (spread > spreadThreshold) { // ใช้ค่า spreadThreshold แทนค่าคงที่
        // แยกกลุ่มตามตำแหน่ง
        const byPosition = currentLine.reduce((acc, text) => {
          const centerX = (Math.min(...text.boundingPoly.vertices.map(v => v.x)) +
                          Math.max(...text.boundingPoly.vertices.map(v => v.x))) / 2;
          const position = centerX < imageWidth * 0.4 ? 'left' :
                          centerX > imageWidth * 0.6 ? 'right' : 'center';
          if (!acc[position]) acc[position] = [];
          acc[position].push(text);
          return acc;
        }, {} as Record<string, TextAnnotation[]>);

        // เพิ่มแต่ละกลุ่มที่มีข้อความ
        ['left', 'center', 'right'].forEach(position => {
          if (byPosition[position]?.length > 0) {
            groups.push(byPosition[position]);
          }
        });
      } else {
        // ถ้าข้อความอยู่ใกล้กัน ให้รวมเป็นกลุ่มเดียว
        groups.push(currentLine);
      }
    }
  }

  return groups;
}

// ลบฟังก์ชัน getBoundingRect อันแรกออก และใ้อันนี้แทน
function getBoundingRect(vertices: Vertex[]) {
  try {
    // ดึงค่าพิกัดแต่่ละจุด
    const topLeft = getVertexValue(vertices, 0);     // มุมบนซ้าย
    const topRight = getVertexValue(vertices, 1);    // มุมบนขวา
    const bottomRight = getVertexValue(vertices, 2); // มุมล่างขวา
    const bottomLeft = getVertexValue(vertices, 3);  // มุมล่างซ้าย

    return {
      left: Math.min(topLeft.x, bottomLeft.x),
      right: Math.max(topRight.x, bottomRight.x),
      top: Math.min(topLeft.y, topRight.y),
      bottom: Math.max(bottomLeft.y, topLeft.y),
      width: Math.abs(topRight.x - topLeft.x),
      height: Math.abs(bottomLeft.y - topLeft.y)
    };
  } catch (error) {
    console.error('Error getting bounding rect:', error);
    // ส่งงค่าเริ่มต้นถ้าเกิดข้อผิดพลาด
    return {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0
    };
  }
}




// ตรวจสอบว่าเป็นรูปที่ต้องการแปลหรือไม่
function shouldTranslateImage(img: HTMLImageElement): boolean {
  // ตรวจสอบขนาด - โฆษณามกมีขนาดมาตรฐาน
  const rect = img.getBoundingClientRect();
  const minSize = 30; // ขนาดขั้นต่ำที่จะแปล
  if (rect.width < minSize || rect.height < minSize) {
    return false;
  }

  // ตรวจสอบ class และ id ที่มักใช้กับโษณา
  const adPatterns = [
    'ad', 'ads', 'advertisement', 'banner', 'sponsor',
    'popup', 'modal', 'overlay', 'promotion'
  ];

  const elementClasses = img.className.toLowerCase();
  const elementId = img.id.toLowerCase();
  const parentClasses = img.parentElement?.className.toLowerCase() || '';
  const parentId = img.parentElement?.id.toLowerCase() || '';










  if (adPatterns.some(pattern =>
    elementClasses.includes(pattern) ||
    elementId.includes(pattern) ||
    parentClasses.includes(pattern) ||
    parentId.includes(pattern)
  )) {
    return false;
  }



  // ตรวสอบ URL ของรูป
  const imgUrl = img.src.toLowerCase();
  const adDomains = [
    'ads', 'adserver', 'advertising', 'doubleclick',
    'googleads', 'banner', 'promotions'
  ];

  if (adDomains.some(domain => imgUrl.includes(domain))) {
    return false;
  }

  // ตรวสอบตำหน่งงของรูป
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // รูป้องอยู่ในพื้นที่เนื้อหลักของเนื้อหา (ไม่อยู่ชิดขอบมากเกิไป)
  const margin = 0.1; // 10% margin
  const isInMainContent =
    rect.left > viewportWidth * margin &&
    rect.right < viewportWidth * (1 - margin);





  if (!isInMainContent) {
    return false;
  }

  // ตรวจสอบอัตราส่วนขงรูป
  const aspectRatio = rect.width / rect.height;
  const isNormalAspectRatio = aspectRatio > 0.3 && aspectRatio < 2.5;

  if (!isNormalAspectRatio) {
    return false;
  }




  // ตรวจสอบว่าอยู่ในพื้นที่เนื้อหาหลักหรือไม่
  const mainContent = document.querySelector('main, article, .content, #content');
  if (mainContent) {
    return mainContent.contains(img);
  }




  return true;
}


// เพพิ่มฟังก์ชันคำนวณความสูงเฉลี่ยของบรรทัด
function getAverageLineHeight(annotations: TextAnnotation[]): number {
  const heights = annotations.map(a => {
    const vertices = a.boundingPoly.vertices;
    return Math.max(...vertices.map(v => v.y)) - Math.min(...vertices.map(v => v.y));
  });

  return heights.reduce((a, b) => a + b, 0) / heights.length;
}




// เพิ่มกังก์ชันตวจสอบว่า rect ยังอย่ในหน้าจอหรือไม่
function isRectVisible(rect: DOMRect): boolean {

  return rect.top < window.innerHeight &&
         rect.bottom > 0 &&
         rect.left < window.innerWidth &&
         rect.right > 0;
}




// เพิ่มฟังก์ชัน debounce
function debounce<T extends Function>(func: T, wait: number): T {
  let timeout: NodeJS.Timeout;
  return function(this: any, ...args: any[]) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  } as any as T;
}

// เพิ่มตัวแปรเก็บเวลา scroll
let lastScrollTime = 0;

// ปรับปรุงฟังก์ชัน debouncedScrollHandler
const debouncedScrollHandler = debounce(() => {
  if (!isTranslating) return;

  const currentTime = Date.now();
  const currentScrollY = window.scrollY;
  
  // ตรวจสอบว่าเป็นการ scroll จริง
  if (Math.abs(currentScrollY - lastScrollY) > SCROLL_THRESHOLD) {
    
    isScrolling = true;
    lastScrollTime = currentTime;
    
    // ล้างคำแปลแบบ batch operation
    requestAnimationFrame(() => {
      const allTranslations = document.querySelectorAll(
        '.translation-overlay-container, .translation-main-container'
      );
      const fragment = document.createDocumentFragment();
      allTranslations.forEach(translation => fragment.appendChild(translation));
      fragment.textContent = '';
      translationCache.clear();
    });
  }

  // รอให้หยุด scroll จริงๆ
  let lastCheckY = currentScrollY;
  let checkCount = 0;
  
  const checkScrollStop = () => {
    const newY = window.scrollY;
    if (Math.abs(newY - lastCheckY) < 2) { // ผ่อนคลายการตรวจจับการหยุด
      checkCount++;
      if (checkCount >= 2) { // ตรวจสอบ 2 ครั้งเพื่อยืนยันการหยุด
        isScrolling = false;
        lastTranslationTimestamp = currentTime;
        
        const overlay = document.querySelector('.translate-overlay');
        if (overlay instanceof HTMLElement && translationObserver !== null) {
          requestAnimationFrame(() => {
            translationObserver?.disconnect();
            translationObserver = startRealTimeTranslation(overlay);
          });
        }
        return;
      }
    } else {
      checkCount = 0;
    }
    lastCheckY = newY;
    requestAnimationFrame(checkScrollStop);
  };

  setTimeout(() => requestAnimationFrame(checkScrollStop), CLEAR_DELAY);
  lastScrollY = currentScrollY;
}, SCROLL_DELAY);

window.addEventListener('scroll', debouncedScrollHandler);




// เพิ่มฟังก์ชัน helper ใหม่ตรงนี้
function getColorAt(ctx: CanvasRenderingContext2D, x: number, y: number): { r: number; g: number; b: number } {
  try {
    const imageData = ctx.getImageData(x, y, 1, 1).data;
    return { r: imageData[0], g: imageData[1], b: imageData[2] };
  } catch (error) {
    return { r: 255, g: 255, b: 255 }; // ค่าสีเริ่มต้นเมื่อเกิดข้อผิดพลาด
  }
}

function colorDifference(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  return (
    Math.abs(c1.r - c2.r) +
    Math.abs(c1.g - c2.g) +
    Math.abs(c1.b - c2.b)
  );
}

// ฟังก์ชัน analyzeColors ตามโค้ดที่ให้ไว้ก่อนหน้า
function analyzeColors(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  try {
    const SHAPE_DETECTION_PADDING = 3;
    const EDGE_SAMPLING_POINTS = 16; // เพิ่มจุดตัวอย่าง
    
    // ตรวจจับกรอบแบบใหม่ด้วยการตรวจสอบหลายจุด
    const isShaped = detectSolidSurroundingV2(ctx, x, y, width, height, SHAPE_DETECTION_PADDING);

    if (!isShaped) {
      return { background: 'rgba(255,255,255,0.95)', text: 'rgb(0,0,0)' };
    }

    // สุ่มตัวอย่างสีจากเส้นขอบแบบใหม่
    const perimeterSamples = getEnhancedPerimeterSamples(x, y, width, height, EDGE_SAMPLING_POINTS);
    const perimeterColors = perimeterSamples.map(p => getColorAt(ctx, p.x, p.y));

    // หาสีหลักด้วยอัลกอริทึมใหม่
    const dominantColor = calculateEnhancedDominantColor(perimeterColors);

    // ตรวจสอบสีบริสุทธิ์
    if (isPureBlack(dominantColor)) {
      return { background: 'rgba(0,0,0,0.95)', text: 'rgb(255,255,255)' };
    }
    if (isPureWhite(dominantColor)) {
      return { background: 'rgba(255,255,255,0.95)', text: 'rgb(0,0,0)' };
    }

    // ตรวจสอบ contrast แบบปรับปรุง
    const textColor = getEnhancedContrastColor(dominantColor);
    if (colorDifference(dominantColor, textColor) < 150) { // เพิ่มความต่างขั้นต่ำ
      return { 
        background: 'rgba(255,255,255,0.95)', 
        text: 'rgb(0,0,0)' 
      };
    }

    return {
      background: `rgba(${dominantColor.r},${dominantColor.g},${dominantColor.b},0.95)`,
      text: `rgb(${textColor.r},${textColor.g},${textColor.b})`
    };

  } catch (error) {
    return { background: 'rgba(255,255,255,0.95)', text: 'rgb(0,0,0)' };
  }
}

// ฟังก์ชันตรวจจับกรอบแบบใหม่ที่แม่นยำขึ้น
function detectSolidSurroundingV2(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  padding: number
): boolean {
  const perimeter = getEnhancedPerimeterSamples(
    x - padding, 
    y - padding, 
    w + 2*padding, 
    h + 2*padding, 
    24
  );
  
  const centerColor = getColorAt(ctx, x + w/2, y + h/2);
  let edgeMatches = 0;

  perimeter.forEach(p => {
    const pColor = getColorAt(ctx, p.x, p.y);
    // ใช้เกณฑ์ความต่างสีที่ปรับปรุงแล้ว
    if (colorDifference(centerColor, pColor) > 25) { 
      edgeMatches++;
    }
  });

  return edgeMatches >= perimeter.length * 0.75; // ต้องมีสีต่าง 75% ของขอบ
}

// ฟังก์ชันตรวจสอบสีดำบริสุทธิ์
function isPureBlack(color: { r: number, g: number, b: number }): boolean {
  return color.r === 0 && color.g === 0 && color.b === 0 && 
         (color.r + color.g + color.b) === 0;
}

// ฟังก์ชันตรวจสอบสีขาวบริสุทธิ์
function isPureWhite(color: { r: number, g: number, b: number }): boolean {
  return color.r === 255 && color.g === 255 && color.b === 255 && 
         (color.r + color.g + color.b) === 765;
}

// ฟังก์ชันคำนวณสีหลักแบบใหม่
function calculateEnhancedDominantColor(colors: { r: number, g: number, b: number }[]) {
  const colorCounts = new Map<string, number>();
  
  colors.forEach(color => {
    const key = `${color.r},${color.g},${color.b}`;
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
  });

  let maxCount = 0;
  let dominant = { r: 255, g: 255, b: 255 };
  
  colorCounts.forEach((count, key) => {
    if (count > maxCount) {
      const [r, g, b] = key.split(',').map(Number);
      dominant = { r, g, b };
      maxCount = count;
    }
  });

  return dominant;
}

// ฟังก์ชัน contrast แบบปรับปรุง
function getEnhancedContrastColor(bg: { r: number, g: number, b: number }) {
  const luminance = (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255;
  
  // เพิ่มเงื่อนไขตรวจสอบความต่างสีแบบสัมพัทธ์
  const brightnessThreshold = 0.65;
  const isDark = luminance < brightnessThreshold;
  
  // ใช้สีขาวเมื่อพื้นหลังเข้มกว่าเกณฑ์
  return isDark 
    ? { r: 255, g: 255, b: 255 } 
    : { r: 0, g: 0, b: 0 };
}

// สร้างจุดตัวอย่างรอบปริมณฑลแบบใหม่
function getEnhancedPerimeterSamples(x: number, y: number, w: number, h: number, points: number) {
  const samples = [];
  const steps = Math.floor(points / 4);
  
  // เพิ่มจุดตัวอย่าง 3 ชั้น (วงใน, กลาง, วงนอก)
  for (let i = 0; i < steps; i++) {
    // วงใน (offset 1px)
    samples.push({ x: x + 1 + (w * i/steps), y: y + 1 });
    samples.push({ x: x + w - 1, y: y + 1 + (h * i/steps) });
    samples.push({ x: x + w - 1 - (w * i/steps), y: y + h - 1 });
    samples.push({ x: x + 1, y: y + h - 1 - (h * i/steps) });
    
    // วงกลาง (offset 2px)
    samples.push({ x: x + 2 + (w * i/steps), y: y + 2 });
    samples.push({ x: x + w - 2, y: y + 2 + (h * i/steps) });
    samples.push({ x: x + w - 2 - (w * i/steps), y: y + h - 2 });
    samples.push({ x: x + 2, y: y + h - 2 - (h * i/steps) });
    
    // วงนอก (offset 3px)
    samples.push({ x: x - 3 + (w * i/steps), y: y - 3 });
    samples.push({ x: x + w + 3, y: y - 3 + (h * i/steps) });
    samples.push({ x: x + w + 3 - (w * i/steps), y: y + h + 3 });
    samples.push({ x: x - 3, y: y + h + 3 - (h * i/steps) });
  }
  
  return samples;
}

// เพิ่มกรจาทำงานเมื่อโหลดหน้าเว็บ
createTranslateOverlay();




// เพิ่มการล้างค่าเมื่อปิดหน้าหรือรีเฟรช
window.addEventListener('beforeunload', () => {
  stopRealTimeTranslation();
});




function shouldSkipTranslation(text: string): boolean {
  const skipPatterns = [

     // ลายน้ำและเว็บไซต์
     /MANHWA18\.cc/i,
     /(가장\s*빠른\s*웹툰제공사이트|가방때은\s*법문세공사이트)/i,
     /웹툰왕국뉴토끼\d+/i, // ตรงกับ "웹툰왕국뉴토끼466"
     /HTTPS?:\/\/NEWTOKI\d+\.COM/i,// ตรงกับ "HTTPS://NEWTOKI466.COM"
 
     // รูปแบบ URL ทั่วไป
    /HTTPS?:\/\/[A-Z0-9.-]+\.[A-Z]{2,}/i,


    // รูปแบบโดเมนเว็บมังฮวา/เว็บตูน
    /(manhwa|webtoon|toon|manga)\d*\.(com|net|org|cc)/i,


    // คำที่เกี่ยวกับลิขสิทธิ์/ลายน้ำ
    /copyright/i,
    /all rights reserved/i,
    /watermark/i,


    // เว็บเกาหลีทั่วไป
    /[A-Za-z0-9]+\.kr/i,

 
    // เพิ่มรูปแบบโฆษณาแบบซ่อน
    /\[AD\]|\[ad\]|ad:/i,
    //i,
    /data-ad-|data-ads/i,
    /<ins[^>]+adsbygoogle/i,
    
    // ปรับปรุง regex URL
    /^(https?|ftp|mailto):\/\/[^\s]*/i,
    /[?&](utm_|ref=|source=|campaign=)/i,
    
    // เพิ่มรูปแบบ tracking pixels
    /^1x1\.gif$/i,
    /pixel\.gif(\?.*)?$/i,
    /transparent\.gif(\?.*)?$/i,
    
    // เพิ่มรูปแบบโฆษณาเกาหลี
    /[\uAC00-\uD7AF]{5,}/, // ข้อความเกาหลียาว
    /[\u4E00-\u9FFF]{5,}/, // ข้อความจีนยาว
    
    // เพิ่มการตรวจสอบ hash
    /^[a-f0-9]{32}$/i, // MD5
    /^[a-f0-9]{40}$/i, // SHA-1
    
    // เพิ่มรูปแบบข้อมูลระบบ
    /^[A-Z0-9_]+$/, // ตัวพิมพ์ใหญ่ทั้งหมด

     // เพิ่มรูปแบบโฆษณาแบบซ่อนใหม่
     /ad[s]?[-_](container|wrapper|frame|unit)/i, // โครงสร้างโฆษณา
     /(doubleclick|googleadservices|adform)\./i, // โฆษณา network
     /(affiliate|partner|tracking)/i, // ลิงค์พันธมิตร
     /(popup|modal|overlay|interstitial)/i, // โฆษณาป๊อปอัพ
     /(banner|leaderboard|skyscraper)/i, // ประเภทโฆษณา
     /(impression|click|conversion)/i, // เมตริกโฆษณา
     /(pixel|beacon|tag)/i, // tracking technologies
     /(sponsor|promoted|recommended)/i, // เนื้อหาสปอนเซอร์
     /(offer|deal|discount|coupon)/i, // โปรโมชั่น
     /(subscribe|signup|register)/i, // ฟอร์มสมัคร
     /(notification|alert|message)/i, // การแจ้งเตือน
     /(social|share|follow)/i, // ปุ่ม social media
     /(cookie|consent|gdpr)/i, // แถบคุกกี้
     /(analytics|metrics|stats)/i, // การวิเคราะห์
     /(script|iframe|embed)/i, // โค้ดภายนอก
     /(redirect|gateway|bridge)/i, // ลิงค์ redirect
     /(utm|ref|source)=/i, // tracking parameters
     /^[a-z0-9]{32}$/i, // hash-based IDs
     /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i // UUIDs
  ];

  // ตรวจสอบความยาวข้อความ
  if (text.length > 200) return false; // ไม่กรองข้อความยาว
  
  return skipPatterns.some(pattern => pattern.test(text));
}

function resetTranslationMode() {
  translationMode = 'normal';
  const modeBtn = document.querySelector('#translation-controls button:first-child');
  if (modeBtn instanceof HTMLElement) {
    modeBtn.textContent = 'Switch to AI Mode';
  }
  
  // รีเซ็ตปุ่ม AI
  const grammarButton = document.querySelector('button[data-gemini-button]');
  if (grammarButton instanceof HTMLElement) {
    grammarButton.innerHTML = '🤖 แปลด้วย AI';
    grammarButton.style.background = 'linear-gradient(to bottom, #34a853, #2d9144)';
  }
  
  // ลบ overlay
  document.querySelectorAll('.translation-overlay').forEach(el => el.remove());
}

// ประกาศตัวแปรที่ถูกต้อง
let translationMode: 'normal' | 'ai' = 'normal';