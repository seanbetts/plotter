export function preloadImageUrls(urls: string[]) {
  if (typeof Image === 'undefined') return;

  for (const url of Array.from(new Set(urls.filter(Boolean)))) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  }
}
