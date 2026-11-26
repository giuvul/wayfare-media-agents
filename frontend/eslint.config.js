// Lint del front end: regole consigliate di ESLint, regole degli hook di React e Fast Refresh di Vite.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default [
  { ignores: ["dist"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^[A-Z_]", ignoreRestSiblings: true, caughtErrors: "none" }],
      "prefer-const": "error",
      eqeqeq: ["error", "smart"],
    },
  },
  { files: ["test/**/*.js", "vite.config.js", "eslint.config.js"], languageOptions: { globals: globals.node } },
];
