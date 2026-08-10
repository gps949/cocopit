/** One complete line produced by LineSplitter. byteLen includes the trailing \n. */
export interface RawLine {
  text: string;
  byteOffset: number;
  byteLen: number;
}

const NL = 0x0a;

/**
 * Byte-accurate line splitter. Feed arbitrary chunks; complete lines come out
 * with absolute byte offsets. A trailing line without \n stays buffered and is
 * never emitted, so consumedBytes is always a safe resume cursor
 * (= parsed_bytes). Splitting happens at the byte level, so multi-byte UTF-8
 * characters crossing chunk boundaries decode correctly.
 */
export class LineSplitter {
  #buffer: Uint8Array = new Uint8Array(0);
  #offset: number;
  #decoder = new TextDecoder();

  constructor(startOffset = 0) {
    this.#offset = startOffset;
  }

  /** Absolute byte offset just past the last emitted line. */
  get consumedBytes(): number {
    return this.#offset;
  }

  push(chunk: Uint8Array): RawLine[] {
    let data: Uint8Array;
    if (this.#buffer.length === 0) {
      data = chunk;
    } else if (chunk.length === 0) {
      data = this.#buffer;
    } else {
      data = new Uint8Array(this.#buffer.length + chunk.length);
      data.set(this.#buffer, 0);
      data.set(chunk, this.#buffer.length);
    }

    const lines: RawLine[] = [];
    let lineStart = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === NL) {
        lines.push({
          text: this.#decoder.decode(data.subarray(lineStart, i)),
          byteOffset: this.#offset + lineStart,
          byteLen: i - lineStart + 1,
        });
        lineStart = i + 1;
      }
    }

    this.#buffer = data.slice(lineStart);
    this.#offset += lineStart;
    return lines;
  }
}
