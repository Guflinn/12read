// electron.vite.config.ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var __electron_vite_injected_dirname = "D:\\Desktop\\dsh\u5DE5\u4F5C\u533A\\\u5341\u4E8C\u9605\u8BFB";
var sharedDir = resolve(__electron_vite_injected_dirname, "src/shared");
var mainDir = resolve(__electron_vite_injected_dirname, "src/main");
var rendererSrcDir = resolve(__electron_vite_injected_dirname, "src/renderer/src");
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": sharedDir, "@main": mainDir } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/main/index.ts"),
          // 解码 worker 单独一个入口，运行时按 __dirname/decode.worker.js 找它。
          "decode.worker": resolve(__electron_vite_injected_dirname, "src/main/workers/decode.worker.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": sharedDir } },
    build: {
      rollupOptions: { input: { index: resolve(__electron_vite_injected_dirname, "src/preload/index.ts") } }
    }
  },
  renderer: {
    root: resolve(__electron_vite_injected_dirname, "src/renderer"),
    resolve: { alias: { "@shared": sharedDir, "@": rendererSrcDir } },
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve(__electron_vite_injected_dirname, "src/renderer/index.html") } }
    }
  }
});
export {
  electron_vite_config_default as default
};
