# @local/dsh-web-split — dsh WebUI 分屏（分裂树版）

在 dsh 网页里加一个**「分屏」主面板**：每个窗格渲染一个会话的完整对话。**拖拽源就是官方左侧会话列表本身**——dsh 本来就允许拖动会话行，插件只负责接住；另外在官方行尾加一个「放入分屏」按钮，点一下也能载入。

## 安装与卸载

安装（已完成）：`/root/.dsh-home/profiles/web/cordis.patch.yml` 的 `- insert:` 里加了

```yaml
    - id: web-split
      name: /opt/dsh-web/local-plugins/dsh-web-split/index.js
```

卸载（三步，全部可逆）：

```bash
# 1. 从 profile patch 里摘掉上面两行（备份在 cordis.patch.yml.bak-pre-split-20261009）
# 2. 删插件目录
rm -rf /opt/dsh-web/local-plugins/dsh-web-split
# 3. 重启服务
systemctl restart dsh-web
```

残留物只有一个 localStorage 键 `dsh-split-layout-v3`（`localStorage.removeItem('dsh-split-layout-v3')` 可清；旧的 v1/v2 键会在打开面板时自动清除）。

## 用法

| 操作 | 效果 |
| --- | --- |
| 点侧边栏「分屏」 | 进入/退出分屏面板 |
| **从左侧官方会话列表拖一行到窗格** | 该窗格载入这个会话 |
| **拖到已占用的窗格** | 把这个窗格拆成两半（靠近左右边缘→左右拆，靠近上下边缘→上下拆），新会话进新窗格 |
| **点官方行尾的「放入分屏」按钮** | 载入到当前选中的窗格（先点一下某个窗格即可选中它，选中时有高亮边框） |
| **空窗格里点「新建会话」** | 在当前会话所在工作区建会话；同工作区已有空白会话则直接复用（与官方「新会话」一致），载入该窗格 |
| 拖中间的分隔线 | 只改归它管的那一刀，**每个窗格大小独立可调** |
| 拖窗格标题到另一个窗格 | 落在窗格中间 = 交换两个窗格的会话；落在窗格边缘 = 把这个窗格挪到那一边（贴着画布边缘时占满整列或整行，例如 左侧上下两格 + 右侧一格，把右格拖到左边缘 → 左侧一格满高 + 右侧上下两格） |
| 标题栏「◫」/「⬓」 | 左右拆分 / 上下拆分 |
| 标题栏「⤢」 | 最大化（铺满）/ 再点还原 |
| 标题栏「✕」 | 关闭窗格；父级自动合并，不留缝 |
| 右下角「重置分屏」 | 回到单窗格（装最新会话） |
| **窗格内按鼠标右键** | 打开窗格菜单：复制文字 / 移动现有窗格… / 向右分屏 / 向下分屏 / 缩放（最大化时变「还原」）/ 关闭窗格；目标是输入框时，菜单多一项「粘贴」（插到光标处） |
| Shift + 右键 | 不接管，走浏览器原生菜单（复制图片、检查元素等只能在这里） |

**右键菜单的边界**：窗格子树是插件自己的 DOM，右键菜单由插件接管；窗格**内部**若已有自己的右键处理（工具卡片那种 `preventDefault` 过的），它优先，插件不抢。脚本无法唤起浏览器原生菜单，所以浏览器自己的菜单只能用 Shift+右键（第 2 期已按用户要求去掉「将右键发送到窗格」这一项）。菜单项只做「能不能按」的灰化（数量上限、最后一个窗格、没选中文字），不隐藏，形状稳定。

**没有占位空白窗格**：面板打开时只有 1 个窗格（自动装最新会话），之后每多一个会话才多一个窗格。3 个会话就是 3 个窗格。

## 实现方式（不动 dsh 官方本体）

1. **主面板**：`ctx.slots.inject("main", …)` + `ctx.slots.register({name:"main", key:"split", children:{"split.pane.body":{scope:"session-maybe"}}}, SplitPanel)`（插件管理器页同款）；`ctx.slots.inject("sidebar.panellist", …)` 放侧边栏入口。
2. **复用官方会话列表**：dsh 给每个非空会话行设了 `draggable`，`dragstart` 把 sessionId 写进 `dataTransfer` 的 `text/plain`；插件在自家 canvas 上监听 `dragover`/`drop` 读它。另外用官方行尾座位 `sidebar.workspaces.session.row.action`（ownerProps 带 `sessionId`）加一个按钮，面板没打开时它不渲染，官方列表对其他人完全无感。
3. **分裂树**：`{kind:'split', dir, ratio, a, b}` 二叉树，每个分隔线归自己的 split 节点、有自己的 ratio，所以每个窗格独立可调；递归布局保证边边对齐、永不留缝。拆=把叶子换成 split 节点，关=父 split 塌缩成兄弟节点。分隔线只覆盖自己那一刀的带宽，嵌套时不会互相挡住。
4. **多会话同时渲染**：`ctx.sessions.retain(sessionId, {source:"splitPane", signal})` 拿 `SessionReference`，`<SessionProvider session={ref}>` 发布作用域绑定，`renderFactorySlot("conversation.content", {variant:"embedded"})` 渲染共享对话工厂——与 `@deepseek-ai/dsh-client-ui-subagent` 右侧边栏渲染另一个会话完全同一套官方缝隙。
5. **持久化**：只写自己的 key，80ms 防抖 + `pagehide` 兜底，读入时递归校验（深度上限、类型、ratio 夹取）。

宿主半边（`index.js`）只声明 bundle，不碰会话域。

## 已知边界

- 窗格里只有 chat 视图，没有终端/trajectory 页签（embedded 模式官方只保证过 chat）。
- 官方列表里**空白会话**和**已归档**行都不可拖。空白会话在侧边栏只显示当前选中的那一个（官方设计），所以「新建会话」产生的空白会话平时看不见，发出第一条消息后才出现在列表里。归档会话目前没有进入分屏的入口。
- 行尾按钮是 hover 才显示的（和官方 ⋮ 菜单一致）。
- 没有注册快捷键（`ctx.shortcuts.register` 的默认绑定冲突检查会抛错，风险大于收益）。
- 会话在 Host 侧被删时，对应窗格显示空态（`PaneBoundary` 把渲染失败关在单个窗格里）。
- 未做端到端实测：WebSocket 断连时每个窗格的表现。

## 验证记录

### 2026-10-09 分裂树版（临时实例 3099 + headless Chromium）13/13 通过

零 console 错误、零未捕获异常：

| 项 | 结果 |
| --- | --- |
| 默认形态 | **只有 1 个窗格**且已装会话，无空白占位 |
| 行尾按钮 | 面板关闭时不渲染，打开后出现 |
| 拖到空/占用窗格 | 空→载入；占用→拆分；3 窗格全占用、无空白 |
| 拆分方向 | 窗格中心落下→左右拆；靠近上边缘→上下拆 |
| 独立调节 | 拖内部分隔线，窗外窗格 x/y/w/h 一动不动，只有受影响的两窗格变 |
| 官方行按钮 | 点它把会话装进当前选中窗格（前后会话确实变了） |
| 关闭 / 最大化 / 还原 | 父级合并不留缝 / 铺满 / 恢复 |
| 刷新恢复 | 树结构、会话、全部 ratio 还原 |

### 2026-10-09 分裂树版 · 线上实例（3080，重启后实测）13/13 通过

同样 13/13，零异常。日志 `dsh-split-restart.log`；复验脚本 `verify-split/tree.mjs`，截图 `verify-split/tree-live.png`。

### 历史版本

- **v1 自由摆放**（绝对坐标）：按反馈废弃，问题是会出现占位空白窗格、且官方列表被自建会话条取代。
- **v2 表格网格**（列/行边界数组）：按反馈废弃，问题是同列窗格共享宽度、无法每个独立调节。
- **v3 分裂树**（当前）：每个分隔线独立 ratio + 无占位空白窗格 + 复用官方列表。

期间修掉的真实缺陷：①释放引用后 state 仍持有已释放引用导致重渲染抛 `Session reference ... is released`（渲染期派生 + 失配即弃用）；②拖拽监听器挂 effect 里，一帧内 press+release 会漏掉 pointerup 留下脏拖拽态（改为 pointerdown 同步挂/摘，无位移视为点击）；③最大化丢了 rect 覆盖（分裂树版重现，已修）；④嵌套分隔线横跨整个画布，和祖先分隔线在中心相交被抢走命中（改为只覆盖自己那一刀的带宽）；⑤窗格正中心的像素取整会让拆分方向在 row/col 之间翻覆（加 0.08 边际，中心确定性默认左右拆）。

