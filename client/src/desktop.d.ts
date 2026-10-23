/** Narrow renderer API exposed by desktop/preload.cjs; absent in browser mode. */
export interface PandaDesktop {
  showOverlay(): void;
  resizePanda(delta: number): void;
  layoutOverlay(width: number, height: number): void;
  setHitRegions(
    regions: { x: number; y: number; width: number; height: number }[],
  ): void;
  onResizePanda(callback: (delta: number) => void): () => void;
  moveDisplay(): void;
  toggleOverlay(): void;
}

declare global {
  interface Window {
    pandaDesktop?: PandaDesktop;
  }
}
