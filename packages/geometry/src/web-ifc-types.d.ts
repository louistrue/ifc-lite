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
    GetLineType(modelID: number, expressID: number): string | number;
    GetLine(modelID: number, expressID: number): any;
    GetLineIDsWithType(modelID: number, type: string | number): { size(): number; get(index: number): number };
  }
}
