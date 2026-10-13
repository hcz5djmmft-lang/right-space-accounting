const MAX_SIDE = 2000, SHRINK_ABOVE = 1.5 * 1024 * 1024;
/** Phone photos are 3–8 MB; a document is readable at 2000px. Big images are resized in the browser so uploads stay small and quick. PDFs and small files go up as they are. */
export async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.size <= SHRINK_ABOVE || typeof createImageBitmap !== 'function') return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; } // HEIC or an odd file: the server still checks the size and the type
}
