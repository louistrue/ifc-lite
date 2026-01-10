/**
 * WebGPU device initialization
 */

export class WebGPUDevice {
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  private canvas: HTMLCanvasElement | null = null;
  private lastWidth: number = 0;
  private lastHeight: number = 0;

  /**
   * Initialize WebGPU device and canvas context
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU not available');
    }

    this.adapter = await navigator.gpu.requestAdapter();
    if (!this.adapter) {
      throw new Error('Failed to get GPU adapter');
    }

    this.device = await this.adapter.requestDevice();
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.canvas = canvas;

    this.context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!this.context) {
      throw new Error('Failed to get WebGPU context');
    }

    this.configureContext();
  }

  /**
   * Configure/reconfigure the canvas context
   * Must be called after canvas resize
   */
  configureContext(): void {
    if (!this.context || !this.device || !this.canvas) return;

    this.lastWidth = this.canvas.width;
    this.lastHeight = this.canvas.height;

    this.context.configure({
      device: this.device,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /**
   * Check if context needs reconfiguration (canvas resized)
   */
  needsReconfigure(): boolean {
    if (!this.canvas) return false;
    return this.canvas.width !== this.lastWidth || this.canvas.height !== this.lastHeight;
  }

  getDevice(): GPUDevice {
    if (!this.device) {
      throw new Error('Device not initialized');
    }
    return this.device;
  }

  getContext(): GPUCanvasContext {
    if (!this.context) {
      throw new Error('Context not initialized');
    }
    return this.context;
  }

  getFormat(): GPUTextureFormat {
    return this.format;
  }

  isInitialized(): boolean {
    return this.device !== null && this.context !== null;
  }
}
