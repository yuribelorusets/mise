import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // Agent worktrees live under .claude/, and web/ runs its own tests.
    exclude: [...configDefaults.exclude, ".claude/**", "web/**"],
  },
});