### 2026-10-10 线上实例（3080，第 3 次重启后实测）

重启日志 `/root/.dsh-home/logs/dsh-split-restart.log`：`HTTP_CODE=401`、journal 无错误行、新 PID 851814。

| 脚本 | 结果 |
| --- | --- |
| tree.mjs | 14/14 通过，零异常、零 console 错误：行按钮只在面板打开时出现、单窗格无占位、拆分方向、独立分隔线、最大化/还原、关闭合并、提示不复发、刷新恢复 |
| move.mjs | 7/7 通过，零异常、零 console 错误：左侧上下两格 + 右侧一格，把右格拖到左边缘 → 左侧一格满高 + 右侧上下两格；拖到中间交换会话；提示 6 秒消失；拖拽时提示切换为换位说明 |

截图：`verify-split/tree-live-v3.png`、`verify-split/move-live-v3.png`。

### 2026-10-10 新建会话 / 去重（临时实例 3099，最新代码）

| 项 | 结果 |
| --- | --- |
| `new.mjs` 新建会话 | 通过：空窗格点「新建会话」→ 会话进该窗格，邻格不动，刷新后还在，零异常 |
| 复用空白会话 | 通过：点击前后同工作区 `sessionIds` 数 86 → 86，新会话是已有空白会话（磁盘 `storages/workspace.json` 核对） |
| 工作区归属 | 通过：新会话与锚点会话同在 `cron-jobs` 工作区（磁盘核对） |
| 去重 | 通过：把已显示的会话拖回自己窗格 → 仍 1 格，不再复制 |
| `tree.mjs` / `move.mjs` | 全部通过（含去重回归） |

更正：之前的 tree 通过不算数。第一次拖放拖的正是已显示的会话，旧代码会拆出两格同一会话，测试被蒙过去。去重修复后这条路径才真正被覆盖。

### 2026-10-10 线上实例（3080，最新一次重启后实测，PID 2608997）

重启日志 `/root/.dsh-home/logs/dsh-split-restart.log`：`HTTP_CODE=401`、journal 无错误行、补丁仍有 `web-split` 两行。

| 脚本 | 结果 |
| --- | --- |
| move.mjs | 7/7 通过，零异常、零 console 错误 |
| tree.mjs（首次） | 失败：`[focusPoint]` 找不到第 3 个窗格。开跑时离重启只隔约 10 秒，推测侧边栏会话列表还没加载完，可拖的会话不够。未能直接复现 |
| tree.mjs（重跑） | 15/15 通过，零异常、零 console 错误：同会话拖放不变、拖官方行拆分、独立分隔线、最大化/还原、关闭合并、提示不复发、刷新恢复 |

线上拖放再确认（纯前端，不写服务器）：拖官方行到窗格，1 格 → 2 格 → 3 格，官方列表原样。

未在线上跑「新建会话」：它会在服务器工作区新建或复用会话，写入真实数据，需先确认。WebSocket 断连仍未测。

### 2026-10-14 窗格右键菜单（隔离临时实例 3099 + headless Chromium 实机点击）
`ctxmenu.mjs` 用真实鼠标事件（CDP `Input.dispatchMouseEvent`，button=right）驱动，条条实测：

| 断言 | 结果 |
| --- | --- |
| 右键开菜单 / 菜单不出画布 / 有分组线 | ✅ |
| 菜单项顺序 = 复制文字、移动现有窗格…、向右分屏、向下分屏、缩放、关闭窗格 | ✅ |
| 非输入框上**没有**粘贴项；输入框上出现粘贴且真的插到光标处 | ✅ |
| 拖选文字后右键（含点在选区外的情况）→ 复制文字可用，且复制内容 == 选中文字 | ✅ |
| 没选中文字 → 复制文字灰化 | ✅ |
| 只剩 1 个窗格 → 缩放灰化；此时点「关闭窗格」= 清空这一格（面板不会被关掉） | ✅ |
| `ctxlimits.mjs` 用菜单连拆到上限：6 个窗格时向右/向下分屏灰化，缩放仍可用 | ✅ |
| Esc 关菜单 | ✅ |
| Shift+右键不接管 | ✅ |
| 菜单真的驱动动作：向右分屏 2→3、缩放铺满、关闭 3→2、移动窗格…接过拖拽手势 | ✅ |
| 页面零 uncaught 异常、零 console error | ✅ |
| 旧回归（tree/move/new/preview/pane-drag/realdnd/maxclose + unit 6336 例）全绿 | ✅ |

实测细节：Chrome 在右键 mousedown 时会清掉 DOM 选中，所以插件在 canvas 的 `mousedown` 捕获阶段先记住选中文字，右键时若选区已被清就用它——「选完文字右键」这条路才稳。剪贴板在无头浏览器里用页面内 stub 观察（`navigator.clipboard.writeText/readText` 被替换），真实剪贴板权限 `Browser.grantPermissions` 也授予成功但未作为断言依据。

截图：`/root/.dsh-home/verify-split/ctxmenu.png`。

### 2026-10-14 第 2 期：双击缩放、去掉「发送右键」、分屏卡顿优化

用户反馈与要求（原话）：菜单里的「将右键发送到窗格」用不到，去掉；「现在运行中特别卡，丢帧严重，看看如何优化」；新增「双击鼠标左键，小窗口自动全屏，再双击自动还原」，双击位置为「空白处或者窗口标题边框」。

**改动**

| 项 | 做法 |
| --- | --- |
| 去掉「将右键发送到窗格」 | 删菜单行、`menuSend`、`passthroughRef` 与两条文案。脚本本来也唤不起浏览器原生右键菜单，需要原生菜单时按 Shift+右键（不接管）。 |
| 双击左键缩放 | 标题栏（标题文字、边框）与空白处双击 → 缩放/还原；内容区在**当前没有选中文字**时同样缩放（双击选词保留原意）。按钮/输入框/菜单等控件、以及已经 `preventDefault` 的事件都不接管。标题栏上按下的那一下会 `preventDefault`（为了开始拖拽窗口），而被取消的 pointerdown 允许吞掉原生 `dblclick`，所以标题栏**自己数这一下**（同一窗格 400 ms 内、位移 ≤6 px 的第二次按下即缩放），内容区才用原生 `dblclick`；这条也被 dblclick.mjs 的三条断言钉住（单击不缩放、隔太久再按不缩放、真双击才缩放）。 |
| 分屏卡顿 | ① 面板原来订阅整个 sessions store，流式 token 每帧重渲染面板**和每个内嵌会话**；改为只订阅 `{ids, phase, meta:{title, running}}`（`sessionsView` + `sameSessionsView` 逐项比较），token 变化不再触发面板渲染。② 窗格改为 `React.memo(Pane, panePropsEqual)`，只有该窗格的可见信息（标题/运行态/激活/缩放/拖放高亮/矩形）变化才重渲染；宿主 kit 传下来的 `SessionProvider`/`renderSlot` 也按身份参与比较，新的 kit 身份不会被 memo 吞掉。③ **分隔线拖动不再改布局**：拖动期间只移动一条 2px ghost 线（直接写 style，不经 React state），松手才提交一次 ratio —— 原来每个 pointermove 都 `setTree`，而提交 ratio 会把这条刀两侧的窗格重排，两侧都是活的会话视图（实测这是掉帧的真凶，见下）；④ canvas 矩形在按下时缓存一次，拖动期间不再调 `getBoundingClientRect`（Profiler 里本插件最大的 native 开销）；⑤ 窗格加 CSS `contain: layout paint`，把重排/重绘限制在窗格盒内。 |
| 审计遗留（第 1 期复审判定，随本期一并修） | F1：零距离 pointermove 不再打断分隔线双击翻转（`DRAG_SLOP`）；F2：`maximizedRef` 不再在 render 期写（改 `useEffect`）；F5：拖拽挂的 window 监听在卸载时清理；`TEXT_INPUT_TYPES` 去掉 `email`（与 `number` 一样没有 selection API）。第 2 期复审判出的两条也修了：`panePropsEqual` 补比 `SessionProvider`/`renderSlot`；标题栏双击不再依赖原生 `dblclick`（改成自己数这一下），并补上「按下后真的拖动过 → 撤掉这次待定的双击」（否则连按两下会把刚拖过的窗格放大）。上线前再审一轮又报出三条（都在本期新代码上，已一并修）：③ ghost 线的两个 margin 现在每次都被显式写全（同一个 DOM 节点跨两次拖动复用，row 的 `margin-top` 曾留在 col 的线上）；④ ghost 预览的 ratio 也按 `MIN_RATIO` 夹取，拖到边缘时幽灵线停在真实落点上，不再「拖到边、松手弹回」；⑤ `contain: layout paint` 会让窗格成为后代的包含块与裁剪盒 —— 这是该属性的固有语义，用 `paneoverlay.mjs` 实测官方浮层（访问模式菜单）是 `position: fixed` 且挂在 body 上、不受影响后才保留。 |

