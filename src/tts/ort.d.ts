declare module 'onnxruntime-web/wasm' {
  export interface OrtSession {
    run: (feeds: Record<string, unknown>, ...rest: unknown[]) => Promise<unknown>;
  }
  export const InferenceSession: {
    create: (...args: unknown[]) => Promise<OrtSession>;
  };
  export class Tensor {
    constructor(type: string, data: number[], dims?: number[]);
  }
  const ortDefault: {
    InferenceSession: typeof InferenceSession;
    Tensor: typeof Tensor;
  };
  export default ortDefault;
}
