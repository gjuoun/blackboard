# code-comments

**问题**：Local PR 的 snippet 代码里能不能直接 comment（GitHub PR review 式行内评论）？

**答案方向**：能。行锚点（`path + L区间`，删行 `Lold`）作为第二种评论锚类型，与文内引语锚并存于同一个
comments.json / 同一套 CLI；线程服务端渲染在锚行下方，行 hover 出 `+` 是唯一新增客户端入口。

## 状态（hash 路由，可组合）

| 路由 | 显示什么 |
|---|---|
| `#thread`（默认） | L12 行内线程：jun 评论 + agent 回复，锚行 primary 左标 + 计数 |
| `#compose` | L13 行内 composer（引用行原文 + textarea + Cancel/Comment） |
| `#hover` | 无 hover 截图用的 `+` 入口展示（L13 右缘常亮） |
| `#tab` | Comments tab：代码评论带 `residency.ts:L12` 链接 chip，与文内评论同列表同读序 |
| `#orphan` | 行漂移后：warn 徽标 + `L12 ↦ 现 L14`，线程降级不猜位置 |

调 paper/night 看双 palette 下的绿底/主色标可读性。
