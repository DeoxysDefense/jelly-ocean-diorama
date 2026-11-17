# Jelly Ocean Diorama — V2 交接文档（给下一个 AI Agent）

> 版本：基于 **v1.0**（`package.json` 1.0.0）。写于 v1.0 发布后。
> 读者：接手 V2 开发的 AI 编程 Agent。用户（项目所有者）用中文沟通。
> 最后一节有一份**可以直接粘贴给新 Agent 的启动 Prompt**。

---

## 0. 一句话

一个用 Three.js + TypeScript + Vite 写的「果冻海水微缩海洋」：2.5D 正交相机、透明果冻水体、左侧热带小岛、
自主行动的海洋生物、沙盒编辑、昼夜潮汐、漂流瓶、小游戏。它同时是 **Lively Wallpaper 交互式桌面壁纸**、
**桌面快捷方式小程序**（Edge app 模式）和普通网页。所有模型 / 贴图都是**代码程序化生成**，没有外部资源。

设计哲学（用户反复强调，必须遵守）：
**A peaceful ocean that feels alive, rewards curiosity, and offers small moments of play.**
安静、美、低打扰；不要变成吵闹复杂的游戏。

---

## 1. 必须遵守的硬性约定

1. **不推翻已有功能**。在现有架构上扩展；不换技术栈（Three.js r170 / TS / Vite 5 / Vitest，无 UI 框架）。
2. **Front View 构图是神圣的**：小岛偏左、小木屋、天空 / 海水 / 海床比例。改动世界尺寸或相机前先截图对比。
3. **不打扰**：不自动弹窗、不自动开始小游戏、不播放突兀音效。随机内容低频、可关闭。
4. **Lively 兼容**：壁纸是 `file://` 加载的单文件 IIFE（不能用 ES module 的动态加载）；Ambient 模式低资源；
   `livelyWallpaperPlaybackChanged` 暂停时完全停渲染。新设置要同步加到 `lively/LivelyProperties.json`
   和 `src/platform/WallpaperAdapter.ts`。
5. **存档向后兼容**：改存档结构就升 schema 版本并写迁移（见 §5）。旧存档里的物体不能位移。
6. **所有资源程序化**；若引入外部资源，必须在 `ASSETS.md` 记录来源和许可证。
7. **新功能的文字双语**（中文 / English），走 `src/features/i18n.ts`；旧面板目前仍是英文。
8. **每次交付前**：`npm test`（类型检查 + 单元测试）、`npm run build`、`npm run package:desktop`
   （同时生成 Lively 包和桌面包）全部通过；并在浏览器里**实际看过画面**。
9. 不要把占位实现当成完成；做不到的要明说。
10. 给用户的回复用中文：说清楚 **原因 → 修复 → 怎么验证的 → 还没验证什么**。

---

## 2. 运行与构建

```bash
npm install
npm run dev              # http://127.0.0.1:5173
npm test                 # tsc + vitest（当前 28 个测试）
npm run build            # tsc + vite build → dist/
npm run package:lively   # 单文件壁纸 → dist-lively/ + JellyOcean-Lively.zip
npm run package:desktop  # 上面 + 桌面版 → dist-desktop/ + JellyOcean-Desktop.zip
```

- `.claude/launch.json` 有两个预览配置：`jelly-ocean`（dev，5173）和 `lively-build`（预览 dist-lively，5174）。
- **Lively zip 的文件必须在压缩包根目录**（`LivelyInfo.json` 在最外层）。`scripts/zip.mjs` 是自写的 zip 生成器，
  不要换回 PowerShell `Compress-Archive`（曾因路径转义把整个文件夹打进去，导致 Lively 拒绝导入）。
