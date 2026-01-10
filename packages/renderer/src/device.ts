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
  // #region agent log
  private deviceId = Math.random().toString(36).slice(2, 8);
  // #endregion

  /**
   * Initialize WebGPU device and canvas context
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'device.ts:init-start',message:'Device init starting',data:{deviceId:this.deviceId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
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

    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'device.ts:init-complete',message:'Device init complete',data:{deviceId:this.deviceId,hasDevice:!!this.device,hasContext:!!this.context},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1-H2'})}).catch(()=>{});
    // #endregion
    this.configureContext();
  }

  /**
   * Configure/reconfigure the canvas context
   * Must be called after canvas resize
   */
  configureContext(): void {
    if (!this.context || !this.device || !this.canvas) return;
    
    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'device.ts:configureContext',message:'Configuring context',data:{deviceId:this.deviceId,width:this.canvas.width,height:this.canvas.height},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    
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
