/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COLLECT_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
