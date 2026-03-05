/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
						return "vendor-react";
					}

					if (
						id.includes("node_modules/recharts") ||
						id.includes("node_modules/d3-") ||
						id.includes("node_modules/internmap") ||
						id.includes("node_modules/eventemitter3")
					) {
						return "vendor-charts";
					}

					return undefined;
				},
			},
		},
	},
	server: {
		port: 5173,
		host: "0.0.0.0",
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8000",
				changeOrigin: true,
			},
		},
	},
	test: {
		environment: "jsdom",
	},
});