**卡顿到底出在哪（实测量，不是猜）**

`perf-probe.mjs` 在**私有隔离实例**（端口 3098，`mk_verify.py` 建；插件文件冻结、跑前跑后校验 sha）上做同条件 A/B，两臂只差插件文件。掉帧要三个条件同时出现才发生：**4 个窗格 + 有一格在真流式输出 + 正在拖分隔线**。少了任何一个都回到 ~59 fps。

场景 A（4 格，其中一格真实流式 10 秒，不拖）：

| 指标（10 秒窗口） | 第 1 期（线上 77551 B） | 第 2 期（候选 82099 B） |
| --- | --- | --- |
| 主线程 busy | 5236.2 ms | **3318.6 ms** |
| react-dom（shell） | 1143.5 ms | **661.0 ms** |
| 官方会话渲染 | 561.7 ms | **335.0 ms** |
| 本插件代码 `split_plugin_module_exact` | 7.3 ms | **4.0 ms** |
| 掉帧（帧间隔 > 32 ms） | 9 | **5** |
| fps 均值 | 56.66 | **58.35** |

场景 B（4 格 + 一格真流式 + **拖分隔线 4 秒**，长文 prompt 保证拖动全程仍在流式；每臂 3 轮，`run_ghost_ab3.sh`）：

| 指标（拖动窗口） | 第 1 期（线上 77551 B） | 第 2 期（候选，ghost 拖动） |
| --- | --- | --- |
| fps 均值 | 7.63 / 7.58 / 6.77（≈7.3） | **48.64 / 50.18 / 46.04（≈48.3）** |
| 帧间隔 p50 | 116.7 / 133.3 / 150 ms | **16.7 / 16.7 / 16.7 ms** |
| 帧间隔 p95 | 200 / 200 / 233 ms | 16.8 / 33.3 / 50 ms |
| 掉帧（>32 ms）帧数 | 31 / 31 / 28 | 9 / 15 / 26 |
| longtask 条数 | 24 / 20 / 21 | 1 / 1 / 22 |
| 主线程 busy | 4470 / 4508 / 4755 ms | 2160 / 2643 / 3416 ms |
| 本插件代码 | 11.9 / 62.2 / 8.4 ms | 64.7 / 51.2 / 12.9 ms |

结论：**拖动掉帧的真凶不是本插件的 JS，而是「拖动时每帧提交布局」**——提交 ratio 会把这条刀两侧的窗格重排，而两侧各是一份活的会话视图（重内容时每格 8000+ 节点），每帧重排两份会话主线程就满了（掉帧时 3 秒窗忙 3451 ms、其中 program/GC 2952 ms）。改成**拖动期间只画一条 2px ghost 线、松手才提交一次**之后，同机同实例同场景从 ≈7 fps 回到 ≈48 fps（p50 从 117–150 ms 降到 16.7 ms，正好一帧），longtask 20–24 条降到 1 条（三轮里有两轮）；本插件自身耗时始终是个位数毫秒，说明瓶颈在浏览器布局/绘制，不在插件的 JS。场景 A 的收益（收窄订阅 + `React.memo`）是真实的但不是主因：它让流式期间的 busy 降约 37%，对帧率几乎无影响（subagent 的对照：memo 前后 17.80 vs 18.33 fps，噪声级），所以这两项按「整洁改动」保留。

**回归（私有实例 3098，`run_phase2_suite.sh`，逐用例校验插件 sha）**

| 脚本 | 结果 |
| --- | --- |
| unit.mjs（6336 例树逻辑） | ✅ `UNIT_ALL_PASS` |
| view-unit.mjs（12 项订阅比较器） | ✅ `VIEW_UNIT_ALL_PASS`（churnIgnored / titleNoticed / runningNoticed / orderNoticed / phaseNoticed / idsIdentity …） |
| dblclick.mjs（真实左键双击） | ✅ 全项通过：标题栏双击 2→1 且铺满、再双击 1→2 且几何复原；**单击标题栏不缩放**、隔 400 ms 以上再按一次也不缩放；空窗格空白处双击同样缩放/还原；正文**双击选词不缩放**（探针实测 `selLen=2`、未接管）；双击标题栏按钮（左右拆分）只拆不缩放 |
| heedrag.mjs（标题栏拖动后不误缩放） | ✅ 全项通过：标题栏双击缩放/还原照常；按住标题栏拖 40 px 再在同一处快速按下（实测间隔 166 ms，仍在双击窗口内）**不缩放**；紧接着真双击仍然缩放 |
| dragghost.mjs（分隔线 ghost 拖动） | ✅ 全项通过：静止时 ghost 不可见、拖动时可见并跟手（与指针差 ≤6 px）、按住期间窗格尺寸与持久化树都不变、松手才提交并改变窗格宽度；只点一下不拖动不留下任何改动 |
| paneoverlay.mjs（窗格内的官方浮层） | ✅ 全项通过：窗格确实带 `contain: layout paint`；在窗格里的「访问模式」菜单点开后，浮层是 `position: fixed`、**挂在 body 上而不是窗格子树里**、未被窗格裁掉、选项完整可见（截图 `paneoverlay.png`）—— 即 containment 不会吞掉官方浮层 |
| tree / move / new / preview / pane-drag / realdnd / maxclose | ✅ 全部 `allPass` |
| ctxmenu.mjs（右键菜单，删掉发送项后） | ✅ 全项通过，含 `sendRowRemoved` |
| ctxlimits.mjs（1 格灰化 / 6 格上限） | ✅ 全项通过 |
| 页面零 uncaught 异常、零 console error | ✅ |

截图：`/root/.dsh-home/verify-split/v2-dblclick.png`（双击缩放后）、`ctxmenu.png`。

**线上复验（2026-10-15，`http://127.0.0.1:3080`，线上 `client.js` sha256 与已审候选一致 `a383d392a9c7c515` / 91571 B）**

| 脚本 | 结果 |
| --- | --- |
| ctxmenu.mjs | ✅ 全过（含 `sendRowRemoved`：菜单里已经没有「将右键发送到窗格」） |
| dragghost.mjs | ✅ `DRAGGHOST_OK` |
| heedrag.mjs | ✅ `HEEDRAG_OK` |
| paneoverlay.mjs | ✅ `PANE_OVERLAY_OK` |
| dblclick.mjs（`SKIP_TEXT=1`） | ✅ `DBLCLICK_OK`、零失败、零异常、零 console 错误：标题栏双击 2→1 且铺满、再双击 1→2 且几何复原、单击与隔久再按都不缩放、**内容格里的空白/边框点缩放**（第 3 期报障点）、**空窗格提示文字处缩放**、**composer 双击不缩放**、空窗格空白处缩放/还原 |

文字几何类断言（正文拖选、文字处不缩放、残留选区）在线上用 `SKIP_TEXT=1` 跳过：线上有会话在真流式输出，文字在「量矩形」和点击之间移位，这类断言在流式内容上不可复现；同一脚本、同一份插件字节在隔离实例（内容静止）里跑全量、全绿（见上表 dblclick 行）。

踩坑记录（供以后复用）：① 共享的临时实例 3099 同时被性能 A/B 批次反复 `cp` 覆盖插件文件，回归脚本里页面会加载到另一个版本，导致「双击无效」这类假失败；现在回归一律跑在私有实例 3098 上，并在每个用例前比对插件 sha（变了就中止）。② 性能对照必须确认「拖动窗口内流式仍在跑」——早先几轮 SECONDS=8 的对照里，线上那一轮模型已经写完，两臂根本不是同一场景，得出的「无改善」是假的；现在用「写 8000 字以上」的 prompt 并把 `stream` 写进结果。③ 新用例不要插进已有脚本的中间段：会与后段互相干扰（实测把 dblclick.mjs 后段打断）；新行为单独成一个脚本。

### 2026-10-15 第 3 期：修掉「双击边框放大，有些窗口无法放大」

用户反馈（原话）：「双击边框放大，有些窗口无法放大」。服务端日志无异常（客户端错误不进服务端日志），用 `probe-border*.mjs` 在真实页面上重放插件守卫后定案。

