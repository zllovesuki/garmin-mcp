import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [cloudflare()],
	server: { host: "127.0.0.1", port: 5173 },
	fmt: { useTabs: true },
	lint: {
		options: { typeAware: true, typeCheck: true },
		rules: {
			"typescript/no-floating-promises": "error",
			"typescript/no-misused-promises": "error",
			"typescript/no-explicit-any": "error",
		},
	},
});
