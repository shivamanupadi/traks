interface UAResult {
  browser: string;
  os: string;
  deviceType: string;
}

export function parseUA(ua: string): UAResult {
  const browser = parseBrowser(ua);
  const os = parseOS(ua);
  const deviceType = parseDeviceType(ua);
  return { browser, os, deviceType };
}

function parseBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return 'Opera';
  if (/brave/i.test(ua)) return 'Brave';
  if (/vivaldi/i.test(ua)) return 'Vivaldi';
  if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/msie|trident/i.test(ua)) return 'IE';
  if (/samsung/i.test(ua)) return 'Samsung Internet';
  return 'Other';
}

function parseOS(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/mac os|macintosh/i.test(ua)) return 'macOS';
  if (/android/i.test(ua)) return 'Android';
  if (/linux/i.test(ua)) return 'Linux';
  if (/cros/i.test(ua)) return 'Chrome OS';
  return 'Other';
}

function parseDeviceType(ua: string): string {
  if (/mobile|iphone|android.*mobile/i.test(ua)) return 'mobile';
  if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) return 'tablet';
  return 'desktop';
}