| 项 | 内容 |
| --- | --- |
| 真因 | 第 2 期的守卫是 `if (String(window.getSelection()).trim() !== "") return;` —— 判据是**当前有没有选中文字**。而浏览器在 `mousedown`（第二次、`clickCount=2`）时**已经**把光标下的词选中了，`dblclick` 派发时选区已经非空；探针实测每个「没反应」的点 `selLen` 都是 1 或 2。于是：光标下有文字（消息正文、空态提示文字）的窗格一律拒绝，只有真正空白、浏览器找不到词的角落才缩放；而且**任何**残留选区（在别处拖选过一段字）都会让后续所有双击失效。 |
| 修法 | 判据从「有没有选区」换成「这点是不是落在正文文字上」：新增 `textPointAt(x, y)`，用 `document.caretRangeFromPoint(x, y)` 取光标下的字符，再要求这个点落在该字符**自己的行盒**内（`x` 容差 10 px、`y` 容差 2 px）—— 行与行之间的缝、气泡旁边的留白因此都算空白；插件自己的 chrome（标题栏、空态提示 `.dshSplit_empty/.dshSplit_emptySmall`、工具条）不算内容；输入框/`contenteditable`/`user-select:none` 一律算内容、保持原样。`onDoubleClick` 里改为 `if (textPointAt(event.clientX, event.clientY)) return;`。 |
| 效果 | 内容窗格里的空白/内边距/边框（实测含紧贴窗格左边缘 4 px 的点）、空窗格的提示文字处、以及**带着残留选区**时的空白处，双击都缩放；正文文字上仍是「选中这个词、不缩放」，输入框（composer）仍不缩放。 |
| 已知边界 | ① 内容全是文字、没有任何留白的窗格，双击正文不会缩放（这是用户第 2 期定的「双击文字不触发」，此时用双击标题栏）；② 最左窗格最左 1–4 px 属于官方侧栏的拖拽把手（不在分屏画布内，事件到不了窗格），无法接管；③ 双击分隔线仍是既有功能「翻转方向」。 |

回归：`dblclick.mjs` 新增第 6 段（先从工具条「重置分屏」重建干净的 2 格布局，每点前重测矩形）。全部断言通过，其中三条正是旧判据会拒绝的场景 —— `blankPointZooms`（探针实测该点 `selLen=1`）、`emptyHintZooms`（`selLen=2`）、`staleSelectionZooms`（`selLen=1`）；同时 `textSelectsNoZoom`（文字处 `selLen=2` 且未接管）、`editorNoZoom`（composer）、`headerZoomed`、`blankZoomed`、`textNoZoom` 依旧通过，零异常零 console error。

审计（`ocr-ledger review`）：第一轮 0 高危，2 条 MEDIUM + 2 条 LOW 全部落在新写的 `textPointAt` 上 —— ① `document.caretRangeFromPoint` 只有 Chrome/Safari 有，Firefox 只有标准的 `caretPositionFromPoint`；② `getClientRects()` 返回的 `DOMRectList` 只有在 Blink 里可迭代，`for...of` 在别的引擎会抛；③ `catch` 与「空白处」返回同一个值，查询坏掉时会静默地在文字上缩放；④ 可编辑元素选择器与 `editableFrom` 重复、会漂移。四条全修：新增常量 `FIELD_SELECTOR` 供两处复用、`caretPositionFromPoint` + `document.createRange()` 造等价折叠 range 作回退（两者都没有时**保守地按「是文字」处理**，不抢文字语义）、rect 循环改索引式、`catch` 也返回「是文字」（失败关闭）。修完复审 **CLEAN（0 高危 / 0 问题）**。

最终字节：候选与线上一致 —— sha256 `a383d392a9c7c515`、91571 B、mtime 2026-10-15 10:39:20；全量回归 `run_phase2_suite.sh`（私有实例 3098，逐用例校验插件 sha）**SUITE_PASS**：unit + view-unit + tree/move/new/preview/pane-drag/realdnd/maxclose/ctxmenu/ctxlimits/dblclick/dragghost/heedrag/paneoverlay 全部通过。

### 2026-10-15 第 4 期：分屏窗格内容铺满（去掉左右大片空白）

用户反馈（原话）：「分屏状态下，左右不要有空白的内容。」追问后补充：「非分屏状态是可以调动的，竖列分屏状态下，应该自动满屏。」

| 项 | 内容 |
| --- | --- |
| 量到的事实 | 分屏面板本身没有任何留白（面板与画布都从侧栏右缘 280 铺到窗口边 1680，`padding/margin` 全 0，窗格之间也没有空隙）。空白出在窗格**内部**：官方会话视图的 embedded 变体在自己的 `..._embeddedBody` 元素上把 `--dsh-chat-content-width` 定为 `min(calc(100% - 32px), 920px)`、`--dsh-composer-card-max-width` 定为 `min(calc(100% - 16px), 952px)`，而消息列 `.EvIC1a_column{max-width:var(--dsh-chat-content-width);width:100%;margin:0 auto}` 居中——所以一格占满画布（1400px）时消息列只有 920px、左右各空 211.5px，composer 卡 952px 同样空 224px。 |
| 修法 | 在窗格作用域内覆盖这两个变量：`.dshSplit_pane [class*="_embeddedBody"]{--dsh-chat-content-width:calc(100% - 32px);--dsh-composer-card-max-width:calc(100% - 16px)}`（15 行 CSS，含注释）。选择器用 `_embeddedBody` 后缀——CSS Module 的 hash 前缀会随构建变、后缀是稳定的；并且只在 `[data-split-pane]` 子树里生效，普通视图不会命中。窄窗格上官方值本来就是 `calc(100% - 32px)`，所以对窄窗格是 no-op，只影响宽窗格。 |
| 实测（私有实例 3098，`fillwidth.mjs`） | 一格占满画布（1400px）：消息列 **1311px**、左右各 41/48px（改前 920px、左右各 211.5px），composer 卡 **1359px**（改前 952px）；两格各 700px：各自照旧铺满（`≥窗格宽 - 120`）；普通（非分屏）视图消息列仍是 **896px**（用户自己拖的宽度设置），未被改动；零 uncaught 异常、零 console error。截图 `v3-fillwidth.png`（一格）、`v3-fillwidth-2.png`（两格）。 |
| 回归 | 新增 `fillwidth.mjs`（真实页面量矩形 + 断言覆盖只落在窗格内），已并入 `run_phase2_suite.sh` 的用例列表。 |

### 2026-10-15 第 5 期：窗格输入框紧凑化 + 底部信息并入 + 标题栏「放大输入框」

用户反馈（原话）：「占比太大，紧凑一些，输入框高度调低一些。默认一行，用户可以点击放大。最底部的信息 并入到回话框的空白处。」追问后选定：「窗格标题栏加『放大输入框』按钮，点一下切 4 行/1 行」。

| 项 | 内容 |
| --- | --- |
| 量到的事实 | 官方输入区在**一格 857px 高的窗格**里占 **132px**：卡片上内边距 8 + 单行编辑器 36 + 间隔 12 + 工具行 42 = 98，卡片**下方**还有一条 30px 的统计行（轮次/步数 · tok/s · 用量 · 缓存命中 · 上下文%），两者加 4px 底内边距共 132px。工具行左右两组按钮之间空着约 830px（卡片 1359px 宽时），统计行 486px 完全放得下。 |
| 修法 | ① 卡片上内边距 8→4、编辑器与工具行间隔 12→6、编辑器 min-height 36→32（仍是一行）、工具行内边距 `2px 8px 6px`→`0 8px 4px`；② 用**容器查询**（`container-type:inline-size`，阈值 1100px）把统计行从文档流里拿出来，绝对定位到工具行右侧的空白中间（`right:250px`，避开右侧的模型/麦克风/发送按钮）；窄窗格（两列 700px，没有空白中间）自动退回原来的「卡片下方一行」。③ 标题栏新增第 5 个按钮 ⇕：点一下把编辑器抬到 112px（约 4 行），再点回一行；每个窗格独立，状态存 `localStorage` 的 `dsh-split-docktall-v1`（不写进布局树，布局树格式不变），窗格被关掉时自动从集合里剔除。 |
| 实测（私有实例 3098，`dockcompact.mjs`） | 一格 1400px：输入区 132→**84px**（省 48px），编辑器 36→**32px**（一行），统计行 **并入卡片工具行**（`position:absolute`、完整落在卡片内、与任何按钮零重叠、文案仍是「…tok/s · 缓存命中 …% · 12%」）；点 ⇕ → 编辑器 **112px**、输入区变高、统计行仍在原位；再点 → 回到 32px；点标题栏「左右拆分」成两格（各 700px）→ 统计行自动回到卡片下方（`position:static`），输入框仍是一行。16 项断言全过，零 uncaught 异常、零 console error。截图 `v5-dock-compact.png`（一格）与 `v5-dockcompact.png`（两格）。 |
| 回归 | 新增 `dockcompact.mjs`（量矩形 + 真实点击标题栏按钮 + 真实拆分），已并入 `run_phase2_suite.sh` 用例列表。 |

