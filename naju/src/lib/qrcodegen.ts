/*
 * QR Code generator library (TypeScript)
 *
 * Copyright (c) Project Nayuki
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Licensed under the MIT License.
 */

/* eslint-disable */

// This file is intentionally self-contained to avoid adding new dependencies.

export class QrCode {
  public static readonly MIN_VERSION = 1;
  public static readonly MAX_VERSION = 40;

  public readonly version: number;
  public readonly size: number;
  public readonly errorCorrectionLevel: QrCode.Ecc;
  public readonly mask: number;

  private readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  // ---- Public factory functions ----

  public static encodeText(text: string, ecl: QrCode.Ecc): QrCode {
    const segs = QrSegment.makeSegments(text);
    return QrCode.encodeSegments(segs, ecl);
  }

  public static encodeBinary(data: ReadonlyArray<number>, ecl: QrCode.Ecc): QrCode {
    return QrCode.encodeSegments([QrSegment.makeBytes(data)], ecl);
  }

  public static encodeSegments(
    segs: ReadonlyArray<QrSegment>,
    ecl: QrCode.Ecc,
    minVersion: number = QrCode.MIN_VERSION,
    maxVersion: number = QrCode.MAX_VERSION,
    mask: number = -1,
    boostEcl: boolean = true,
  ): QrCode {
    if (!(QrCode.MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= QrCode.MAX_VERSION) || mask < -1 || mask > 7)
      throw new RangeError("Invalid value");

    // Find the minimal version that fits the data
    let version: number;
    let dataUsedBits = 0;
    for (version = minVersion; ; version++) {
      const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
      const used = QrSegment.getTotalBits(segs, version);
      if (used <= dataCapacityBits) {
        dataUsedBits = used;
        break;
      }
      if (version >= maxVersion) throw new RangeError("Data too long");
    }

    // Increase ECL while data still fits
    if (boostEcl) {
      for (const newEcl of [QrCode.Ecc.MEDIUM, QrCode.Ecc.QUARTILE, QrCode.Ecc.HIGH]) {
        if (dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8) ecl = newEcl;
      }
    }

    // Concatenate all segments to a bit buffer
    const bb: number[] = [];
    for (const seg of segs) {
      QrCode.appendBits(seg.mode.modeBits, 4, bb);
      QrCode.appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
      for (const b of seg.data) bb.push(b);
    }

    // Add terminator and pad to byte boundary
    const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
    QrCode.appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
    QrCode.appendBits(0, (8 - (bb.length % 8)) % 8, bb);

    // Pad with alternating bytes
    for (let padByte = 0xEC; bb.length < dataCapacityBits; padByte ^= 0xEC ^ 0x11) {
      QrCode.appendBits(padByte, 8, bb);
    }

    // Pack bits into bytes
    const dataCodewords: number[] = [];
    for (let i = 0; i < bb.length; i += 8) {
      let x = 0;
      for (let j = 0; j < 8; j++) x = (x << 1) | bb[i + j];
      dataCodewords.push(x);
    }

    // Construct the QR Code symbol
    return new QrCode(version, ecl, dataCodewords, mask);
  }

  // ---- Constructor ----

  private constructor(ver: number, ecl: QrCode.Ecc, dataCodewords: ReadonlyArray<number>, mask: number) {
    this.version = ver;
    this.size = ver * 4 + 17;
    this.errorCorrectionLevel = ecl;
    this.modules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => Array(this.size).fill(false));

    // Draw function patterns
    this.drawFunctionPatterns();

    // Draw codewords
    const allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    // Choose mask
    if (mask === -1) {
      let minPenalty = Infinity;
      let bestMask = 0;
      for (let m = 0; m < 8; m++) {
        this.applyMask(m);
        this.drawFormatBits(m);
        const penalty = this.getPenaltyScore();
        if (penalty < minPenalty) {
          minPenalty = penalty;
          bestMask = m;
        }
        this.applyMask(m); // Undo
      }
      mask = bestMask;
    }
    this.mask = mask;

