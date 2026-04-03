declare module "@excalidraw/excalidraw" {
  import type { ComponentType } from "react";

  export interface ExcalidrawProps {
    initialData?: {
      elements?: readonly Record<string, unknown>[];
      appState?: Record<string, unknown>;
    };
    onChange?: (
      elements: readonly Record<string, unknown>[],
      appState: Record<string, unknown>
    ) => void;
    [key: string]: unknown;
  }

  export const Excalidraw: ComponentType<ExcalidrawProps>;

  export function exportToSvg(opts: {
    elements: readonly Record<string, unknown>[];
    appState?: Record<string, unknown>;
    files?: unknown;
  }): Promise<SVGSVGElement>;
}