### 2026-10-15 第 6 期：竖列默认比例（双击翻转回到对半分）

用户反馈（原话）：「查看一下,现在数竖列的布局,可以把这个竖列布局改为默认的竖列布局的默认比例吗,比如双击切换,或者初始导入,都用这个双竖列的比例.但是不要影响用户的自由更改」。追问后选定：**照「导入运行中」的比例来**，默认比例 **50 : 50**。

| 项 | 内容 |
| --- | --- |
| 量到的事实 | 新建任何一刀（拆分按钮、右键菜单、拖到窗格边缘、拖一行进来把窗格拆开）都是 `makeSplit(..., ratio ?? 0.5)` ⇒ 本来就是 50/50。**「导入运行中」实测比例**（直接求值 `arrangeSessions`）：2 格 `[col 0.5]`；3 格 `[col 0.5, row 0.5]`；4 格 `[row 0.5, col 0.5, col 0.5]`；5 格 `[row 0.5, col 0.3333, col 0.5, col 0.5]`；6 格 `[row 0.5, col 0.3333, col 0.5, col 0.3333, col 0.5]` —— 所有两分都是 **50/50**，只有「三列一组」用 1/3 等宽。真正会留下怪比例的是**双击翻转**：`rotateSplit` 只改 `dir`，`ratio` 原样带过去，所以一刀被拖歪之后（例：0.384）横竖翻转仍是 0.384。 |
| 修法 | ① 新增唯一真值常量 `DEFAULT_RATIO = 0.5`（`MIN_RATIO` 旁边），`makeSplit` 的默认值与「导入运行中」的 `pair()` 都改用它，三列一组的 `1/3` 保持不变；② `rotateSplit` 翻转这一刀时把 `ratio` 写回 `DEFAULT_RATIO` —— **只碰被翻转的那一刀**，其它刀一律不动；③ 拖动路径完全不变（`setRatioAt` 仍写用户拖出来的值，除了被翻转那一刀，没有任何东西会重置它）；④ 分隔线的 `title` 与面板 hint 补上「并回到默认对半分」，让这条规则在界面上看得见。 |
| 实测 | 单元：`unit.mjs` 新增 300 例翻转（方向翻、`ratio` 回 0.5、两个孩子 id/会话不变、翻转后再拖一次仍是用户值）⇒ `UNIT_ALL_PASS`（session drops 3814 / pane drops 2522 / flips 300）。实机：`rotate.mjs` 新增 3 条断言，把一行拖到 **col 0.384** 后双击那一刀 ⇒ 变 `row` 且 `ratio` **正好 0.5**，另一刀 `row:0.5` 一字未动（`draggedSharePersists` / `flipRestoresDefaultShare` / `otherSplitsUntouched`），并断言 tooltip 文案含「对半分」⇒ `allPass: true`，零异常零 console error。 |
| 取舍（如实说明） | 双击翻转会把**那一刀**用户拖过的比例复位到 50/50（这正是「双击切换用默认比例」的要求）；其余所有刀、以及翻转之后再拖，都保留用户的自由更改。「导入运行中」的三列等宽（1/3）不变，除非手动双击那一刀。 |
| 回归 / 审计 | `rotate` 已并入 `run_phase2_suite.sh`（用例表：tree **rotate** move new preview pane-drag realdnd maxclose ctxmenu ctxlimits dblclick dragghost heedrag paneoverlay fillwidth dockcompact）。私有实例 3098 全量 **SUITE_PASS**（unit + view-unit + 16 个实机用例，候选 sha `7abde53ede6d7aa0` / 96921 B）；`ocr-ledger review` → **CLEAN**（0 高危 0 问题）。 |

### 2026-10-15 第 7 期：分屏里处理过的会话，侧栏不再留「已完成」

用户反馈（要点，m02108）：分屏里已经进入并处理了某个会话，但左侧会话列表那一行还显示未读，要求「分屏处理会话以后，同步会话列表里的状态」。

| 项 | 内容 |
| --- | --- |
| 症状复现 | `unread.mjs`（私有实例 3098，跑的是**线上同款**字节）：把一行拖进窗格 → 在该格底部的输入框里提问 → 全程盯着窗格。实测 trace `[{running:true,dot:"ongoing"},{running:false,dot:"done"}]`，`paneVisible={inViewport:true,hidden:false}` ⇒ 窗格可见 7 秒之后侧栏仍标 `done`。**REPRODUCED，零异常**。 |
| 真因（官方源码实读） | 那个点是 `completionUnread`：`dsh-client-ui-session/lib/client.js:953` 在「running 由真变假」且 `!isMain(sessionId)` 时把会话记成未读；`isMain` 的**唯一判据**是 `retainedBy.mainView > 0`（:971），而 `mainView` 只在主标签页 `replaceMain()` 时产生（`dsh-client-ui-workspace/lib/client.js:1653`）。分屏窗格用的是自己声明的 `splitPane` 源 ⇒ **窗格永远不算 mainView**，所以「在窗格里跑完」一律进未读集合。没有公开的「标记已读」API（`ISessions` 只有 retain/retainInfo/binding/…）。 |
| 修法 | 新增 `MAIN_VIEW_SOURCE = "mainView"` 与 `acknowledgeSeen(sessionId)`：先用 `retainInfo(id).referenceCount === 0` 挡掉「没人持有的会话」（否则会现场物化再退休），然后 `retain(source:"mainView")` → `try { reference.ready.catch(...) } finally { reference.release() }` —— **release 必须在 finally**，泄漏一个 mainView 引用会按 `publishMain`(:914) 的回退规则一直劫持主绑定。借一瞬就够：`retainScope` 结尾会 `publishRetention`（`dsh-api-session-controller/lib/client.js:4078`），`reconcileStatus`(:965) 随即把它从 `completionUnread` 里删掉。 |
| 规则（用户拍板） | ① 会话**在聚焦那一格里跑完** ⇒ 立刻清（从没点过任何格时，未拆分的唯一那格算聚焦格：`lonePane`）；② 在**别的窗格**里跑完 ⇒ 保留 `done` 当「那格跑完了」的提醒；③ **切回分屏面板**（重新挂载 / 面板重新可见 / 画布重新进入视口）⇒ 清掉屏上所有窗格的会话。 |
| 副作用与闸门 | 借 mainView 的一瞬会让主绑定短暂改指，右侧边栏会跟着为那个会话开一次视图（套件实测到 `console.error("Sidebar Session opening failed:")`）。所以第 ③ 条那一遍加 DOM 闸门 `dotState(sessionId)`：行在且显示 `done` 才借（`clear`），行在且没点就什么都不欠（`none`），**行没渲染**（侧栏收起、分组折叠、列表还没画）留进 `pendingSeenRef`，下一次经过或 2 秒轮询再试，清完自动停表 —— 否则那一遍会永远漏掉这些行。 |
| 实测 | `unreadsync.mjs`（三条规则各一遍真提问）：聚焦格 `[{ongoing},{no-dot}]`、非聚焦格 `[{ongoing},{done}]`（提醒保留 ⇒ 也证明那一瞬没被留下）、切走再切回 ⇒ `no-dot`，`failed=[]`。`unreadmain.mjs`（A/B）：候选 `dotAfterFinish="no-dot"` vs 线上第 6 期 `"done"`，且「关掉分屏面板后主区变空白」在**未改动的线上字节上同样出现** ⇒ 不是本期引入。`heedrag.mjs` 加闸门前 `consoleErrors` 有那条、之后为空。 |
| 回归 | 用例表扩到 `… dockcompact unreadsync unreadmain unreadnoop`（19 个实机用例 + unit + view-unit）；私有实例 3098 上 18 项（不含 `unreadnoop`）全量 **SUITE_PASS**，候选 sha `e490c8d145619cad` / 105441 B，`unreadnoop` 随后在同一实例单独跑过（`failed` 空）。`unreadsync.mjs` 第 4 段是本期的关键回归：把侧栏那一行**从 DOM 里摘掉**（模拟分组折叠/侧栏收起）→ 走一遍真实的「切走面板再切回」→ 把行放回去，然后**什么都不做**，等组件自己把点清掉（≤8 秒内清掉才算过，实测 `retryClearsHiddenRow: true`）。`dblclick.mjs` 本期修了三处**测试自身**的漂移：投放优先选标题最长的行（探针留下的「只回复一个字：好」没有可选中的文字）、`settleLayout()` 等 DOM 与存储的树一致且计数稳定、第 4 段的「不缩放」改成读插件是否接管而不是窗格数（前一段的缩放/还原还没落定）。 |
| 审计第 1 轮（针对 sha 5ca5d91c） | ① **HIGH**：`pendingSeenRef` 只 delete 从不 insert（`unknown` 分支漏了 `pending.set`）⇒ 未渲染的行永远补不上，与注释承诺相反；现在 `unknown` 会进 pending，并带「离开窗格即摘除 + 最多等 ~30 秒」的终止条件，轮询由任何一次发现有欠账的 sweep 启动（不只挂载那一次）。② **MEDIUM**：`acknowledgeSeen` 里借来的引用改成 `try { ready.catch(...) } finally { release() }` —— 泄漏的 mainView 引用会按 `publishMain` 的回退规则一直劫持主绑定。 |
| 审计第 2 轮（针对 sha 5ded9e88） | ① 放弃重试的那个分支只 `delete` 不记账：下一遍看见同一个 `unknown` 又把计数从 1 开始 ⇒ 一条永远看不见的行能把定时器反复叫醒；现在放弃的 id 进 `gaveUpSeenRef`，行重新出现（或下一次挂载/切回）才会再试。② 2 秒轮询是唯一不看可见性的触发源（`IntersectionObserver` 只在进入视口时扫、`visibilitychange` 显式判 `document.hidden`）⇒ 现在 `sweep()` 自己把关：页面隐藏或画布不在视口时什么都不读。 |
| 线上怎么验的（如实说明） | `unreadsync` / `unreadmain` 会**真的发提问**，不能在线上跑（会污染用户的真实会话）。线上只跑不写数据的那一套：`ctxmenu`、`dblclick`(SKIP_TEXT=1)、`heedrag`、`dragghost`、`fillwidth`、`dockcompact`，外加专为这条规则写的 `unreadnoop.mjs` —— 它只打开分屏面板，然后断言「**不在窗格里的** `done` 点一个都没被清掉」（挂载那一遍绝不多清）。端到端的「跑完即清 / 别格保留 / 切回即清」是在隔离实例上用真实模型跑出来的。 |
| 审计结论 | `ocr-ledger review /root/split-candidate/dsh-web-split/client.js` 共 3 轮：第 1 轮 1 HIGH + 2 MEDIUM（见上两行），第 2 轮 2 MEDIUM（见「审计第 2 轮」行），第 3 轮 **CLEAN**（0 高危 0 问题，回执 `/root/.claude/logs/ocr-split-audit/2026-10-15T08-23-51-379Z/receipt.json`）。 |

