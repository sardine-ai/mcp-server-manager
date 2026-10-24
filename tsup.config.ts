import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/index": "src/cli/index.ts",
    "tui/index": "src/tui/index.ts",
  },
  format: ["esm"],
  target: "node18",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: "dist",
  onSuccess: async () => {
    // Copy HTML files to dist
    const srcDir = "src/services";
    const destDir = "dist";
    
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    
    const htmlFiles = ["auth-callback-success.html", "auth-callback-error.html"];
    for (const file of htmlFiles) {
      copyFileSync(join(srcDir, file), join(destDir, file));
    }
    console.log("Copied HTML assets to dist/");
  },
});
