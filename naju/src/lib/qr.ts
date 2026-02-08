import { QrCode } from "./qrcodegen";

function svgToDataUrl(svg: string) {
  // Some mobile scanners/browsers are picky with URL-encoded SVGs.
  // Base64 tends to be the most compatible across iOS/Android/desktop.
  const utf8 = new TextEncoder().encode(svg);
  let bin = "";
  utf8.forEach((b) => (bin += String.fromCharCode(b)));
  const b64 = btoa(bin);
  return `data:image/svg+xml;base64,${b64}`;
}

/**
 * Generates a QR code as an SVG data URL.
 * Offline and dependency-free.
 */
export function makeQrSvgDataUrl(text: string) {
  // Medium ECC is a good default for phone scanning.
  const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
  // The library outputs an SVG with a 1-module border.
  // Use a slightly larger quiet zone for better scan reliability.
  const svg = qr.toSvgString(3, "#ffffff", "#000000");
  // Scale via CSS width/height; keep viewBox.
  // We keep original SVG and size it in the caller.
  return svgToDataUrl(svg);
}
