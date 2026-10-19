import type { TokensFile } from "@sme/core";

export interface BundleFile {
  /** Path relative to the design-system root, e.g. "assets/Lockups/x.svg". */
  path: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface BundleSection {
  path: string;
  title: string;
  markdown: string;
}

export interface BundleAsset extends BundleFile {
  group: string;
  name: string;
}

export interface BundleComponent {
  name: string;
  group?: string;
  readme?: string;
  /** Preview HTML with /_blob/<id> references rewritten to asset:<path>. */
  previewHtml?: string;
}

/** A Claude Design System, normalized and validated, ready to store as a version. */
export interface DesignSystemBundle {
  name: string;
  namespace: string;
  tokens: TokensFile;
  readme: string;
  sections: BundleSection[];
  /** The voice section, when one exists (a section whose title or path mentions "voice"). */
  voice: string;
  fonts: BundleFile[];
  assets: BundleAsset[];
  /** Asset group README notes, keyed by group. */
  groupNotes: Record<string, string>;
  components: BundleComponent[];
  warnings: string[];
}