- 桌面版：`dist-desktop/create-shortcut.ps1` 创建桌面 + 开始菜单快捷方式，目标是
  `msedge.exe --app="file:///…/index.html"`；图标由 `scripts/icon.mjs` 程序化绘制（PNG / ICO）。
  用户本机的快捷方式指向 `D:\AI_ISLAND\dist-desktop\`，重新打包后自动生效。

---

## 3. 坐标与世界

- **X** 左右（`xMin -30` … `xMax 30`），**Y** 高度（静水面 `y = 0`），**Z** 纵深：前切面 `zFront = 6`，
  后墙 `zBack = -13`（v1 中已从 -6 扩展到 -13，Top View 才有真正的纵深）。
- 用 `src/config.ts` 里的 `zClamp(z, margin)`、`randZ(margin, bias)`、`zCentre()`，**不要再写死 ±5 之类的数字**。
  `randZ` 的 `bias > 1` 偏向前半部分（保持 Front View 生动，后方稀疏）。
- 地形：`H(x,z) = base + sed`；`sed` 里有 `firm`（Island Stamp 压实层，不会滑塌）。网格约 0.2 单位
  （`TerrainSystem.nz` 由纵深自动算）。
- 水面：`W(x,z,t) = level（潮位）+ 波动方程模拟 + 解析风浪 + 微涟漪`，统一由 `WaterSurfaceSimulation.heightAt()` 提供。
  **Front 和 Top View 共用同一个 3D 高度场**——所有漂浮物、溅水都要用它。
- 相机：`CameraManager` 一个正交相机在 Front（俯角 7.2°）和 Top（90°）之间插值；`cam.isTop`、`cam.blend`。

---

## 4. 架构速览（`src/`，约 1.6 万行）

| 目录 / 文件 | 职责 |
|---|---|
| `core/App.ts` | 根对象：持有所有系统，`step(dt)` 主循环顺序，`render()`；V3 的 `prefs / i18n / mail / coconuts / events / magnifier / games / spray`；`serializeExtras / applyExtras`（存档扩展）；`busy`（编辑或小游戏中，随机事件延后） |
| `core/RenderPipeline.ts` | 三 pass：世界 → HDR MSAA RT（含深度）→ 合成到画布（写 `gl_FragDepth`）→ 水体最后画（自己做折射 / 吸收 / 菲涅尔，输出不透明）。`render(world, water, cam, target)` 可渲染到离屏目标 |
| `core/EnvironmentController.ts` | 风、水色预设、时间（手动 / 循环 / 跟随电脑时钟）、雨、潮位（手动 / 自动潮汐），产出 `atm`（大气参数） |
| `water/*` | 水面模拟（**子步数按 CFL 自适应**，防卡顿时爆出尖刺）、风浪、水体渲染 shader、水色 |
| `world/*` | 地形、天空、光照、小岛（木屋、2 棵椰子树 `palms[]` 含 `spine` 与 `shake`）、礁石 / 珊瑚 / 栖息地（`Reef`）、水流场 `FlowField`、粒子、沉积、浮游生物荧光、雨、漂浮物 |
| `world/coralFactory.ts` | 所有程序化珊瑚 / 贝壳。`conch()` 是 Raup 螺旋模型（各圈相互覆盖，闭合螺塔），`geometry.userData.aperture` 记录壳口中心 / 朝向 / 螺轴 |
| `creatures/*` | 鱼群（boids + 心情 / 饥饿）、水母、螃蟹、寄居蟹（自动对齐壳口 `orientShell()`、换壳）、章鱼（含 **捉迷藏游戏模式** `gameHide / gameFound / gameEnd`）、鳐鱼（水深带 `band()`，永不出水）。`shoreline.ts`：螃蟹类永不上岸 / 搁浅自救 |
| `features/*` | V3 功能：`Prefs`（自动持久化）、`i18n`、`OceanMail`（漂流瓶）、`CoconutGrowth`（真实时间戳生长）、`OceanEvents`（随机小惊喜，`OceanEvent` 接口）、`Magnifier`（第二次实时渲染）、`MiniGames` + `StoneSkipping` + `HideSeek`（`MiniGame` 接口）、`fx.ts`（`floatStep` 浮力 / `Spray` 水花池 / `disposeTree`） |
| `content/messages.ts` | 漂流瓶消息库：24 冷知识 + 30 幸运句 + 20 温柔句，双语，稳定 id，`pickMessage(recent)` 避免重复 |
| `interaction/*` | 工具状态、撤销重做、选择 / 拖拽、`InteractionManager`（指针 → 世界映射 + **输入优先级**）、地面光圈 |
| `ui/*` | `UIController`（Ocean Studio 五个标签页）、`FeatureUI`（V3 折叠组 + 漂流瓶纸条）、`styles.css`（颜色 token 在 `:root`）、内联 SVG 图标 |
| `platform/*` | `WallpaperAdapter`（Lively / Wallpaper Engine 属性）、`Settings`（基础设置）、`WorldStore`（存档 v3 + 迁移） |
| `util/shaders.ts` | `patchMaterial()`：给标准材质注入焦散、摇摆（**水流只影响水下植物**，`org.y < uWaterLevel`）、边缘光、程序化凹凸；`shared` 全局 uniform |

**输入优先级**（`InteractionManager`）：UI（DOM，不进画布）→ 进行中的小游戏（独占指针 / 滚轮）→ 放大镜固定 /
漂流瓶 / 椰子与椰子树 → 当前工具 → 环境悬停。一次按下只交给一层（`captured` 字段）。新增可点击物体请加在第 3 层，并只在
`tool === 'default'` 或 Ambient 模式下响应，避免和编辑工具冲突。

**主循环顺序**（`App.step`）：环境 → 相机 → 交互 → 水流 → 水面模拟 → 地形 / 遮罩 → 光照 / 水体大气 → 天气 / 漂浮 / 浮游生物 →
沉积 → 生物 → 小岛 → 选择 → 气泡 / 雪 → 水体 → 天空 → V3（椰子、漂流瓶、事件、小游戏、水花、面板计时）。

---

## 5. 持久化与存档

- **基础设置**：`localStorage['jelly-ocean-settings-v1']`（水色、风、模式、画质、面板折叠）。
- **V3 偏好与慢速状态**：`localStorage['jelly-ocean-v3']`（语言、漂流瓶 / 小惊喜开关、频率与倒计时、椰子时间戳、
  个人纪录），由 `features/Prefs.ts` 自动保存；`merge()` 会校验每个字段（导入的脏数据不会污染）。
- **Save World 槽**：`localStorage['jelly-ocean-world-v2']`（键名历史原因未改），内容是 **schema v3**：
  沙子网格（自带 `bounds`）、物体、放置的栖息地、种群、环境、`extras.prefs`。
  `WorldStore.migrateGrid()` 按世界坐标把旧网格重采样到新网格——**以后再改地形范围或分辨率，复用它**。
- 临时状态（涟漪、水花、进行中的事件、漂流瓶、掉落的椰子、石头）**永不存档**。
- 计时类功能用**时间戳**（离线时间按上限补算，不回放动画）；随机事件 / 漂流瓶用**有效运行时间**（页面隐藏或壁纸暂停不累计）。

---

## 6. 调试与验证方法（非常重要，省时间）

浏览器控制台里 `window.__jelly` 就是 `App`：

```js
const a = __jelly;
a.setPaused(true);                 // 停止 rAF 循环，改为手动步进
for (let i = 0; i < 300; i++) a.step(1/30, false);  // 模拟 10 秒
a.render(false);                   // 手动渲染一帧（射线拾取前也要先 render，矩阵才更新）
a.debugView(x, y, zoom);           // 放大到世界坐标 (x, y)；无参数复位
a.mail.spawnTest();                // 立刻生成漂流瓶
a.events.trigger('starfish' | 'school' | 'crabShell' | 'palmLeaf' | 'shellAshore');
a.games.start('skip' | 'hide');  a.games.exit();
a.creatures.setPopulation('octopus', 1);
a.renderer.info.memory             // 泄漏检查：循环跑功能前后比较 geometries / textures
```

经验：
- 预览面板里的 rAF 会被节流，**别依赖实时运行**，用 `setPaused + step` 做确定性测试；截图偶尔是旧帧，`render` 后再截。
- Front View 里把画面中心对准某点：`debugView(p.x, p.y - p.z * tan(7.2°), zoom)`。
- 单独看一个模型：新建 Scene + 克隆光照 + 正交相机直接 `renderer.render`（v1 调寄居蟹贝壳就是这样做的）。
- **用户可能正在用同一个预览标签页**——检查前开一个后台标签页，用完复原（不要暂停 / 缩放用户的画面）。
- 内置浏览器打不开 `file://`；验证单文件包可用无界面 Edge：
  `msedge --headless=new --user-data-dir=<临时目录> --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=10000 --dump-dom file:///…/index.html`
- 长时间稳定性：v1 用「每类功能循环触发 15 分钟模拟时间」测过，V3 功能显存零增长。新增临时对象必须有明确生命周期并 dispose。
- 性能参考（1.5 像素比、1280×720）：一帧约 13 ms；放大镜开启约 +3 ms；水面模拟约 2–3 ms。

---

## 7. 已知限制 / 技术债

- 只有 V3 新功能是双语；主面板仍是英文。
- 漂流瓶 / 小惊喜按有效运行时间计时，壁纸常暂停时会很稀少（有意为之）。
- 默认 Front View 下部分椰子被树叶挡住，摇树是更可靠的采摘方式。
- 打水漂是简化的弹跳规则（入水角 < ~29°、水平速度 > 2、每次能量损失），没有石头自旋 / 倾角模型。
- 捉迷藏在 Front View 只选 z > -6.5 的藏身处（太远会被水色遮住）。
- 鱼的游动变形不进阴影 pass；沙子网格精度约 0.17×0.2；水只是表层高度场，没有 3D 流体体积。
- Lively 的鼠标交互依赖宿主转发，桌面图标会挡住点击。
- 还没做：音频（必须可选、默认关）、鸟、自由旋转视角、Wallpaper Engine 打包、Lively 缩略图（`lively/thumbnail.jpg`，打包脚本会自动带上）、LICENSE（等用户决定）。
- 用户之前说过「暂不」的：GLB 模型替换、Follow Creature 跟随镜头。
- v1 需求里明确排除过的：海底收音机、时间胶囊、实时新闻 API、真实天气同步、海洋明信片、复杂社会 / 繁殖系统、大型任务 / 成就 / 排行榜。
  **如果 V2 想做其中任何一项，先问用户。**

---

## 8. 做 V2 的工作方式（建议）

1. 先读 `README.md`、`ASSETS.md`、本文件，再看相关源码；不要只写计划。
2. 和用户确认 V2 范围（§9 是候选池，用户挑）。大功能分阶段，每阶段可运行、可验证。
3. 新系统尽量做成 `features/` 下的独立模块，在 `App` 里注册；需要 UI 就加在 `FeatureUI` 的折叠组里，保持面板简洁。
4. 改存档 → 升 schema + 迁移 + 测试；改世界尺寸 → 复用 `migrateGrid` 并对比 Front View 截图。
5. 交付时更新：`README.md`（功能 / 控制 / 已知限制）、`ASSETS.md`、`package.json` 与 `lively/LivelyInfo.json` 的版本号。
6. 回复用户：中文；先结论，再原因 / 修复 / 验证；明确说哪些没测（比如「没在 Lively 里实测」）。

---

## 9. V2 候选功能池（v1 Agent 提议，由用户挑选，未承诺）

详见对话中的完整说明；按「会让人会心一笑」的程度排序，括号里是可以复用的现有系统。

1. **椰子章鱼**：掉进海里的椰子裂成两半沉底，章鱼会把椰壳收集起来当移动小屋，受惊时躲进去（真实存在的行为）。（CoconutGrowth、Octopus、HideSeek）
2. **海龟产卵与孵化**：罕见的月夜，海龟爬上沙滩挖坑产卵；按真实时间约几天后，小海龟在夜里朝月光爬向大海——小屋的灯如果开着会让它们迷路。（真实时间戳、Island 夜灯、shoreline）
3. **真实月相 → 大潮 / 小潮**：按真实日期计算月相，满月 / 新月潮差更大，夜晚亮度跟着变；满月后某夜珊瑚集体产卵，海里飘起粉色「雪」。（Atmosphere、EnvironmentController、MarineSnow）
4. **寄居蟹排队换壳（空壳连锁）**：放下一个大空壳，几只寄居蟹按大小排队，像接力一样依次换壳。（HermitCrab、Reef 空壳）
5. **沙滩留言**：在沙滩上用手指写字，潮水和浪花慢慢把字抹平。（Terrain sed 层、潮汐）
6. **专注潮汐（番茄钟）**：工作 25 分钟海平面慢慢涨起，休息时退潮露出贝壳；完全可选，不弹窗。（潮位系统、桌面版）
7. **鱼的记忆**：经常在同一时间同一地点喂鱼，鱼会提前在那里聚集等你。（FishSystem、Prefs）
8. **清洁站**：放一块「清洁礁石」，清洁虾 / 裂唇鱼开张，其他鱼排队张嘴等清洁。（Reef 栖息地、FishSystem 心情）
9. **潮池**：低潮时小岛边的石洼变成独立小水池，困住小鱼和海兔，用放大镜观察，涨潮放它们回去。（潮位、Magnifier、地形）
10. **深处的巨影**：极低频地，一头鲸鲨的剪影从纵深最远处缓缓游过，只看得见轮廓——充分用上新扩展的纵深。（OceanEvents、z = -13 后方区域）
11. **夜光浪花**：夜里起风时，拍岸的浪尖泛起蓝色荧光，点击水面溅起一圈光。（Plankton、水面模拟）
12. **海洋图鉴 / 观察日记**：第一次看到某个行为（寄居蟹换壳、章鱼喷墨、海星冒出）就在手绘风小本子里记一页，附双语知识；只收集、不打分。（注意：与「不做成就系统」的约定要和用户确认边界）
13. **生态小循环**：喂太多 → 藻类变多、水变绿，海胆和鹦嘴鱼会慢慢把它吃回来；温和的因果，没有失败。（WaterColor、FoodSystem、生物行为）
14. **海鸟**：海鸥偶尔落在木屋屋顶，俯冲叼鱼，或者偷啄掉在沙滩上的椰子。（Island、Floaters、鱼群惊吓）
15. **风暴与彩虹**：偶尔一阵短暂的过路雨，远处闪电，雨停后天边出现彩虹，沙滩上多了被冲上来的贝壳和漂流木。（Rain、Sky、OceanEvents）
16. **小鱼躲在水母伞下**：幼鱼跟着水母游，危险时钻到触手下（真实的共生行为）。（Jellyfish、FishSystem）
17. **摄影模式**：暂停时间、移轴景深、加画框，导出高清 PNG 当壁纸或分享。（RenderPipeline、Magnifier 的离屏渲染）（与「海洋明信片」非目标有重叠，先确认）
18. **可选的环境声景**：默认关闭；轻浪、枪虾的噼啪声、极罕见的远处鲸歌，随视角和昼夜变化。（WebAudio；必须遵守不打扰原则）

---

## 10. 可直接粘贴给新 Agent 的启动 Prompt

```text
你是一名资深 Creative Developer / Three.js 工程师 / 交互设计师。请继续开发
D:\AI_ISLAND 下的「Jelly Ocean Diorama」（当前 v1.0）。

开始前必须先完整阅读：docs/V2_HANDOFF.md、README.md、ASSETS.md，然后再看相关源码。
严格遵守交接文档 §1 的硬性约定（不推翻已有功能、Front View 构图不变、不打扰、
Lively 兼容、存档向后兼容、资源程序化、新文字双语、交付前 test / build / package:desktop
全过并在浏览器里实际看过画面）。

本轮 V2 的目标：<在这里写用户选定的功能，例如从交接文档 §9 中挑选的编号>

工作方式：
1. 先检查工程并给出简短的分阶段计划，然后直接实现，不要只写计划或伪代码。
2. 每个阶段都要可运行、可验证；用 window.__jelly（setPaused / step / render /
   debugView / events.trigger / games.start）做确定性测试，必要时补单元测试。
3. 新功能放在 src/features/ 下的独立模块，UI 放进 FeatureUI 的折叠组。
4. 交付时用中文汇报：改了哪些文件、新功能怎么用、新增控件、存档兼容说明、
   测试与构建结果、已知问题与后续建议；明确说明哪些没有验证。
```
