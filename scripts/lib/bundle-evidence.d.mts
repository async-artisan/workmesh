type EvidenceOptions = { repoRoot: string; packageDir: string; outputDir?: string };
type EsbuildResult = {
  errors: unknown[];
  metafile?: {
    inputs: Record<string, unknown>;
    outputs: Record<
      string,
      {
        inputs: Record<string, { bytesInOutput: number }>;
        imports: { external?: boolean; path: string }[];
      }
    >;
  };
};
type EsbuildBuild = { onEnd(callback: (result: EsbuildResult) => void): void };
type RollupOutput =
  | { type: 'asset'; fileName: string }
  | {
      type: 'chunk';
      fileName: string;
      modules: Record<string, { renderedLength: number }>;
      imports: string[];
      dynamicImports: string[];
    };
export const EVIDENCE_FILE: string;
export function createEsbuildEvidenceHooks(options: EvidenceOptions): {
  esbuildPlugins: { name: string; setup(build: EsbuildBuild): void }[];
  onSuccess(): Promise<void>;
};
export function createRollupEvidencePlugin(options: EvidenceOptions): {
  name: string;
  apply: 'build';
  enforce: 'post';
  writeBundle(
    this: {
      getModuleIds(): IterableIterator<string>;
      getModuleInfo(id: string): { isExternal: boolean } | null;
    },
    options: { dir?: string },
    bundle: Record<string, RollupOutput>,
  ): void;
};
export function validateEvidence(evidence: unknown): unknown;
export function verifyBundleEvidence(
  directory: string,
  supplied?: unknown,
): Record<string, unknown>;
