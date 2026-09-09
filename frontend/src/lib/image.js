// Redimensiona uma imagem escolhida pelo usuário para um data URL pequeno.
export async function fileToCompressedDataURL(file, { maxSize = 1280, quality = 0.72, maxBytes = 260_000 } = {}) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Arquivo não é uma imagem.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let q = quality;
  let url = canvas.toDataURL('image/jpeg', q);
  while (url.length > maxBytes && q > 0.35) {
    q -= 0.12;
    url = canvas.toDataURL('image/jpeg', q);
  }
  if (url.length > maxBytes) throw new Error('Imagem muito grande mesmo após compressão.');
  return url;
}
