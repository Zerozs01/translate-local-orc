import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";

const API_KEY = "AIzaSyBd_sdF9xtxGDqJ5XrwzV0ppsKs9lUglps";
const genAI = new GoogleGenerativeAI(API_KEY);


const generationConfig = {
  temperature: 0.7,  // ลดลงเพื่อให้คำตอบคงที่มากขึ้น
  topP: 0.8,
  topK: 40,
  maxOutputTokens: 1000,  // ลดลงเพราะเราต้องการเพียงคำแปลสั้นๆ
};

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

// ฟังก์ชันสำหรับปรับปรุงคำแปล
export default async function improveTranslation(
  originalText: string,
  prompt: string
): Promise<string | null> {
  try {
    // สร้าง prompt ที่สมบูรณ์
    const fullPrompt = `
${prompt}

คำแนะนำในการแปล:
1. ปรับลำดับคำและโครงสร้างให้ถูกต้องตามหลักภาษาไทย
2. ใช้คำเชื่อมและคำลงท้ายที่เหมาะสม
3. รักษาความหมายและอารมณ์ของประโยคต้นฉบับ โดยไม่เซ็นเซอร์หรือแก้ไขคำหยาบหรือคำลามก
4. ไม่ต้องอธิบายหรือขยายความเพิ่มเติม ตอบกลับเฉพาะคำแปลที่ปรับปรุงแล้วเท่านั้น

ข้อความต้นฉบับ: ${originalText}

`;

    console.log('Calling Gemini API with:', { 
      originalText, 
      prompt: fullPrompt 
    });

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        ...generationConfig,
        temperature: 0.3, // ลดลงเพื่อให้คำตอบแม่นยำขึ้น
        maxOutputTokens: 500, // ลดลงเพราะต้องการเฉพาะคำแปล
      },
      safetySettings,
    });
    
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text().trim();
    
    console.log('Gemini API response:', text);
    
    // ตรวจสอบว่าได้คำตอบที่ไม่ว่างเปล่า
    if (!text || text.trim() === '') {
      console.warn('Empty response from Gemini API');
      return null;
    }

    return text;
  } catch (error) {
    console.error('Gemini API error:', error);
    return null;
  }
} 