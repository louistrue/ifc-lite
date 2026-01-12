/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Entity extractor - parses full entity content from STEP format
 */

import type { IfcEntity, EntityRef } from './types.js';

export class EntityExtractor {
  private buffer: Uint8Array;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
  }

  /**
   * Extract full entity data from a reference
   */
  extractEntity(ref: EntityRef): IfcEntity | null {
    try {
      const entityText = new TextDecoder().decode(
        this.buffer.subarray(ref.byteOffset, ref.byteOffset + ref.byteLength)
      );

      // Parse: #ID = TYPE(attr1, attr2, ...)
      const match = entityText.match(/^#(\d+)\s*=\s*(\w+)\((.*)\)/);
      if (!match) return null;

      const expressId = parseInt(match[1], 10);
      const type = match[2];
      const paramsText = match[3];

      // Parse attributes (simplified - handles basic types)
      const attributes = this.parseAttributes(paramsText);

      return {
        expressId,
        type,
        attributes,
      };
    } catch (error) {
      console.warn(`Failed to extract entity #${ref.expressId}:`, error);
      return null;
    }
  }

  private parseAttributes(paramsText: string): any[] {
    if (!paramsText.trim()) return [];

    const attributes: any[] = [];
    let depth = 0;
    let current = '';
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < paramsText.length; i++) {
      const char = paramsText[i];

      if (escapeNext) {
        current += char;
        escapeNext = false;
        continue;
      }

      if (char === "'") {
        inString = !inString;
        current += char;
      } else if (inString) {
        if (char === '\\') {
          escapeNext = true;
        }
        current += char;
      } else if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        // End of attribute
        attributes.push(this.parseAttributeValue(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }

    // Add last attribute
    if (current.trim()) {
      attributes.push(this.parseAttributeValue(current.trim()));
    }

    return attributes;
  }

  private parseAttributeValue(value: string): any {
    value = value.trim();

    if (!value || value === '$') {
      return null;
    }

    // List/Array: (#123) or (#123, #456) or ()
    if (value.startsWith('(') && value.endsWith(')')) {
      const listContent = value.slice(1, -1).trim();
      if (!listContent) {
        return []; // Empty list
      }
      
      // Parse list items (comma-separated)
      const items: any[] = [];
      let depth = 0;
      let current = '';
      
      for (let i = 0; i < listContent.length; i++) {
        const char = listContent[i];
        
        if (char === '(') {
          depth++;
          current += char;
        } else if (char === ')') {
          depth--;
          current += char;
        } else if (char === ',' && depth === 0) {
          // End of item
          const itemValue = current.trim();
          if (itemValue) {
            items.push(this.parseAttributeValue(itemValue));
          }
          current = '';
        } else {
          current += char;
        }
      }
      
      // Add last item
      if (current.trim()) {
        items.push(this.parseAttributeValue(current.trim()));
      }
      
      return items;
    }

    // Reference: #123
    if (value.startsWith('#')) {
      const id = parseInt(value.substring(1), 10);
      return isNaN(id) ? null : id;
    }

    // String: 'text'
    if (value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }

    // Number
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return num;
    }

    // Enumeration or other identifier
    return value;
  }
}
