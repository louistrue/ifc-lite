/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * STEP tokenizer - fast byte-level scanning for entity markers
 * Leverages Spike 1 approach: ~1,259 MB/s throughput
 */

export class StepTokenizer {
  private buffer: Uint8Array;
  private position: number = 0;
  private lineNumber: number = 1;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
  }

  /**
   * Scan for all entity declarations (#EXPRESS_ID = TYPE(...))
   * Returns entity references without parsing full content
   */
  *scanEntities(): Generator<{ expressId: number; type: string; offset: number; length: number; line: number }> {
    this.position = 0;
    this.lineNumber = 1;

    while (this.position < this.buffer.length) {
      // Look for '#' character (entity ID marker)
      if (this.buffer[this.position] === 0x23) { // '#'
        const startOffset = this.position;
        const startLine = this.lineNumber;

        // Read express ID
        const expressId = this.readExpressId();
        if (expressId === null) {
          this.position++;
          continue;
        }

        // Skip whitespace
        this.skipWhitespace();

        // Check for '=' (assignment)
        if (this.position >= this.buffer.length || this.buffer[this.position] !== 0x3D) {
          this.position++;
          continue;
        }
        this.position++; // Skip '='

        // Skip whitespace
        this.skipWhitespace();

        // Read type name
        const type = this.readTypeName();
        if (!type) {
          this.position++;
          continue;
        }

        // Skip whitespace
        this.skipWhitespace();

        // Check for '(' (start of parameters)
        if (this.position >= this.buffer.length || this.buffer[this.position] !== 0x28) {
          this.position++;
          continue;
        }

        // Find matching closing parenthesis to get full entity length
        const entityLength = this.findEntityLength(startOffset);
        if (entityLength > 0) {
          yield {
            expressId,
            type,
            offset: startOffset,
            length: entityLength,
            line: startLine,
          };
        }
      } else if (this.buffer[this.position] === 0x0A) {
        // Newline
        this.lineNumber++;
        this.position++;
      } else {
        this.position++;
      }
    }
  }

  private readExpressId(): number | null {
    let id = 0;
    let digits = 0;
    let pos = this.position + 1; // Skip '#'

    while (pos < this.buffer.length) {
      const char = this.buffer[pos];
      if (char >= 0x30 && char <= 0x39) { // '0'-'9'
        id = id * 10 + (char - 0x30);
        digits++;
        pos++;
      } else {
        break;
      }
    }

    if (digits === 0) return null;
    this.position = pos;
    return id;
  }

  private readTypeName(): string | null {
    let start = this.position;
    let end = start;

    // Type names start with uppercase letter
    if (this.position >= this.buffer.length || this.buffer[this.position] < 0x41 || this.buffer[this.position] > 0x5A) {
      return null;
    }

    while (end < this.buffer.length) {
      const char = this.buffer[end];
      // Allow letters, numbers, and underscore
      if (
        (char >= 0x41 && char <= 0x5A) || // A-Z
        (char >= 0x61 && char <= 0x7A) || // a-z
        (char >= 0x30 && char <= 0x39) || // 0-9
        char === 0x5F // _
      ) {
        end++;
      } else {
        break;
      }
    }

    if (end === start) return null;

    const typeName = new TextDecoder().decode(this.buffer.subarray(start, end));
    this.position = end;
    return typeName;
  }

  private skipWhitespace(): void {
    while (this.position < this.buffer.length) {
      const char = this.buffer[this.position];
      if (char === 0x20 || char === 0x09 || char === 0x0D || char === 0x0A) { // space, tab, CR, LF
        if (char === 0x0A) this.lineNumber++;
        this.position++;
      } else {
        break;
      }
    }
  }

  private findEntityLength(startOffset: number): number {
    let pos = this.position;
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    while (pos < this.buffer.length) {
      const char = this.buffer[pos];

      if (escapeNext) {
        escapeNext = false;
        pos++;
        continue;
      }

      if (char === 0x27) { // Single quote (string delimiter)
        inString = !inString;
        pos++;
        continue;
      }

      if (inString) {
        if (char === 0x5C) { // Backslash (escape)
          escapeNext = true;
        }
        pos++;
        continue;
      }

      if (char === 0x28) { // '('
        depth++;
        pos++;
      } else if (char === 0x29) { // ')'
        depth--;
        pos++;
        if (depth === 0) {
          // Found matching closing parenthesis
          return pos - startOffset;
        }
      } else {
        pos++;
      }
    }

    return 0; // No matching closing parenthesis found
  }
}
