import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: [
			"dist_chrome/**",
			"node_modules/**",
			".ladle/**",
			"public/*",
			"!public/welcome.js",
			"tmp/**",
			"build/**",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.{ts,tsx,mjs}", "public/welcome.js"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				chrome: "readonly",
			},
		},
		plugins: {
			react,
			"react-hooks": reactHooks,
			"jsx-a11y": jsxA11y,
		},
		rules: {
			...react.configs.recommended.rules,
			...reactHooks.configs.recommended.rules,
			...jsxA11y.configs.recommended.rules,
			"react/react-in-jsx-scope": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
		},
		settings: {
			react: { version: "detect" },
		},
	},
);
