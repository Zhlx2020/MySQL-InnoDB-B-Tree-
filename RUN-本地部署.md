# 本地部署记录

按 README 的 `npm install && npm run dev` 走不通，本机环境做了几处调整。以下是**实际跑起来的那一套**，以及每处改动的理由。

## 跑起来的地址

| 用途 | 地址 | 状态 |
|---|---|---|
| 开发服务器（Vite，改代码热更新） | http://localhost:3000 | 运行中 |
| 生产构建预览（`dist/`，不带热更新） | http://localhost:3100 | 运行中 |

局域网内可访问：`http://192.168.5.5:3000`（`vite.config.ts` 里 `host: '0.0.0.0'` 是原作者设的）。

## 启动命令（重启时用）

```powershell
$node='C:\Users\zlx\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
Set-Location .\innodb-btree-viz\MySQL-InnoDB-B-Tree--main
$tmp='C:\Users\zlx\Downloads\jianli\.tmp-build'
$env:TEMP=$tmp; $env:TMP=$tmp
& $node .\node_modules\vite\bin\vite.js --port 3000 --strictPort
```

生产预览把最后一行的 `vite.js` 换成 `vite.js preview --port 3100 --strictPort`。

## 环境上的四个坑

**1. `npm install` 用不了，改成 pnpm + 扁平链接。**
本机 PATH 上的 npm 是 Volta 装的 8.19.4，而仓库的 `package-lock.json` 是 `lockfileVersion: 3`（npm 9+ 的格式）。用 pnpm 安装时又必须关掉它的符号链接布局——默认布局下 `vite/node_modules` 只有 `.bin`，`picomatch` 之类的传递依赖没被链进来，启动直接 `ERR_MODULE_NOT_FOUND`：

```powershell
& $node $pnpm install --node-linker=hoisted --store-dir "C:\Users\zlx\Downloads\jianli\.pnpm-store"
```

**2. 构建脚本默认被 pnpm 忽略。**
`esbuild` 的 postinstall 不跑就拿不到二进制（`spawn EPERM` 之前会先卡在这一步）。已添加 `pnpm-workspace.yaml` 与 `package.json` 的 `pnpm.onlyBuiltDependencies`，把 `esbuild`、`@google/genai`、`protobufjs` 放行。

**3. esbuild 的临时目录默认落在 `%LOCALAPPDATA%\Temp`，删临时文件会 `Access is denied`。**
构建和 dev 都把 `TEMP`/`TMP` 指到工作区内的 `.tmp-build` 就好了，见上面的命令。

**4. `__smoke__/` 下的测试临时目录会让 dev server 崩掉。**
`vitest` 跑起来时会在测试文件旁建 `.xxx.tmpdir`，chokidar 的 watcher 撞上 `EBUSY` 会**直接让进程退出**（不是警告）。已在 `vite.config.ts` 里把 `**/*.tmpdir/**`、`**/__smoke__/**`、`**/dist/**` 加进 `server.watch.ignored`。

## 验证结果

| 项 | 结果 |
|---|---|
| `vite build` | 通过，`dist/index.html` + 611 kB bundle（有 >500 kB 的单块告警，未拆包） |
| `vitest run` | 3 个文件 28 个用例全通过（含新增的 App 渲染冒烟测试） |
| 页面响应 | `GET /` 200，`/App.tsx`、`/components/TreeVisualizer.tsx` 均 200 且为转译后的 JS |
| 跑测试时 dev server 存活 | 通过（改 watch 忽略之前会挂） |

## 新增文件

- `pnpm-workspace.yaml` —— 放行构建脚本
- `__smoke__/app.smoke.test.tsx` —— 只断言 App 能挂载出内容，防白屏回归
- 本文件

## AI 已接本机网关

已配好在代码里（`types.ts` 的 `DEFAULT_AI_CONFIG[AIProvider.SILICONFLOW]`），打开页面点叶节点即可用，不需要在界面里再填任何东西：

