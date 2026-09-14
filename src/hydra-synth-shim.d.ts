declare module "hydra-synth" {
  export default class Hydra {
    constructor(opts?: {
      canvas?: HTMLCanvasElement;
      detectAudio?: boolean;
      makeGlobal?: boolean;
    });
    setResolution?: (width: number, height: number) => void;
    sandbox?: { destroy?: () => void };
  }
}