    this.applyMask(mask);
    this.drawFormatBits(mask);
    this.drawVersion();
  }

  // ---- Public instance methods ----

  public getModule(x: number, y: number): boolean {
    if (0 <= x && x < this.size && 0 <= y && y < this.size) return this.modules[y][x];
    return false;
  }

  public toSvgString(border: number = 4, lightColor: string = "#FFFFFF", darkColor: string = "#000000"): string {
    if (border < 0) throw new RangeError("Border must be non-negative");
    const parts: string[] = [];
    const size = this.size + border * 2;
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`);
    parts.push(`<rect width="100%" height="100%" fill="${lightColor}"/>`);
    parts.push(`<path d="`);
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.modules[y][x]) {
          const xx = x + border;
          const yy = y + border;
          parts.push(`M${xx},${yy}h1v1h-1z`);
        }
      }
    }
    parts.push(`" fill="${darkColor}"/>`);
    parts.push(`</svg>`);
    return parts.join("");
  }

  // ---- Private helper methods ----

  private static appendBits(val: number, len: number, bb: number[]) {
    for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  }

  private drawFunctionPatterns() {
    // Finder patterns
    for (const [x, y] of [
      [0, 0],
      [this.size - 7, 0],
      [0, this.size - 7],
    ]) {
      this.drawFinderPattern(x, y);
    }

    // Separators
    this.drawRect(0, 7, 8, 1, false);
    this.drawRect(7, 0, 1, 7, false);
    this.drawRect(this.size - 8, 7, 8, 1, false);
    this.drawRect(this.size - 8, 0, 1, 7, false);
    this.drawRect(0, this.size - 8, 8, 1, false);
    this.drawRect(7, this.size - 7, 1, 7, false);

    // Timing patterns
    for (let i = 8; i < this.size - 8; i++) {
      const bit = i % 2 === 0;
      this.setFunctionModule(6, i, bit);
      this.setFunctionModule(i, 6, bit);
    }

    // Alignment patterns
    const positions = QrCode.getAlignmentPatternPositions(this.version);
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) continue;
        this.drawAlignmentPattern(positions[i], positions[j]);
      }
    }

    // Dark module
    this.setFunctionModule(8, this.size - 8, true);

    // Reserve format information areas
    for (let i = 0; i < 9; i++) {
      if (i !== 6) {
        this.setFunctionModule(8, i, false);
        this.setFunctionModule(i, 8, false);
      }
    }
    for (let i = 0; i < 8; i++) {
      this.setFunctionModule(this.size - 1 - i, 8, false);
      this.setFunctionModule(8, this.size - 1 - i, false);
    }
    this.setFunctionModule(8, this.size - 8, false);
    this.setFunctionModule(this.size - 8, 8, false);

    // Reserve version information areas
    if (this.version >= 7) {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
          this.setFunctionModule(this.size - 11 + j, i, false);
          this.setFunctionModule(i, this.size - 11 + j, false);
        }
      }
    }
  }

  private drawFinderPattern(x: number, y: number) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        const dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        const val = dist !== 2 && dist !== 4;
        if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size) this.setFunctionModule(xx, yy, val);
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private drawRect(x: number, y: number, w: number, h: number, val: boolean) {
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        this.setFunctionModule(x + j, y + i, val);
      }
    }
  }

  private setFunctionModule(x: number, y: number, val: boolean) {
    this.modules[y][x] = val;
    this.isFunction[y][x] = true;
  }

  private addEccAndInterleave(data: ReadonlyArray<number>): number[] {
    const ver = this.version;
    const ecl = this.errorCorrectionLevel;
    const numBlocks = QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    const blockEccLen = QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
    const rawCodewords = QrCode.getNumRawDataModules(ver) / 8;
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks: number[][] = [];
    const rs = new ReedSolomonGenerator(blockEccLen);
    let k = 0;
    for (let i = 0; i < numBlocks; i++) {
      const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const dat = data.slice(k, k + datLen);
      k += datLen;
      const ecc = rs.getRemainder(dat);
      const block = dat.concat(ecc);
      blocks.push(block);
    }

    const result: number[] = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        // Skip padding in short blocks
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
      }
    }
    return result;
  }

  private drawCodewords(data: ReadonlyArray<number>) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            const bit = ((data[Math.floor(i / 8)] >>> (7 - (i % 8))) & 1) !== 0;
            this.modules[y][x] = bit;
            i++;
          }
        }
      }
    }
  }

  private applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert = false;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: throw new RangeError("Mask");
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  private drawFormatBits(mask: number) {
    const data = (this.errorCorrectionLevel.formatBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, ((bits >>> i) & 1) !== 0);
    this.setFunctionModule(8, 7, ((bits >>> 6) & 1) !== 0);
    this.setFunctionModule(8, 8, ((bits >>> 7) & 1) !== 0);
    this.setFunctionModule(7, 8, ((bits >>> 8) & 1) !== 0);
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, ((bits >>> i) & 1) !== 0);
    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, ((bits >>> i) & 1) !== 0);
    this.setFunctionModule(8, this.size - 8, true);
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1F25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  }

  private getPenaltyScore(): number {
    let result = 0;
    const size = this.size;

    // Adjacent modules in row/column in same color
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runLen = 0;
      for (let x = 0; x < size; x++) {
        const color = this.modules[y][x];
        if (x === 0 || color !== runColor) {
          runColor = color;
          runLen = 1;
        } else {
          runLen++;
          if (runLen === 5) result += 3;
          else if (runLen > 5) result++;
        }
      }
    }
    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runLen = 0;
      for (let y = 0; y < size; y++) {
        const color = this.modules[y][x];
        if (y === 0 || color !== runColor) {
          runColor = color;
          runLen = 1;
        } else {
          runLen++;
          if (runLen === 5) result += 3;
          else if (runLen > 5) result++;
        }
      }
    }

    // 2x2 blocks
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = this.modules[y][x];
        if (c === this.modules[y][x + 1] && c === this.modules[y + 1][x] && c === this.modules[y + 1][x + 1]) result += 3;
      }
    }

    // Finder-like patterns
    const pattern = [true, false, true, true, true, false, true, false, false, false, false];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size - 10; x++) {
        let match = true;
        for (let i = 0; i < 11; i++) if (this.modules[y][x + i] !== pattern[i]) { match = false; break; }
        if (match) result += 40;
      }
    }
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size - 10; y++) {
        let match = true;
        for (let i = 0; i < 11; i++) if (this.modules[y + i][x] !== pattern[i]) { match = false; break; }
        if (match) result += 40;
      }
    }

    // Balance of dark modules
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (this.modules[y][x]) dark++;
    const total = size * size;
    const k = Math.abs(dark * 20 - total * 10) / total;
    result += Math.floor(k) * 10;
    return result;
  }

  // ---- Static tables ----

  private static getNumRawDataModules(ver: number): number {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  private static getNumDataCodewords(ver: number, ecl: QrCode.Ecc): number {
    return (QrCode.getNumRawDataModules(ver) / 8) - QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  }

  private static getAlignmentPatternPositions(ver: number): number[] {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = numAlign === 2 ? ver * 4 + 10 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result: number[] = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  private static readonly ECC_CODEWORDS_PER_BLOCK: number[][] = [
    // Version: (index 0 unused)
    [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];

  private static readonly NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
    [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];
}

export namespace QrCode {
  export class Ecc {
    public static readonly LOW = new Ecc(0, 1);
    public static readonly MEDIUM = new Ecc(1, 0);
    public static readonly QUARTILE = new Ecc(2, 3);
    public static readonly HIGH = new Ecc(3, 2);

    public readonly ordinal: number;
    public readonly formatBits: number;
    private constructor(ordinal: number, formatBits: number) {
      this.ordinal = ordinal;
      this.formatBits = formatBits;
    }
  }
}

export class QrSegment {
  public readonly mode: QrSegment.Mode;
  public readonly numChars: number;
  public readonly data: number[];

  public static makeBytes(data: ReadonlyArray<number>): QrSegment {
    const bb: number[] = [];
    for (const b of data) QrCode["appendBits"]?.(b, 8, bb);
    // The appendBits method is private; we rebuild bits manually:
    const bits: number[] = [];
    for (const b of data) for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
    return new QrSegment(QrSegment.Mode.BYTE, data.length, bits);
  }

  public static makeSegments(text: string): QrSegment[] {
    // We keep it simple and always use BYTE mode for maximum compatibility.
    const bytes = QrSegment.toUtf8Bytes(text);
    const bits: number[] = [];
    for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
    return [new QrSegment(QrSegment.Mode.BYTE, bytes.length, bits)];
  }

  public static getTotalBits(segs: ReadonlyArray<QrSegment>, version: number): number {
    let result = 0;
    for (const seg of segs) {
      const ccbits = seg.mode.numCharCountBits(version);
      if (seg.numChars >= (1 << ccbits)) return Infinity;
      result += 4 + ccbits + seg.data.length;
    }
    return result;
  }

  private static toUtf8Bytes(str: string): number[] {
    // Use TextEncoder if available; else fallback to a minimal encoder.
    try {
      const enc = new TextEncoder();
      return Array.from(enc.encode(str));
    } catch {
      // Fallback: encodeURIComponent-based (works for Unicode but less efficient)
      const s = unescape(encodeURIComponent(str));
      const out: number[] = [];
      for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
      return out;
    }
  }

  private constructor(mode: QrSegment.Mode, numChars: number, data: number[]) {
    this.mode = mode;
    this.numChars = numChars;
    this.data = data;
  }
}

export namespace QrSegment {
  export class Mode {
    public static readonly BYTE = new Mode(0x4, [8, 16, 16]);
    public readonly modeBits: number;
    private readonly numBitsCharCount: number[];
    private constructor(modeBits: number, numBitsCharCount: number[]) {
      this.modeBits = modeBits;
      this.numBitsCharCount = numBitsCharCount;
    }
    public numCharCountBits(ver: number): number {
      if (ver <= 9) return this.numBitsCharCount[0];
      else if (ver <= 26) return this.numBitsCharCount[1];
      else return this.numBitsCharCount[2];
    }
  }
}

class ReedSolomonGenerator {
  private readonly coefficients: number[];

  public constructor(degree: number) {
    if (degree < 1 || degree > 255) throw new RangeError("Degree out of range");
    this.coefficients = Array(degree).fill(0);
    this.coefficients[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < this.coefficients.length; j++) {
        this.coefficients[j] = ReedSolomonGenerator.multiply(this.coefficients[j], root);
        if (j + 1 < this.coefficients.length) this.coefficients[j] ^= this.coefficients[j + 1];
      }
      root = ReedSolomonGenerator.multiply(root, 0x02);
    }
  }

  public getRemainder(data: ReadonlyArray<number>): number[] {
    const result = Array(this.coefficients.length).fill(0);
    for (const b of data) {
      const factor = b ^ result[0];
      result.shift();
      result.push(0);
      for (let i = 0; i < result.length; i++) {
        result[i] ^= ReedSolomonGenerator.multiply(this.coefficients[i], factor);
      }
    }
    return result;
  }

  private static multiply(x: number, y: number): number {
    if (x >>> 8 !== 0 || y >>> 8 !== 0) throw new RangeError("Byte out of range");
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      if (((y >>> i) & 1) !== 0) z ^= x;
    }
    return z;
  }
}
