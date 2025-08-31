const { FlatCompat } = require("@eslint/eslintrc");
const typescriptPlugin = require("@typescript-eslint/eslint-plugin");

const compat = new FlatCompat({ baseDirectory: __dirname });

module.exports = [
  ...compat.extends("eslint:recommended"),
  {
    plugins: {
      "@typescript-eslint": typescriptPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
];
