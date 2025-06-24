interface ColorAnalysisCacheEntry {
  result: {
    background: string;
    text: string;
  };
  timestamp: number;
}

const colorAnalysisCache = new Map<string, ColorAnalysisCacheEntry>();

function analyzeColors(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  try {
    const cacheKey = `${x}-${y}-${width}-${height}`;
    const now = Date.now();
    const cached = colorAnalysisCache.get(cacheKey);

    if (cached && now - cached.timestamp < 1000) {
      return cached.result;
    }

    const padding = Math.min(5, Math.max(2, Math.floor(Math.min(width, height) * 0.05)));
    const safeX = Math.floor(x - padding);
    const safeY = Math.floor(y - padding);
    const safeWidth = Math.floor(width + padding * 2);
    const safeHeight = Math.floor(height + padding * 2);

    const sampleStep = Math.max(1, Math.floor(Math.min(safeWidth, safeHeight) / 50));

    const imageData = ctx.getImageData(safeX, safeY, safeWidth, safeHeight);
    const data = new Uint8ClampedArray(imageData.data.buffer);

    const colorStats = {
      dark: 0,
      light: 0,
      white: 0,
      grey: 0,
      colored: 0,
      total: 0,
      edgePixels: 0,
      edgeDark: 0
    };

    const regions = {
      center: { dark: 0, light: 0, total: 0 },
      edge: { dark: 0, light: 0, total: 0 }
    };

    for (let y = 0; y < safeHeight; y += sampleStep) {
      for (let x = 0; x < safeWidth; x += sampleStep) {
        const i = (y * safeWidth + x) * 4;
        const a = data[i + 3];
        if (a < 128) continue;

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const luminance = (r * 299 + g * 587 + b * 114) / 1000;
        const colorDeviation = Math.max(
          Math.abs(r - g),
          Math.abs(g - b),
          Math.abs(r - b)
        );

        const isEdgePixel = 
          x < padding * 2 || 
          x > safeWidth - padding * 2 || 
          y < padding * 2 || 
          y > safeHeight - padding * 2;

        const region = isEdgePixel ? regions.edge : regions.center;

        if (luminance < 128) {
          region.dark++;
          if (isEdgePixel) colorStats.edgeDark++;
        } else {
          region.light++;
        }
        region.total++;

        if (luminance < 40) colorStats.dark++;
        else if (luminance > 200) colorStats.white++;
        else if (colorDeviation < 20) colorStats.grey++;
        else colorStats.colored++;

        if (isEdgePixel) colorStats.edgePixels++;
        colorStats.total++;
      }
    }

    const darkRatio = colorStats.dark / colorStats.total;
    const whiteRatio = colorStats.white / colorStats.total;
    const greyRatio = colorStats.grey / colorStats.total;
    const edgeDarkRatio = regions.edge.dark / regions.edge.total;
    const centerDarkRatio = regions.center.dark / regions.center.total;

    const isManga = greyRatio > 0.6 || (whiteRatio + darkRatio > 0.75);
    const hasTextBox = Math.abs(centerDarkRatio - edgeDarkRatio) > 0.3;
    
    let opacity = isManga ? 0.92 : 0.95;
    if (hasTextBox) opacity = Math.min(opacity + 0.03, 0.98);

    let result;
    if (darkRatio > 0.6 || edgeDarkRatio > 0.7) {
      result = {
        background: `rgba(0,0,0,${opacity})`,
        text: isManga ? 'rgb(255,255,255)' : 'rgb(240,240,240)'
      };
    } else if (whiteRatio > 0.7) {
      result = {
        background: `rgba(255,255,255,${opacity})`,
        text: isManga ? 'rgb(0,0,0)' : 'rgb(20,20,20)'
      };
    } else {
      const isDark = (darkRatio + greyRatio * 0.5) > 0.5;
      result = {
        background: isDark 
          ? `rgba(0,0,0,${opacity})`
          : `rgba(255,255,255,${opacity})`,
        text: isDark
          ? 'rgb(255,255,255)'
          : 'rgb(0,0,0)'
      };
    }

    colorAnalysisCache.set(cacheKey, {
      result,
      timestamp: now
    });

    return result;
  } catch (error) {
    console.error('Color analysis error:', error);
    return {
      background: 'rgba(255,255,255,0.95)',
      text: 'rgb(0,0,0)'
    };
  }
}