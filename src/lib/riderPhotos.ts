export const riderPhotoInputMaxBytes = 10 * 1024 * 1024;
export const riderPhotoMaxDataUrlLength = 60_000;
export const riderPhotoOutputSize = 192;

const supportedStoredPhotoPattern = /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/]+={0,2})$/i;

export function normalizeRiderPhotoDataUrl(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const candidate = value.trim();
  if (!candidate || candidate.length > riderPhotoMaxDataUrlLength) {
    return '';
  }

  const match = supportedStoredPhotoPattern.exec(candidate);
  if (!match || match[2].length < 4) {
    return '';
  }

  return `data:image/${match[1].toLowerCase()};base64,${match[2]}`;
}

export function riderInitials(name: string) {
  const words = name
    .replace(/[()"'“”‘’]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return 'R';
  }

  const first = words[0][0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : '';
  return `${first}${last}`.toLocaleUpperCase().slice(0, 2) || 'R';
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('TrackLab could not read that photo.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be opened. Try a JPG, PNG, or WebP photo.'));
    image.src = source;
  });
}

function renderSquarePhoto(image: HTMLImageElement, size: number, quality: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Photo processing is unavailable in this browser.');
  }

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    size,
    size,
  );
  return canvas.toDataURL('image/jpeg', quality);
}

export async function prepareRiderPhoto(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file.');
  }
  if (file.size > riderPhotoInputMaxBytes) {
    throw new Error('Choose a photo smaller than 10 MB.');
  }

  const image = await loadImage(await fileAsDataUrl(file));
  if (image.naturalWidth < 1 || image.naturalHeight < 1) {
    throw new Error('That image has no usable picture data.');
  }

  const attempts = [
    { size: riderPhotoOutputSize, quality: 0.84 },
    { size: riderPhotoOutputSize, quality: 0.72 },
    { size: 160, quality: 0.66 },
    { size: 128, quality: 0.6 },
  ];
  for (const attempt of attempts) {
    const photoUrl = normalizeRiderPhotoDataUrl(
      renderSquarePhoto(image, attempt.size, attempt.quality),
    );
    if (photoUrl) {
      return photoUrl;
    }
  }

  throw new Error('TrackLab could not make that photo small enough. Try a simpler or smaller image.');
}
