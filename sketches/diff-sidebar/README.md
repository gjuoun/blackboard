# Sketch: diff-sidebar（JW-319）

**Question it answers** — JW-319 的三个设计分叉长什么样：

1. **Diff base** — `merge-base(main) → worktree`（chip 显示 `base main @ <sha>`，含 tracked/staged/untracked）
2. **侧栏形态（v2，Jun 反馈「三个侧栏太拥挤」后改）** — 评论与 Local PR **共用一根右栏**，栏顶两个 tab 切换（默认形态）；备选是抽屉浮层（bar 上「右栏切换 / 抽屉」）。TOC 保留但 bar 左侧图标可一键收起。
3. **链接语法** — `[text](file:<path>:L<a>-<b>)`；`file:L330-240` 省路径=文档自身、倒序自动规范化

## What to look at

- 正文里的 `file:` 链接（虚线主色边框+虚线下划线）→ 点击后右栏自动切到 Local PR tab、选中该文件、黄色边带标出 L240-L330 区间
- 行级 green/red：背景由 `color-mix(success/destructive)` 派生，paper/night 共用同一语义 token（右上角切 palette 验证）
- 文件列表：状态徽章 M/A/D + 增删数 + stat bar；点文件进 diff，`‹ 10 files` 返回
- mock 只完整渲染 `lib/markdown.ts` 与 `lib/diff-index.ts` 两份 diff，其余文件是占位（build 轮接真 git diff）

## Conventions

- token/palette/font 层直接复用 `../reading-config/mock.css`（与 app/themes.css + fonts.css 同值）
- 深链：`#night` `#plain` `#drawer` `#list`（列表态不自动选中）`#comments`（切到评论 tab）`#grammar`（滚到链接语法段落）`#notoc`（收起 TOC）；组合用 `-` 连，如 `#night-drawer`
- Sketch only：不 import `app/` 任何东西，不出 sketches 目录

## 视觉 QA 定下的 build 约束（2026-10-28，vision QA 反馈后已修）

1. **file: 链接必须一眼可辨为链接**——默认态虚线主色边框+虚线下划线，激活态（当前 diff 正在展示的那条）实线边框 + primary-soft 底 + 实线下划线。只做灰底 chip 会被判成不可点击（QA 原话）。
2. **新增行内的 destructive 色 token 换 primary**（`.dl.add .tk-t`）——红 token 落绿底对比度不够；这是 palette 级修法，Step 6 的 token 测试要覆盖。
3. **两栏 tab 的选中态要够醒目**——QA 认为仅靠填充/边框差异偏细；build 轮在 active tab 上加一条 primary 顶线更稳。
4. **右栏文件路径**——360px 栏宽下 `docs/jw-319-diff-sidebar.md` 会被省略号截断（QA nit）；build 轮用中间截断或 hover title。
5. 遗留 nit（不阻塞 mock）：diff 折续行应从代码列起排（悬挂缩进），build 轮实现时带上。QB Mono 无 italic 面，等宽区内禁用 italic。