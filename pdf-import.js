/* ============================================================
   OhMyGoch Trip OS · pdf-import.js
   Extracción de texto de PDFs · 100% client-side
   ============================================================ */

let pdfjsPromise = null;
const PDFJS_VERSION = '3.11.174';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return resolve(window.pdfjsLib);
    }
    const script = document.createElement('script');
    script.src = PDFJS_CDN;
    script.async = true;
    script.onload = () => {
      if (!window.pdfjsLib) return reject(new Error('pdf.js no se cargó correctamente'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('No se pudo descargar pdf.js. ¿Tenés conexión?'));
    document.head.appendChild(script);
  });

  return pdfjsPromise;
}

/**
 * Extrae el texto de un PDF (File o ArrayBuffer).
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
export async function extractTextFromPdf(file) {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = file instanceof Blob
    ? await file.arrayBuffer()
    : file;

  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const parts = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Reconstruir líneas: agrupar items por su Y aproximada
    const lines = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x: item.transform[4], str: item.str });
    }

    const sortedY = [...lines.keys()].sort((a, b) => b - a);
    for (const y of sortedY) {
      const row = lines.get(y).sort((a, b) => a.x - b.x).map(x => x.str).join(' ');
      parts.push(row);
    }
    parts.push('');
  }

  return parts.join('\n').trim();
}

/**
 * Valida que un archivo sea PDF legible.
 */
export function isPdfFile(file) {
  if (!file) return false;
  const byType = file.type === 'application/pdf';
  const byExt = /\.pdf$/i.test(file.name || '');
  const bySize = file.size < 15 * 1024 * 1024; // 15MB máximo
  return (byType || byExt) && bySize;
}

/**
 * Formatea bytes a string legible.
 */
export function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}