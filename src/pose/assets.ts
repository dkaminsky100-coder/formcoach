/** True if a static asset is served (Vite answers missing files with index.html, so reject HTML). */
export async function assetPresent(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

export async function missingAssets(): Promise<string[]> {
  const required = [
    '/wasm/vision_wasm_internal.wasm',
    '/models/pose_landmarker_lite.task',
    '/models/pose_landmarker_full.task',
  ];
  const present = await Promise.all(required.map(assetPresent));
  return required.filter((_, i) => !present[i]);
}