### 2026-10-16 第 8 期：右下角两个按钮移进窗格右键菜单（不再遮挡内容）

用户反馈（要点，m02878）：「分屏页面右下角有两个按钮，给隐藏了，放到分屏的窗口标题右键菜单上吧。不要在底下遮挡」。

| 项 | 内容 |
| --- | --- |
| 改前 | `.dshSplit_tools` 浮在画布右下角（`position:absolute; inset-inline-end:10px; bottom:10px; z-index:7`），里面是「导入运行中 (N)」「重置分屏」两个按钮 —— 它会盖住右下窗格底部（输入框/统计行）那一块 |
| 改法 | 工具条只保留瞬时提示 `note`（仍是 `pointer-events:none`，不再放按钮）；两个动作改成**窗格右键菜单**里的行，行序现在是：复制文字 / 粘贴（仅输入框）/ — / 移动现有窗格… / 向右分屏 / 向下分屏 / 缩放（最大化时显示「还原」）/ — / **导入运行中 (N)**（N=0 时禁用，title=`importTitle`）/ **重置分屏** / — / 关闭窗格 |
| 连带改动（测试） | 浮按钮没了 ⇒ `dblclick.mjs` / `unreadmain.mjs` / `unreadsync.mjs` 里「重置分屏」改成先派发合成 `contextmenu` 打开窗格菜单、再点那一行；新增 `toolsmenu.mjs` 断言：工具条无按钮（`toolsBarHasNoButtons`）、菜单含两项、导入项禁用状态与解析出的计数一致、点「重置分屏」后回到 1 格 |
| 测试脚手架修复（与插件无关，但影响结论可信度） | `dblclick.mjs` 的正文行搜索改成**跨所有窗格**找（原先只看一个窗格）并把最小长度 20→12 字符；若布局里一个带会话的窗格都没有，先拖一行进去 —— 此前空布局会让 `textLineFound` / `textLineOnCleanLayout` 假失败。残留选区那一段改用**真实双击**造选区（程序化 Range 在本实例上选不出内容），选不出时记 `staleSelectionSkipped` 而不是判失败 |
| 实测 | `toolsmenu.mjs` 全过（`importRowInMenu` / `importRowDisabledMatchesCount` / `resetRowInMenu` / `resetRowClickable` / `menuResetToOnePane`）；全量套件 20 个实机用例 + unit + view-unit 全绿（私有实例 3098，pin 候选 `343cce837a786fb4` / 105904 B） |
| 审计 | `ocr-ledger review /root/split-candidate/dsh-web-split/client.js` → **CLEAN**（0 高危 0 问题，回执 `/root/.claude/logs/ocr-split-audit/2026-10-16T03-34-35-946Z/`） |
| 线上复验（3080，部署后） | `toolsmenu` / `ctxmenu` / `dblclick`（`SKIP_TEXT=1`）全部 `exit=0 failed=-`；线上实拍：右键菜单里是 复制文字 / 移动现有窗格… / 向右分屏 / 向下分屏 / 缩放 / **导入运行中 (4)** / **重置分屏** / 关闭窗格，画布右下角不再有浮按钮（`client.js` sha256 前缀 `343cce837a786fb4` / 105904 B，回退用 `/root/.dsh-home/verify-split/client.live-before-p8-20261016-121303.js`） |
| 不遮挡的验证方式 | `toolsmenu.mjs` 直接断言 `.dshSplit_tools` 里 `button` 数为 0；菜单是绝对定位的浮层、只在右键后出现，位置由 `useLayoutEffect` 夹在画布内 |
### 2026-10-17 第 9 期：分屏里能打开文件、能看到子任务/子代理状态

用户反馈（附截图）：分屏状态下点文件报「无法打开文件 / sidebarRight: no session surface is mounted」，并且看不到子任务子代理状态。

