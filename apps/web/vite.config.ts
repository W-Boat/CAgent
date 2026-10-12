import { defineConfig, loadEnv } from "vite"
import vue from "@vitejs/plugin-vue"
import AutoImport from "unplugin-auto-import/vite"
import Components from "unplugin-vue-components/vite"
import { ElementPlusResolver } from "unplugin-vue-components/resolvers"
import { fileURLToPath, URL } from "node:url"

export default defineConfig(({ mode }) => {
  // 环境变量统一放在仓库根目录的 .env 里
  const env = loadEnv(mode, fileURLToPath(new URL("../../", import.meta.url)), "")

  /*
   * 关键：根目录 .env 里的 NODE_ENV=development 是给后端用的，
   * 但 Vite 会把 loadEnv 的结果合并进 import.meta.env，
   * 于是生产构建也被判定成开发环境——表现为
   * `import.meta.env.DEV === true`，DEV 分支的代码（含默认账号密码）
   * 全部留在线上包里。这里以 Vite 自身的 mode 为准，屏蔽掉那个值。
   */
  const isProd = mode === "production"
  const define: Record<string, string> = {}
  if (isProd) {
    define["import.meta.env.DEV"] = "false"
    define["import.meta.env.PROD"] = "true"
  }

  const apiTarget = env.VITE_API_TARGET || "http://127.0.0.1:3001"
  const port = Number(env.WEB_PORT || 5173)

  return {
    define,
    plugins: [
      vue(),
      /*
       * Element Plus 按需引入。
       *
       * 全量 `app.use(ElementPlus)` 会把所有组件的 JS + 样式都打进首屏包：
       * 实测 element chunk 1065KB、样式 365KB，登录页也要把它们全下载完。
       * 按需后只打包模板里真正用到的组件，首屏体积大幅下降。
       */
      AutoImport({
        imports: ["vue", "vue-router", "pinia"],
        resolvers: [ElementPlusResolver()],
        dts: "src/types/auto-imports.d.ts",
        eslintrc: { enabled: false }
      }),
      Components({
        resolvers: [ElementPlusResolver()],
        /*
         * 不生成 components.d.ts。
         *
         * 生成后 <el-table> 的插槽行类型会变成 DefaultRow（Record<string, any>），
         * 而 Record<string, any> 不能赋给具体接口（AgentItem 等），
         * 于是 19 个业务页面里 `@click="fn(row)"` 全部报 TS2345 —— 共 60+ 处。
         * 这些是模板层面的类型摩擦，不是运行时缺陷；把类型声明关掉即可恢复
         * 「组件按需引入（有性能收益）」但「模板保持宽松推断」的原有体验。
         *
         * 注意：这只影响 TS 类型产物，JS 仍按需引入，性能优化不受影响。
         */
        dts: false,
        // 自己的组件也别自动注册，避免与显式 import 冲突
        dirs: [],
        extensions: ["vue"]
      })
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    server: {
      host: "0.0.0.0",
      port,
      strictPort: true,
      watch: {
        // 编辑器/脚本的原子写会留下 .xxx.tmpdir 之类的临时目录，
        // chokidar 去 watch 它们时会撞上 EBUSY 并把整个 dev server 带崩。
        // 只盯真正的源码与静态资源，其余一律忽略。
        ignored: [
          "**/.*.tmpdir/**",
          "**/*.tmp",
          "**/node_modules/**",
          "**/dist/**",
          "**/storage/**"
        ],
        // 等待写入稳定再触发，规避「文件正被占用」的瞬时错误
        awaitWriteFinish: {
          stabilityThreshold: 120,
          pollInterval: 40
        }
      },
      proxy: {
        // 前端始终请求同源 /api，由 Vite 转发到 NestJS，天然规避 CORS
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          ws: false
        },
        "/static": {
          target: apiTarget,
          changeOrigin: true
        }
      }
    },

    /*
     * preview 也要代理 API。
     *
     * `vite preview` 默认不继承 server.proxy，导致用它验证**生产构建产物**时
     * 所有 /api 请求都 404 —— 而验证线上行为恰恰需要跑压缩后的真实产物
     * （开发模式的未压缩 ESM 与生产 bundle 在模块时序上可能不同）。
     */
    preview: {
      port: 4173,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true, ws: false },
        "/static": { target: apiTarget, changeOrigin: true }
      }
    },
    build: {
      outDir: "dist",
      chunkSizeWarningLimit: 900,
      // 生产不生成 sourcemap：体积更小、也不会把源码暴露到公网
      sourcemap: false,
      // 用 esbuild 压缩，比 terser 快且效果接近
      minify: "esbuild",
      // 单文件小于 4KB 时内联，减少请求数
      assetsInlineLimit: 4096,
      cssCodeSplit: true,
      reportCompressedSize: false,
      rollupOptions: {
        output: {
          /*
           * 分包策略。
           *
           * 只把「真正全局共享、且首屏必用」的库单独分包：框架和请求库。
           *
           * ⚠️ 不要把 element-plus / echarts / markdown-it 等归到固定 chunk。
           *
           * manualChunks 一旦返回某个名字，Rollup 就把它变成**静态依赖**：
           * 即使用户当前页面用不到，也会被 entry 的 import 链拉下来。
           * 实测把 element-plus 指定成固定 chunk 后，登录页白下载 288KB。
           *
           * 同样的陷阱还有「其余都 return 'vendor'」这种兜底写法 ——
           * 看起来是把小包合并，实际会把 element-plus 的依赖一起吸进 vendor，
           * 导致 vendor 膨胀到 2.3MB 且被首屏静态加载（已实测踩过）。
           *
           * 因此只保留两个真正必需的分包，其余交给 Rollup 按 import 关系
           * 自动决定 —— 它会为每个动态 import 的路由生成独立 chunk，
       *      并自动把多页共享的模块提取到公共 chunk。
           *
           * 副作用是 Element Plus 的按需导入会产生较多小碎片（实测 89 个 chunk）。
           * 线上每个 chunk TTFB 约 230ms，请求数是真实的性能瓶颈 ——
           * 但这应该靠**开启 CDN 缓存**解决（静态资源带 hash，可长期缓存），
           * 而不是靠合并 chunk 牺牲按需加载。
           */
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return undefined

            /*
             * 解析包名必须处理 pnpm 的嵌套结构。
             *
             * pnpm 把依赖放在 node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/…
             * 因此简单的 `node_modules/([^/]+)` 只会匹配到 `.pnpm` ——
             * 所有包都变成同一个名字，规则全部落空（实测踩过：改了半天没生效）。
             *
             * 正确做法是取**最后一个** node_modules/ 之后的那一段。
             */
            const afterLast = id.split("node_modules/").pop() || ""
            const pkg = afterLast.match(/^((?:@[^/]+\/)?[^/]+)/)?.[1]
            if (!pkg || pkg === ".pnpm") return undefined

            /*
             * 注意不要用 `id.includes("/vue/")` 这种宽泛匹配：
             * 它会把 `@element-plus/icons-vue`（路径含 `/vue/`）也吸进框架 chunk，
             * 导致 293 个图标被打进首屏必载的包（实测该 chunk 因此 381KB）。
             */
            if (pkg === "vue" || pkg === "vue-router" || pkg === "pinia") return "vue"
            if (pkg.startsWith("@vue/")) return "vue"

            if (pkg === "axios") return "vendor"

            // Keep icons in their actual import graph. A single manual icon
            // chunk makes one Message icon pull every admin icon into entry.

            return undefined
          },
          // New URLs also bypass CDN copies of the earlier premature gzip files.
          chunkFileNames: "assets/[name]-[hash]-r1.js",
          entryFileNames: "assets/[name]-[hash]-r1.js",
          assetFileNames: "assets/[name]-[hash]-r1[extname]",

          /*
           * 合并过小的 chunk。
           *
           * 背景：Element Plus 按需导入会把组件拆成大量 1-2KB 碎片
           * （实测 89 个 chunk，其中 17 个 <2KB）。线上每个 chunk 的
           * TTFB 约 230ms（Cloudflare 首次未命中时回源到小服务器），
           * 一次页面切换发 20 个请求，光网络就 2 秒以上。
           *
           * 为什么不用 manualChunks 合并：manualChunks 一返回名字，
           * Rollup 就把它当成**静态依赖**，用不到的库也会被首屏拉下来。
           * 实测把 element-plus 指定成固定 chunk 后，登录页白下载 288KB；
           * 用 `return "vendor"` 兜底更糟 —— vendor 膨胀到 2.3MB 且被静态加载。
           *
           * `experimentalMinChunkSize` 是 Rollup 4 提供的**后处理**合并：
           * 它在 tree-shaking 与代码分割完成后，把小于阈值的 chunk
           * 合并进引用它的 chunk，不改变模块的静态/动态依赖关系。
           * 因此既能显著减少请求数，又不会把用不到的代码拉进首屏。
           */
          experimentalMinChunkSize: 80 * 1024
        }
      }
    },
    // 预构建：把常用依赖提前打成单文件，dev 启动更快
    optimizeDeps: {
      include: ["vue", "vue-router", "pinia", "axios"]
    }
  }
})