| 项 | 值 |
|---|---|
| Base URL | `/v1`（同源，走 vite 代理） |
| 模型 | `deepseek-ai/DeepSeek-V4.1-Flash-1017` |
| Key | 已写入 `types.ts`（`sk-rp-...`） |

**为什么 Base URL 是 `/v1` 而不是 `http://127.0.0.1:4110/v1`**：该网关不返回 `Access-Control-Allow-Origin`，`OPTIONS` 预检直接 405，浏览器跨源请求会被拦。所以 `vite.config.ts` 里给 `server.proxy` 和 `preview.proxy` 都加了 `/v1 → http://127.0.0.1:4110`，页面只打同源地址，由 vite 转发。

验证（两个口都过）：

```
POST http://127.0.0.1:3000/v1/chat/completions  → 200，返回正常中文解释
POST http://127.0.0.1:3100/v1/chat/completions  → 200
```

另外 `SettingsModal` 里那栏的名字改成了「OpenAI 兼容接口」，切服务商时会带出上面的默认值。

**注意：网关是本机的 DSH 运行时（4110 端口），DSH 不跑的时候 AI 会连不上。** 要换成别的 OpenAI 兼容服务，在 Settings 里改 Base URL 与模型即可；key 存在源码里，换成真 key 记得别再提交到公开仓库。

## 顺手修的一处画法

原始版本把父→子的连线一律从**父节点框的中央**扇出。根节点有 n 个键、n+1 个子页，箭头全从中间射出去之后，"哪个键对应哪个子页"就没法读了——查 4 到底走左边还是右边，图上答不出来。

数据本身是对的：根 `[2,3,4]` 是三个**右侧**子页的最小键，规则是 `key >= 分隔键 → 走右侧`，首键之前走最左。已改成每根连线从自己的分隔键下方出发（`components/TreeVisualizer.tsx`），并在图例里写明这条规则。

`__smoke__/trace.test.ts` 钉住了语义：`4 → [4,5,6]`、`3 → [3]`、`大于所有分隔键 → 最右`。

## 可读性改造（比"箭头挪位置"更进一步）

光把箭头挪对，读者仍要自己配对。改成让**指针与取值范围长在节点内部**，并加"查一个键走一遍"的演示：

| 改动 | 作用 |
|---|---|
| 每个键格下方画三角指针（`children[0]` 在框左沿） | 内部页看起来就是 `(键, 指针)` 记录，与 InnoDB 的存法一致 |
| 每根连线旁标子页范围 `< 2` / `2 – < 3` / `≥ 3` | 不用心算，范围直接读出来 |
| 图下方查询框：输入键 → 返回 | 路径节点编号 1..n、非路径变淡、命中页转绿，并逐行给出比较（`4 ≥ 3，走最右子页`） |
| `BPlusTree.searchPath(key)` + `utils/__tests__/searchPath.test.ts` | 判定逻辑可测：最左 / 中间 / 最右 / 命中 / 未命中五种情形 |

## 两种画法对照 + 回放

- **画法切换**（`InnoDB` / `教科书` 两个按钮）：同一棵树换分隔键的写法与等值归属，`searchPath(key, convention)` 支持两种规则。InnoDB 存右侧子页的最小键、`key ≥ 键` 右转；教科书存左侧子页的最大键、`key ≤ 键` 左转。指针与范围标签跟着画法一起挪。
- **回放**：每次查找按 450ms 一步逐步点亮，回放中有「跳过」，`Esc` 清除。
- 顺带被测试钉住的一个事实：**落在页间空隙的键（如 2、4）在两种画法下都未命中，但停的叶子页不同**——这就是"等值归属"差别的可见后果。

## 其他目标

Gemini 走 `@google/genai` SDK，Ollama 走 `http://localhost:11434/v1`，两条老路都保留，切换即可。
