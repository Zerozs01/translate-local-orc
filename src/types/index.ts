// Message types
export interface TranslationObserver {
  disconnect: () => void;
}

export interface CaptureTabMessage {
  type: 'captureTab';
}

export interface CaptureTabResponse {
  dataUrl?: string;
  error?: string;
}

// API types
export interface Vertex {
  x: number;
  y: number;
}

export interface TextAnnotation {
  description: string;
  boundingPoly: {
    vertices: Vertex[];
  };
}

export interface VisionResponse {
  responses: Array<{
    textAnnotations?: TextAnnotation[];
  }>;
} 