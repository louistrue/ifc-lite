/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * PDF processing utilities using pdf.js
 */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Set up pdf.js worker
// In a browser environment, this should point to the worker file
let workerInitialized = false;

export function initPdfWorker(workerSrc: string): void {
  if (!workerInitialized) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    workerInitialized = true;
  }
}

export interface PdfPage {
  pageIndex: number;
  imageData: ImageData;
  width: number;
  height: number;
}

export interface PdfThumbnail {
  pageIndex: number;
  blob: Blob;
  width: number;
  height: number;
}

/**
 * PDF processor for loading and rendering PDF floor plans
 */
export class PdfProcessor {
  private document: PDFDocumentProxy | null = null;

  /**
   * Load a PDF from a Uint8Array buffer
   * @returns Number of pages in the PDF
   */
  async loadPdf(pdfBytes: Uint8Array): Promise<number> {
    const loadingTask = pdfjs.getDocument({ data: pdfBytes });
    this.document = await loadingTask.promise;
    return this.document.numPages;
  }

  /**
   * Render a page to an ImageData object
   * @param pageIndex 0-based page index
   * @param dpi Dots per inch for rendering (default 150)
   */
  async renderPage(pageIndex: number, dpi: number = 150): Promise<PdfPage> {
    if (!this.document) {
      throw new Error('No PDF loaded. Call loadPdf() first.');
    }

    const page = await this.document.getPage(pageIndex + 1); // pdf.js uses 1-based indexing
    const viewport = page.getViewport({ scale: dpi / 72 });

    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);

    // Create offscreen canvas for rendering
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');

    if (!(canvas instanceof OffscreenCanvas)) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    const imageData = ctx.getImageData(0, 0, width, height);

    return {
      pageIndex,
      imageData,
      width,
      height,
    };
  }

  /**
   * Get RGBA data from a rendered page
   */
  async getPageRgbaData(
    pageIndex: number,
    dpi: number = 150
  ): Promise<{ data: Uint8Array; width: number; height: number }> {
    const page = await this.renderPage(pageIndex, dpi);
    return {
      data: new Uint8Array(page.imageData.data),
      width: page.width,
      height: page.height,
    };
  }

  /**
   * Generate a thumbnail for a page
   * @param pageIndex 0-based page index
   * @param maxSize Maximum dimension in pixels
   */
  async generateThumbnail(pageIndex: number, maxSize: number = 300): Promise<PdfThumbnail> {
    if (!this.document) {
      throw new Error('No PDF loaded. Call loadPdf() first.');
    }

    const page = await this.document.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.0 });

    const scale = maxSize / Math.max(viewport.width, viewport.height);
    const scaledViewport = page.getViewport({ scale });

    const width = Math.floor(scaledViewport.width);
    const height = Math.floor(scaledViewport.height);

    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');

    if (!(canvas instanceof OffscreenCanvas)) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    await page.render({
      canvasContext: ctx,
      viewport: scaledViewport,
    }).promise;

    let blob: Blob;
    if (canvas instanceof OffscreenCanvas) {
      blob = await canvas.convertToBlob({ type: 'image/png' });
    } else {
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });
    }

    return {
      pageIndex,
      blob,
      width,
      height,
    };
  }

  /**
   * Generate thumbnails for all pages
   */
  async generateAllThumbnails(maxSize: number = 300): Promise<PdfThumbnail[]> {
    if (!this.document) {
      throw new Error('No PDF loaded. Call loadPdf() first.');
    }

    const thumbnails: PdfThumbnail[] = [];
    for (let i = 0; i < this.document.numPages; i++) {
      const thumbnail = await this.generateThumbnail(i, maxSize);
      thumbnails.push(thumbnail);
    }
    return thumbnails;
  }

  /**
   * Get the number of pages in the loaded PDF
   */
  getPageCount(): number {
    return this.document?.numPages ?? 0;
  }

  /**
   * Close the PDF document and release resources
   */
  close(): void {
    if (this.document) {
      this.document.destroy();
      this.document = null;
    }
  }
}
