/**
 * web-ifc type declarations
 */

declare module 'web-ifc' {
  export class IfcAPI {
    SetWasmPath(path: string, absolute?: boolean): void;
    Init(customLocateFileHandler?: any, forceSingleThread?: boolean): Promise<void>;
    OpenModel(buffer: Uint8Array): number;
    CloseModel(modelID: number): void;
    LoadAllGeometry(modelID: number): any;
    GetGeometry(modelID: number, geometryExpressID: number): any;
  }
}
