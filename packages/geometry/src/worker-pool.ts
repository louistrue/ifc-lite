/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Worker Pool - Generic worker pool with task queue
 * Supports multiple task types and zero-copy transferable objects
 */

export type TaskType = 'mesh-collection' | 'generate-lod' | 'build-bvh';

export interface Task<T = any> {
  id: string;
  type: TaskType;
  data: any;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export interface WorkerMessage {
  id: string;
  type: 'task-result' | 'task-error' | 'ready';
  result?: any;
  error?: string;
}

/**
 * Worker Pool for geometry processing tasks
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private taskQueue: Task[] = [];
  private activeTasks: Map<string, Task> = new Map();
  private availableWorkers: Set<Worker> = new Set();
  private workerCount: number;
  private workerUrl: URL | string;
  private initialized: boolean = false;

  constructor(workerUrl: URL | string, workerCount?: number) {
    this.workerUrl = workerUrl;
    this.workerCount = workerCount ?? Math.max(1, navigator.hardwareConcurrency ?? 4);
  }

  /**
   * Initialize worker pool
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const initStart = performance.now();
    
    // Check if workers are available
    if (typeof Worker === 'undefined') {
      console.warn('[WorkerPool] Web Workers not available');
      return;
    }

    try {
      // Spawn workers
      for (let i = 0; i < this.workerCount; i++) {
        const workerStart = performance.now();
        const worker = new Worker(this.workerUrl, { type: 'module' });
        
        // Wait for worker to be ready before setting up main handler
        await new Promise<void>((resolve) => {
          const readyHandler = (e: MessageEvent<WorkerMessage>) => {
            if (e.data.type === 'ready') {
              worker.removeEventListener('message', readyHandler);
              // Now set up the main message handler
              worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
                this.handleMessage(worker, e);
              };
              const workerInitTime = performance.now() - workerStart;
              console.log(`[WorkerPool] Worker ${i} ready in ${workerInitTime.toFixed(2)}ms`);
              resolve();
            }
          };
          worker.addEventListener('message', readyHandler);
        });

        worker.onerror = (error) => {
          console.error(`[WorkerPool] Worker ${i} error:`, error);
          this.availableWorkers.delete(worker);
        };

        this.workers.push(worker);
        this.availableWorkers.add(worker);
      }

      this.initialized = true;
      const totalInitTime = performance.now() - initStart;
      console.log(`[WorkerPool] Initialized ${this.workers.length} workers in ${totalInitTime.toFixed(2)}ms`);
    } catch (error) {
      console.error('[WorkerPool] Failed to initialize:', error);
      // Workers unavailable, but don't throw - fallback to main thread
    }
  }

  /**
   * Check if workers are available
   */
  isAvailable(): boolean {
    return this.initialized && this.workers.length > 0 && this.availableWorkers.size > 0;
  }

  /**
   * Submit a task to the worker pool
   */
  async submit<T>(type: TaskType, data: any): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error('Worker pool not available. Use fallback to main thread.');
    }

    return new Promise<T>((resolve, reject) => {
      const task: Task<T> = {
        id: crypto.randomUUID(),
        type,
        data,
        resolve,
        reject,
      };

      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  /**
   * Process queued tasks
   */
  private processQueue(): void {
    if (this.taskQueue.length === 0 || this.availableWorkers.size === 0) {
      return;
    }

    // Get next available worker (round-robin)
    const worker = Array.from(this.availableWorkers)[0];
    const task = this.taskQueue.shift();

    if (!task || !worker) return;

    // Move task to active tasks
    this.activeTasks.set(task.id, task);

    // Mark worker as busy
    this.availableWorkers.delete(worker);

    // Send task to worker
    worker.postMessage({
      id: task.id,
      type: task.type,
      data: task.data,
    });
  }

  /**
   * Handle message from worker
   */
  private handleMessage(worker: Worker, e: MessageEvent<WorkerMessage>): void {
    const { id, type, result, error } = e.data;

    if (type === 'ready') {
      // Worker is ready, already handled in init()
      return;
    }

    // Find task in active tasks
    const task = this.activeTasks.get(id);
    if (!task) {
      // Task not found
      console.warn(`[WorkerPool] Task ${id} not found`);
      this.availableWorkers.add(worker);
      this.processQueue();
      return;
    }

    // Remove from active tasks
    this.activeTasks.delete(id);

    if (type === 'task-result') {
      task.resolve(result);
    } else if (type === 'task-error') {
      task.reject(new Error(error || 'Unknown worker error'));
    }

    // Return worker to available pool
    this.availableWorkers.add(worker);
    this.processQueue();
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.availableWorkers.clear();
    this.taskQueue = [];
    this.activeTasks.clear();
    this.initialized = false;
  }
}
