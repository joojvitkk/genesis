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

/**
 * Foto de perfil: recorta o CENTRO em quadrado, reduz para `size` px e comprime em JPEG até caber em `maxBytes`.
 * O servidor aceita até ~150 mil caracteres; 256 px a ~85% costuma dar 15–30 KB.
 */
export async function fileToAvatarDataURL(file, { size = 256, quality = 0.88, maxChars = 140_000 } = {}) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Arquivo não é uma imagem.');
  if (/svg/.test(file.type)) throw new Error('Use uma foto JPEG, PNG ou WebP.');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';                      // PNG transparente vira fundo branco no JPEG
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();

  let q = quality;
  let url = canvas.toDataURL('image/jpeg', q);
  while (url.length > maxChars && q > 0.4) { q -= 0.1; url = canvas.toDataURL('image/jpeg', q); }
  if (url.length > maxChars) throw new Error('Imagem muito grande mesmo após compressão.');
  return url;
}
