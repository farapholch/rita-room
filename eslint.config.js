// eslint.config.js
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import prettierPlugin from "eslint-plugin-prettier";

export default [
  {
    // Basregler motsvarande eslint:recommended
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
      "prettier": prettierPlugin,
    },
    rules: {
      // ESLint:recommended rules (viktigaste)
      "no-unused-vars": "error",
      "no-console": "warn",
      "eqeqeq": ["error", "always"],

      // TypeScript regler
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",

      // Prettier
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
];