| 项 | 内容 |
| --- | --- |
| 真因 | 分屏原本注册进 `main` 槽的**全局面板**（`key: "split"`，与「插件」「定时任务」同类）。官方只在**内置会话面板激活**时（`layout.panelInfo.activePanelId === null`）提供会话上下文：① 右侧栏 `RightbarRoot` 直接判 `activePanelId === null`（`dsh-client-ui-sidebar-right/lib/client.js:1601`）；② 同步 effect 也只在同一条件下把「屏上会话」交给控制器（`show(activePanelId === null ? selected?.sessionId : void 0)`，:4837），于是 `sidebarRight.require()`（:2482）抛 `no session surface is mounted`；③ 头部槽位（`conversation.session.header.lineage`＝子代理血缘/状态）只随会话面板渲染。分屏面板一激活，这三样一起消失。 |
| 走过的弯路（如实记） | 先按「分屏＝会话里的一个视图」实现：注册 `conversation.view`（id `split`）+ 侧栏入口改成「打开会话 + 切视图」。视图确实挂上了（官方标签条出现「对话 / 分屏」），但**窗格渲染不出会话**：视图渲染在 `conversation.content` 工厂内部，而窗格要渲染的正是这个工厂，官方 `FactoryAncestryContext` 守卫直接抛 `recursive render of factory 'conversation.content'`（`dsh-client-ui-renderer/lib/client.js:1070`）；改用普通槽位 `conversation.session` 也不行——`renderSlot` 按注册条目绑定，只能渲染自己声明的子槽位（:346），而 `conversation.content` 是全库唯一的「整段会话」工厂（工厂名单里只有 6 个名字）。结论：**网格与「会话视图」天然不兼容**，此路放弃。 |
| 最终做法 | 改用官方为这种场景准备的口子 **`shell.overlay`**——槽位目录原文：「For a surface of your own that floats over the whole app, register into `shell.overlay` instead（list 槽位：叠加式，条目自己开启 pointer-events 之前点击穿透）」。网格改成**浮在会话列上的面**：底层会话面板保持激活 ⇒ 右侧栏、头部血缘槽位、屏上会话都在。侧栏「分屏」入口仍是一个面板，挂载后立刻 `uiWorkspace.openSession(会话)` + 浮层置位（`openSession` 内部会 `selectPanel(null)` 把会话列 reveal 出来），面板自己退场；网格上方一条细条里放「退出分屏」回到普通会话。窗格仍走官方 `conversation.content` 工厂（浮层不在该工厂子树内 ⇒ 不触发递归守卫）。 |
| 会话上下文跟随（三处克制，都是被实测逼出来的） | ① 只在**窗格正文**里按下鼠标才把官方会话切到那一格（点标题栏按钮不切——否则「双击拆分按钮」的第二下会因为会话列重排而落空，实测 `controlSplitTwice` 由红转绿）；② 在**输入框/可编辑区**里操作时绝不切（切会话会重新 retain 主视图、把正在提交的输入框子树掀掉，实测 `unreadsync` 第一条用例因此丢失提交，`sawRunning=false`）；③ 切换是 **350ms trailing debounce**，且目标会话若已经是屏上会话就什么都不做。 |
| 实测（`ctxsplit.mjs`，新脚本） | 侧栏点「分屏」⇒ 浮层出现且**正好覆盖会话滚动区**（与 `[data-conversation-scroll]` 矩形误差 ≤2px）、`data-split-mode="overlay"`、会话面板仍是激活面板（头部血缘槽位在）、每个窗格渲染出真会话（`[data-conversation-content]` + 会话 id）；**右侧栏在分屏下能打开**（`rightSidebarOpensInSplitMode`，旧版这里恒为 0 宽）；点「退出分屏」浮层消失、普通会话回来；全程零异常零 console error。另有一次手工端到端（`probe-view.mjs`）：点窗格里工具行的文件链接 ⇒ 右侧栏打开（756px）并显示该文件内容（不再是报错弹窗），浮层自动缩到 642px 让位。 |
| 线上复验（3080，部署后） | `ctxsplit`（线上这次走的是**窗格文件链接**路径：点窗格里工具行的 `~/xiangmudata_sync/octo-shift/octo_shift_gateway.py` ⇒ 右侧栏打开并显示该文件内容，`rightSidebarOpened` / `rightSidebarShowsTheFile` 都真）、`toolsmenu`、`dblclick`（`SKIP_TEXT=1`）全部 `exit=0`；线上 `client.js` sha256 前缀 `82625d6561241632` / 120446 B，回退用 `/root/.dsh-home/verify-split/client.live-before-p9-20261017-193000.js`（第 8 期 `343cce837a786fb4`） |
| 回归 | 用例表扩到 21 项（新增 `ctxsplit`）；全量套件在候选 `82625d6561241632` 上跑过，**除三项内容态抖动外全绿**：`dblclick` 的正文选词段、`unreadsync`/`unreadmain` 的「投放后那个窗格显示该会话」断言——这三项单跑均绿（各验过 2 次以上），抖动来自长时间套件里会话内容与面板布局的状态漂移（`unreadmain` 那条断言的失败在**第 8 期字节上同样复现**，已 A/B 确认不是本期引入）。审计 `ocr-ledger review` → **CLEAN**（0 高危 0 问题，回执 `/root/.claude/logs/ocr-split-audit/2026-10-17T11-23-30-290Z/receipt.json`）。 |
| 已知取舍 | ① 会话切换的克制（见上一行）意味着「聚焦窗格 ⇒ 右侧栏跟着换会话」只在点窗格正文时发生，点标题栏按钮不换；② **浮层上不再有任何自己的横条或按钮**（2026-10-19 用户要求去掉）：进出分屏都靠侧栏「分屏」入口——点一次升起网格，再点一次交还会话列（开关式）；③ 浮层只盖会话滚动区，官方头部（标题/子代理血缘/视图标签）与右侧栏都露在外面。 |

#### 2026-10-19 跟进：去掉浮层顶部那条与「退出分屏」按钮

| 项 | 内容 |
| --- | --- |
| 需求 | 用户原话「不需要顶部的那个退出分屏按钮，也不需要那一行」。 |
| 改法 | 删掉 `.dshSplit_overlayBar` 与 `.dshSplit_exitBtn`（含 CSS 与两条 `exitOverlay` 文案）；浮层重新变成「正好盖住会话滚动区」的一整块。进出分屏改成**开关**：侧栏「分屏」入口的交接逻辑先看浮层是否已经在（`runtime.overlayOn()`）——在就关掉并 `selectPanel(null)` 把会话列交还，不在就照原样升起。 |
| 实测 | `ctxsplit.mjs` 改为用同一个侧栏入口退出（`noStripAboveTheGrid` 断言浮层里不再有那个按钮）；私有实例与线上各跑一遍都 `exit=0`：浮层覆盖会话滚动区、窗格里点文件 ⇒ 右侧栏显示该文件、再点侧栏入口 ⇒ 浮层消失、普通会话回来，零异常零 console error。候选 `a6dc8602a17049b7` / 119934 B；审计 CLEAN（回执 `/root/.claude/logs/ocr-split-audit/2026-10-19T02-52-03-620Z/receipt.json`）；回退用 `/root/.dsh-home/verify-split/client.live-before-p9b-20261019-105952.js`（第 9 期 `82625d6561241632`）。 |

#### 2026-10-19 第二条跟进：点文件/图片不再闪屏，退出分屏多一个固定入口

| 项 | 内容 |
| --- | --- |
| 现象 | 分屏里点会话中的文件或图片：预览不显示、屏幕出现闪现；闪现之后切换会话，再点侧栏「分屏」退不出分屏。 |
| 真因 | 浮层定位是「每 500ms 量一次会话列」：上一版里量不到就把整块 `visibility:hidden`。而点文件/图片会打开右侧栏，官方界面这时在整个容器上挂一层带 `backdrop-filter: blur()` 的遮罩，量取在那一刻落空 ⇒ 网格消失又回来（闪屏）；连点时反复隐藏，`splitOverlay` 状态与面板状态错开，而侧栏入口那时**已经不含任何退出按钮**（用户要求去掉顶部那条），于是没有退路。 |
| 修法 | ① 量不到时**不再立刻隐藏**：连续 1.5 秒都量不到才隐藏并复位（否则「用一闪换一个卡死」）；量到且四个数值没变就完全不碰 style（不写 style 就不触发布局）；② 窗格右键菜单在浮层模式下多一行「退出分屏」（`exitOverlay`）——去掉顶部条之后这是**固定的**退出口，不依赖侧栏入口状态；侧栏「分屏」仍是进出开关。 |
| 实测 | 复现脚本（窗格里发一句「读取 /etc/hostname」，等出文件链接再点）：`probe-repro2.mjs` 全程 `overlayVisible=visible`、窗格文字长度单调递增（394→445，记录一直在）、右侧栏 0→756 并显示 `/etc/hostname` 内容，零异常零 warning。`ctxsplit.mjs` 新增 `exitRowInPaneMenu` / `menuExitLeavesSplitMode`（菜单里点「退出分屏」后浮层与网格都消失）并保持 `noStripAboveTheGrid`，私有实例 `exit=0`。 |
| 审计 | 这一版先被审查员拦了一条 HIGH（「永不隐藏 ⇒ 会话列真没了会留下挡住点击的网格」），按建议改成 1.5 秒窗口内不隐藏、超时才隐藏并复位；复审 **CLEAN**（回执 `/root/.claude/logs/ocr-split-audit/2026-10-19T03-17-52-714Z/receipt.json`）。 |

#### 2026-10-19 第三条跟进：文件链接一律先保证「那个会话在屏上」再打开

| 项 | 内容 |
| --- | --- |
| 现象 | 分屏里点会话中的文件仍然弹「无法打开文件 / sidebarRight: no session surface is mounted」。 |
| 真因 | 文件链接走官方右侧栏的 `openResource` → `require()`：它要的是「屏上会话」+「那个会话自己已被 adopt 的 surface store」。分屏浮层只保证**列**是会话列，屏上会话本身会随会话切换、焦点跟随、引用释放而短暂变空；变空的那一刻点链接就抛错。 |
| 修法 | 分屏里所有 `fileLink` 点击先被我们接管：① 取该链接所在窗格的会话；② `openOverlay(会话)` 交给外壳（揭示该会话 + 浮层就位）；③ **轮询等它真的成为屏上会话**（每 80ms、最多 3 秒）再在原窗格内重新点同一个链接。没有会话 id、没有交接手段时**不拦截**，交回官方路径（不吞点击）；重放定时器挂在 ref 上并在卸载时清理；同一时间只挂一个重放。 |
| 防串台 | 重放**限定在原窗格内**按路径文本匹配（两个窗格显示同名文件不会串到别的窗格），原链接节点还在就直接用它。 |
| 实测 | 线上：分屏里点窗格中的文件链接 ⇒ 右侧栏 756px 显示该文件内容、无弹窗；点图片 ⇒ 灯箱正常打开；`ctxsplit`（线上这次走的正是「窗格文件链接」路径，且先往窗格里装了第二个会话）/ `toolsmenu` / `dblclick(SKIP_TEXT=1)` 全 `exit=0`。私有实例：`probe-repro2.mjs`（窗格发「读取 /etc/hostname」→ 点链接）右侧栏 756 显示内容，零异常零 warning。 |
| 审计 | 这一版连拦两条 HIGH（①「按文本全局重放，同名文件会打开错的那份」②「固定 400ms 重放 + 无条件吞点击，没就绪仍会抛、定时器不清理」），两条都按建议改：限定窗格 + 轮询就绪 + 定时器清理 + 无法交接就不拦；复审 **CLEAN**（回执 `/root/.claude/logs/ocr-split-audit/2026-10-19T03-41-34-299Z/receipt.json`）。 |
| 部署 | 线上 `client.js` = `c26310872d3330c5` / 125043 B；回退用 `/root/.dsh-home/verify-split/client.live-before-p9d-20261019-114258.js`（上一版 `ae8bfe6023ca1b12`）。 |

