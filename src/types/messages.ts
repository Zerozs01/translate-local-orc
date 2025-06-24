export interface FetchImageMessage {
  type: 'fetchImage';
  url: string;
}

export interface FetchImageResponse {
  data?: string;
  error?: string;
}

export interface CaptureElementMessage {
  type: 'captureElement';
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface CaptureElementResponse {
  dataUrl?: string;
  error?: string;
} 