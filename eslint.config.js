const { FlatCompat } = require("@eslint/eslintrc");
const typescriptPlugin = require("@typescript-eslint/eslint-plugin");
const path = require("path");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: true, // <-- viktigt
});

module.exports = [
  ...compat.extends("eslint:recommended"),
  {
    plugins: {
      "@typescript-eslint": typescriptPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
