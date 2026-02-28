/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL?: string;
	readonly VITE_API_TOKEN?: string;
	readonly VITE_ENABLE_PWA?: "true" | "false";
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
