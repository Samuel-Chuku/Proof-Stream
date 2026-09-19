declare namespace JSX {
  interface Element { readonly __proofstreamElement?: true; }
  interface IntrinsicElements {
    section: { 'aria-live'?: string; children?: unknown };
    strong: { children?: unknown };
    p: { children?: unknown };
  }
}