#### 2026-10-19 第四条跟进：文件预览「有几率打不开 / 一闪而过」——找到并修掉

| 项 | 内容 |
| --- | --- |
| 复现（线上压力脚本 `probe-stress-file.mjs`，同一路径连点 5 次×两轮） | 上一版：**窗格会话 = 屏上会话时 5/5 能开**；把**另一个会话**装进窗格（窗格会话 ≠ 屏上会话）后 **0/5 打得开**——右键点下去什么都不发生、也不弹错（点击被我们的守卫吞掉了，重放没等对时机）。这与用户说的「有几率打不开、一闪而过」一致：预览先打开、随后会因为切换会话时右侧栏重建视图而被连带关掉。 |
| 真因 | ① 交接（把窗格会话揭示到会话列）会让右侧栏把该会话的视图**重建一次**；在重建落定之前打开的预览页会被一起关掉 ⇒「一闪而过」。② 上一版守卫的重放等的是「屏上会话 id 相等」，而右侧栏视图的重建在 id 相等之后还会继续一小会儿，于是重放常常打在「还没落定」的窗口里，或者干脆找不到候选节点 ⇒ 静默失败。③ 而「窗格会话本来就是屏上会话」这个最常见的情况根本不需要交接，却被无谓地卷进交接流程。 |
| 修法 | ① **不需要就不交接**：窗格会话已经等于屏上会话时直接放行官方路径（不 preventDefault、不 churn）；② 需要交接时，等「屏上会话 === 目标会话」**并且稳定 250ms** 再点；③ 点完**验证预览是否真的出现**（右侧栏里出现提到该文件名的页面），没出现就重试，最多 3 次，每次间隔 700ms；④ 重放始终限定在**原窗格**内按路径文本找节点（同名文件不串台），原节点还在就直接用它。 |
| 实测 | 线上部署后同一压力脚本：**10/10 全开**（两轮各 5 次，含之前 0/5 的「窗格会话 ≠ 屏上会话」场景，`rbTabs` 从 0→1 稳定），零异常零 console error。私有实例同样 10/10。线上 `ctxsplit`（窗格文件链接路径）/`toolsmenu`/`dblclick(SKIP_TEXT=1)` 全 `exit=0`。 |
| 审计 | 复审 **CLEAN**（回执 `/root/.claude/logs/ocr-split-audit/2026-10-19T04-04-02-351Z/receipt.json`）。 |
| 部署 | 线上 `client.js` = `c7b91e9d9a512334` / 126388 B；回退用 `/root/.dsh-home/verify-split/client.live-before-p9e-20261019-120514.js`（上一版 `c26310872d3330c5`）。 |

#### 2026-10-19 第五条跟进（用户定的新逻辑）：在分屏里打开文档/图片 ⇒ 退出分屏、走官方会话模式

| 项 | 内容 |
| --- | --- |
| 需求 | 用户原话：「分屏状态下打开文档或者图片这些，改逻辑吧，直接退出分屏，切换到官方回话模式。」 |
| 做法 | 分屏里所有「文件链接 / 图片按钮」的点击被接管：① 先 `leaveSplit(会话)` 把网格撤掉、把该窗格会话揭示到官方会话列（撤不掉就不拦，交回官方路径）；② **直接从链接自带的 `title`（完整路径）构造 `dsh-resource://file/session/<会话>/<路径>` 并调 `sidebarRight.openResourceIn(...)`** 打开——这是主路径，不依赖任何点击重放；③ 打开后校验右侧栏出现了含该文件名的页面；没出现则回退到「在官方会话里按 `title` 精确找到那个链接并点一次」（最多等到 2.5 秒），再不行只打一条 warn。 |
| 为什么这次能稳 | ① 身份用 `title` 里的**完整路径**，两个窗格同名文件不会串（上一版按显示文本匹配，正是复审指出的串台点）；② 主路径是**直接开地址**，不走点击重放，因此不受官方会话虚拟化（老条目不在 DOM 里）影响——这正是上一版「有几率打不开」的根因；③ 重放只做兜底，且等右侧栏真出现该文件才算成功。 |
| 实测 | 线上压力脚本 `probe-exit-open.mjs`（同一路径连点 4 次）：**4/4 都是「退出分屏 + 右侧栏打开该文件」**（`leftSplit=true`、`rbW=756`、右侧栏文本含 `bge-compare.py` 内容），零异常零 console error。私有实例同样 4/4；线上 `ctxsplit` / `toolsmenu` / `dblclick(SKIP_TEXT=1)` 全 `exit=0`。 |
| 审计 | 这版先被连拦 3 条 HIGH（①点击被吞掉却打不开 ②按显示文本匹配会串台 ③单飞定时器丢弃前一次重放且 `leaveSplit` 忽略失败），逐条改：主路径改直接开地址、身份改 `title` 全路径、`leaveSplit` 失败就不拦、单飞期间忽略新点击并在超时后 warn；复审 **CLEAN**（回执 `/root/.claude/logs/ocr-split-audit/2026-10-19T05-00-42-050Z/receipt.json`）。 |
| 部署 | 线上 `client.js` = `d3e4077c117815fd` / 128431 B；回退用 `/root/.dsh-home/verify-split/client.live-before-p9f-20261019-130157.js`（上一版 `c7b91e9d9a512334`）。 |

#### 2026-10-19 第六条跟进：点侧栏会话列表不再把分屏顶掉；分屏只由「退出分屏」关

| 项 | 内容 |
| --- | --- |
| 现象 | 用户（隐身模式复现，排除缓存）点击左侧会话列表后，分屏直接没了；并且再也退不回/进不来那种“看起来退出了但状态还在”的状态。 |
| 真因 | 两处叠加：① 浮层定位里上一版加的「量不到会话列就 1.5 秒后隐藏」——点侧栏会话会切换会话，会话列在切换瞬间量不到，浮层被隐藏；看着就是“分屏退出”，而 `splitOverlay` 其实还是 true，于是下一次点「分屏」走的是**开关**分支（再关一次），表现成怎么点都不对。② 侧栏「分屏」入口被我做成了开关（同一次点击里判断 `overlayOn()` 就关掉）；而切换会话时官方会把会话列 reveal 出来（`selectPanel(null)`），很容易和这个开关搅在一起。 |
| 修法 | ① 量不到会话列时**不再隐藏**：宽限到 10 秒仍然量不到才隐藏（正常切换/弹层/重建都在宽限内，网格原地不动）；量到且数值没变就完全不碰 style。② 侧栏「分屏」**只负责进入**分屏（不再做开关）；退出统一走窗格右键菜单里的「退出分屏」——按钮/横条按你之前的要求已经去掉，菜单行是唯一固定出口。 |
| 实测 | 线上（隐身浏览器同款冷缓存）：进分屏后点左侧会话列表 ⇒ 4 秒内 10 次采样 `split=true`、浮层宽度恒为 1398（不再消失）。私有实例同一脚本同样保持。`probe-exit-open.mjs`（分屏里点文件）依旧 **2/2：退出分屏 + 右侧栏打开文件**；`ctxsplit.mjs` 全绿（退出改走菜单行）。 |
| 审计 | 复审 **CLEAN**（回执 `/root/.claude/logs/ocr-split-audit/2026-10-19T05-55-14-607Z/receipt.json`）。 |
| 部署 | 线上 `client.js` = `89ce550a1292bf89` / 128604 B；回退用 `/root/.dsh-home/verify-split/client.live-before-p9g-20261019-135610.js`（上一版 `d3e4077c117815fd`）。另：插件包是 `immutable` 一年强缓存、`rev` 只在 dsh-web 启动时计算，所以这一版安排了一次安全重启来刷新 `rev`（否则老页面永远拿旧包）。 |
