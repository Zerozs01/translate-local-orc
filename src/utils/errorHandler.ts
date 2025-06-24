export class TranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslationError';
  }
}

export const handleTranslationError = (error: any): string => {
  console.error('Translation error:', error);
  
  if (error.code === 'ENOENT') {
    return 'ไม่พบไฟล์ credentials กรุณาตรวจสอบการตั้งค่า';
  }
  
  if (error.code === 'PERMISSION_DENIED') {
    return 'ไม่มีสิทธิ์เข้าถึง API กรุณาตรวจสอบ credentials';
  }
  
  return 'เกิดข้อผิดพลาดในการแปลภาษา กรุณาลองใหม่อีกครั้ง';
}; 