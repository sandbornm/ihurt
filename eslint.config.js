import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// tests/*.ts sit outside tsconfig.json, so typed linting uses tsconfig.eslint.json.

export default tseslint.config(
  {
    ignores: ["dist/**", "ios/**", "public/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["tests/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", name: "test", package: "node:test" },
          ],
        },
      ],
    },
  },
);
