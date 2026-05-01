// @ts-check
import eslint from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["**/dist/", "**/node_modules/", "**/*.js", "**/*.mjs"],
    },
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/consistent-type-exports": "error",
            "@typescript-eslint/no-import-type-side-effects": "error",
            "@typescript-eslint/explicit-module-boundary-types": "error",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "all",
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
        },
    },
    {
        files: ["**/*.tsx"],
        ...react.configs.flat.recommended,
        ...react.configs.flat["jsx-runtime"],
        languageOptions: {
            ...react.configs.flat.recommended.languageOptions,
            globals: {
                ...globals.browser,
            },
        },
        settings: {
            react: {
                version: "detect",
            },
        },
    },
    {
        files: ["**/*.tsx"],
        ...reactHooks.configs.flat.recommended,
    },
    {
        files: ["**/*.tsx"],
        plugins: { "react-refresh": reactRefresh },
        rules: {
            "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
        },
    },
);
