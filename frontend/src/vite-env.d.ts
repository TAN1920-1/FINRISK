/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin. Empty means "same origin", which the dev proxy provides. */
  readonly VITE_API_BASE_URL?: string;
  /** Development-only proxy target for `/api`; never used in a production build. */
  readonly VITE_DEV_API_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
