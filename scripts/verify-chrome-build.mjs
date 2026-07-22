#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(rootDir, "dist_chrome");

const DEV_ICON_FILENAMES = ["dev-icon-32.png", "dev-icon-128.png"];
const PROD_ICON_FILENAMES = ["icon-16.png", "icon-32.png", "icon-48.png", "icon-128.png"];
const REQUIRED_SURFACE_FILES = [
	"src/pages/popup/index.html",
	"src/pages/options/index.html",
	"welcome.html",
	"alarm-player.html",
	"alarm-player.js",
];
const REMOVED_SURFACE_KEYS = [
	"content_scripts",
	"devtools_page",
	"side_panel",
	"chrome_url_overrides",
];

let failures = [];

function fail(message) {
	failures.push(message);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

async function listFilesRecursive(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFilesRecursive(full)));
		} else {
			files.push(full);
		}
	}
	return files;
}

function checkRequiredSurfaceFiles() {
	for (const relativePath of REQUIRED_SURFACE_FILES) {
		if (!existsSync(join(distDir, relativePath))) {
			fail(`Missing required build output: ${relativePath}`);
		}
	}
}

function checkNoRemovedSurfaces(manifest) {
	for (const key of REMOVED_SURFACE_KEYS) {
		if (manifest[key] !== undefined) {
			fail(`Built manifest must not contain "${key}"`);
		}
	}
	const background = manifest.background ?? {};
	if (background.scripts !== undefined || background.page !== undefined) {
		fail("Built manifest background must be a service worker, not a Firefox-style background");
	}
	if (!background.service_worker) {
		fail("Built manifest is missing background.service_worker");
	}
}

function iconValues(manifest) {
	const values = [];
	const defaultIcon = manifest.action?.default_icon ?? {};
	values.push(...Object.values(defaultIcon));
	values.push(...Object.values(manifest.icons ?? {}));
	return values;
}

async function verifyProduction() {
	const distManifestPath = join(distDir, "manifest.json");
	if (!existsSync(distManifestPath)) {
		fail("dist_chrome/manifest.json is missing");
		return;
	}
	const distManifest = readJson(distManifestPath);
	const sourceManifest = readJson(join(rootDir, "manifest.json"));

	if (distManifest.name !== sourceManifest.name) {
		fail(
			`Production manifest name "${distManifest.name}" does not match source manifest name "${sourceManifest.name}"`,
		);
	}
	if (distManifest.name.includes("Development")) {
		fail(`Production manifest name must not contain "Development": "${distManifest.name}"`);
	}

	const icons = iconValues(distManifest);
	if (icons.some((icon) => icon.startsWith("dev-icon"))) {
		fail("Production manifest must not reference dev-icon-* files");
	}

	for (const filename of DEV_ICON_FILENAMES) {
		if (existsSync(join(distDir, filename))) {
			fail(`Production build must not contain ${filename}`);
		}
	}

	const allFiles = await listFilesRecursive(distDir);
	const mapFiles = allFiles.filter((file) => file.endsWith(".map"));
	if (mapFiles.length > 0) {
		fail(
			`Production build must not contain source-map files, found: ${mapFiles
				.map((file) => file.slice(distDir.length + 1))
				.join(", ")}`,
		);
	}

	checkRequiredSurfaceFiles();
	for (const filename of PROD_ICON_FILENAMES) {
		if (!existsSync(join(distDir, filename))) {
			fail(`Missing production icon: ${filename}`);
		}
	}

	checkNoRemovedSurfaces(distManifest);
}

async function verifyDevelopment() {
	const distManifestPath = join(distDir, "manifest.json");
	if (!existsSync(distManifestPath)) {
		fail("dist_chrome/manifest.json is missing");
		return;
	}
	const distManifest = readJson(distManifestPath);
	const manifestDev = readJson(join(rootDir, "manifest.dev.json"));

	if (distManifest.name !== manifestDev.name) {
		fail(
			`Development manifest name must be exactly "${manifestDev.name}", got "${distManifest.name}"`,
		);
	}

	const defaultIcon = distManifest.action?.default_icon ?? {};
	for (const [size, filename] of Object.entries(manifestDev.action.default_icon)) {
		if (defaultIcon[size] !== filename) {
			fail(
				`Development manifest action.default_icon["${size}"] must be "${filename}", got "${defaultIcon[size]}"`,
			);
		}
	}

	const icons = distManifest.icons ?? {};
	for (const [size, filename] of Object.entries(manifestDev.icons)) {
		if (icons[size] !== filename) {
			fail(`Development manifest icons["${size}"] must be "${filename}", got "${icons[size]}"`);
		}
	}

	for (const filename of DEV_ICON_FILENAMES) {
		if (!existsSync(join(distDir, filename))) {
			fail(`Development build is missing ${filename}`);
		}
	}

	const allFiles = await listFilesRecursive(distDir);
	const mapFiles = allFiles.filter((file) => file.endsWith(".map"));
	if (mapFiles.length === 0) {
		fail("Development build must contain source-map files");
	}

	checkRequiredSurfaceFiles();
	checkNoRemovedSurfaces(distManifest);
}

async function main() {
	const mode = process.argv.slice(2).find((arg) => arg !== "--");
	if (mode !== "production" && mode !== "development") {
		console.error(`Usage: verify-chrome-build.mjs <production|development>`);
		process.exit(1);
	}

	if (!existsSync(distDir)) {
		console.error(`dist_chrome does not exist at ${distDir}`);
		process.exit(1);
	}

	if (mode === "production") {
		await verifyProduction();
	} else {
		await verifyDevelopment();
	}

	if (failures.length > 0) {
		console.error(`verify-chrome-build (${mode}) failed:`);
		for (const failure of failures) {
			console.error(`  - ${failure}`);
		}
		process.exit(1);
	}

	console.log(`verify-chrome-build (${mode}): OK`);
}

await main();
