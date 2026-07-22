import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

const DEV_ICON_FILENAMES = ["dev-icon-32.png", "dev-icon-128.png"];

async function removeIfExists(path: string): Promise<void> {
	try {
		await rm(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

/**
 * Vite's publicDir copy ships every file under `public/`, including the
 * development-only icons, into every build. Production builds must not
 * expose them, so this plugin removes them from the output directory once
 * the production bundle is written. A no-op in development: the icons stay
 * where publicDir already put them.
 */
export function stripDevIcons(isDevelopment: boolean): Plugin | null {
	if (isDevelopment) return null;

	let outDir = "";

	return {
		name: "strip-dev-icons",
		configResolved(config: ResolvedConfig) {
			outDir = config.build.outDir;
		},
		async closeBundle() {
			await Promise.all(
				DEV_ICON_FILENAMES.map((filename) => removeIfExists(resolve(outDir, filename))),
			);
		},
	};
}
