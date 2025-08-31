import { FlatCompat } from "@eslint/eslintrc";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends("eslint:recommended"),
  {
    plugins: {
      "@typescript-eslint": typescriptPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      // Lägg till fler regler här
    },
  },
];
