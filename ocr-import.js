/* ============================================================
   OhMyGoch Trip OS · ocr-import.js
   OCR de imágenes · Tesseract.js · 100% client-side
   Idiomas: español + inglés
   ============================================================ */

const TESSERACT_VERSION = '5.1.0';
const TESSERACT_CDN = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
const LANG = 'spa+eng';

let tesseractPromise = null;

function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;

  tesseractPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);

    const script = document.createElement('script');
    script.src = TESSERACT_CDN;
    script.async = true;
    script.onload = () => {
      if (window.Tesseract) return resolve(window.Tesseract);
      reject(new Error('Tesseract no se cargó correctamente'));
    };
    script.onerror = () => reject(new Error('No se pudo descargar el motor OCR. ¿Tenés conexión?'));
    document.head.appendChild(script);
  });

  return tesseractPromise;
}

/**
 * Valida que un archivo sea imagen legible.
 */
export function isImageFile(file) {
  if (!file) return false;
  const byType = /^image\//i.test(file.type || '');
  const byExt = /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(file.name || '');
  const bySize = file.size < 15 * 1024 * 1024;
  return (byType || byExt) && bySize;
}

/**
 * Extrae texto de una imagen con OCR.
 * @param {File|Blob|string} input
 * @param {(pct:number) => void} [onProgress]
 * @returns {Promise<string>}
 */
export async function extractTextFromImage(input, onProgress) {
  const Tesseract = await loadTesseract();

  const result = await Tesseract.recognize(input, LANG, {
    logger: (m) => {
      if (!onProgress) return;
      if (m.status === 'recognizing text') {
        onProgress(Math.round((m.progress || 0) * 100));
      } else if (m.status === 'loading language traineddata') {
        onProgress(2);
      }
    },
  });

  const text = (result?.data?.text || '').trim();
  return cleanupOcr(text);
}

/**
 * Limpia el texto crudo del OCR:
 *   - Elimina caracteres basura comunes
 *   - Normaliza espacios múltiples
 *   - Colapsa líneas vacías
 */
function cleanupOcr(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[|]{2,}/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(l => l.trim())
    .join('\n')
    .trim();
}