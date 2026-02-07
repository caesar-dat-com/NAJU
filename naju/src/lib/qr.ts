import { QrCode } from "./qrcodegen";

function svgToDataUrl(svg: string) {
  // Encode for safe use in <img src="...">
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Generates a QR code as an SVG data URL.
 * Offline and dependency-free.
 */
export function makeQrSvgDataUrl(text: string) {
  // Medium ECC is a good default for phone scanning.
  const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
  // The library outputs an SVG with a 1-module border.
  const svg = qr.toSvgString(1, "#ffffff", "#000000");
  // Scale via CSS width/height; keep viewBox.
  // We keep original SVG and size it in the caller.
  return svgToDataUrl(svg);
}
