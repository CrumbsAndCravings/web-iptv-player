import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "out/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: { globals: globals.browser },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["tools/**/*.mjs", "dev/**/*.mjs", "*.mjs"],
    languageOptions: { globals: globals.node },
  },
  // Scripts that drive Chromium also run functions inside the page.
  {
    files: ["dev/screens.mjs", "tools/make_icons.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
