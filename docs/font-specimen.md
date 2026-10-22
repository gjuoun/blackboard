---
title: 字体样张 — LiBianSans + LiBianRecursive
repo: blackboard
status: draft
updated: 2026-10-21
---

# 字体样张：LiBianSans + LiBianRecursive

这一页是给 Blackboard 用的字体测试页：正文走比例家族 `LiBianSans`，代码块和行内代码走等宽家族
`LiBianRecursive`。两套字共用同一副 CJK 面（方正隶变），所以终端里和文档里的汉字是同一个笔意。

## 1. 正文：中英混排、行内代码与强调

编译产物不是「打包好的 CSS + compiled JS + 一个 HTML」，而是一个 `app.js`（React + 渲染器 +
运行时都在里面）加一个二进制的 `app.pak`（样式、字体图集、图片）。TSX 走 **MicroTS** 编到 JS，
交给 **QuickJS** 执行；Tailwind 的类名在构建期换成二进制样式表，运行时只查表。

排版上要注意的地方：中文的行高不能套拉丁的 1.5，隶变的横画外拓，1.78 才不粘；中英混排时
`className`、`web-compat`、`app.pak` 这类标识符必须留在等宽家族里，比例字体会把 `i` 和 `l` 挤到一起。

## 2. 表格

| 你说的 | 实际情况 |
|---|---|
| 编译出来是打包好的 CSS、compiled JS、JSX，再加一个 HTML | 只对 `web-compat` 那条。没有 HTML，也没有 CSS 文件，只有 `app.js` 和 `app.pak` |
| PocketJS 原生支持 `Compiled TypeScript with React` | TSX 先被 MicroTS 编成 JS，再由 QuickJS 执行，React 的渲染器是打包进去的那一份 |
| 是个 meta framework | 不是。没有 SSR、没有文件路由，构建产物就是两个文件 |

## 3. 列表

- **构建** — `bun run build` 产出 `app.js`（约 180 KB）与 `app.pak`（含样式表与图集）
- **运行时** — QuickJS 解析并执行 `app.js`，宿主只提供 surface 与输入事件
- **样式** — Tailwind 类名在构建期折叠成二进制样式表，运行时按 id 查表，不做字符串匹配
- **调试** — `POCKET_DEBUG=1` 打开后把每次 surface 重绘的脏矩形打到 stderr

1. 先确认 `pocket.json` 里的 `target` 与宿主一致
2. 再跑 `bun run build --watch`，产物落在 `.pocket-build/`
3. 最后 `pocket push` 推到设备

## 4. 代码

```ts
// app.tsx — 一个最小的 PocketJS 界面：状态、列表与事件
import { render, surface, useSignal } from "pocketjs";
import { button, column, text } from "pocketjs/widgets";

export function counter() {
  const count = useSignal(0);
  const label = () => `点了 ${count.value} 次`;   // 中英混排，注意字距

  return column({ gap: 12 }, [
    text(label(), { size: 22, weight: 600 }),
    button("加一", { onPress: () => count.value++ }),
    button("归零", { onPress: () => (count.value = 0) }),
  ]);
}

render(surface(320, 240), counter);
```

```bash
bun run build            # -> .pocket-build/app.js + app.pak
pocket push --target 3ds # 推到宿主，失败时回落到本地预览
```

> 构建产物是 `app.js` + `app.pak` 两个文件，没有 HTML、没有 CSS 文件；
> 这也是「为什么它不像 web 项目」的全部原因。

## 5. 长段落换行

这一段刻意写长，用来看行宽与断行：设备上的 surface 尺寸一旦小于设计稿，PocketJS 不会重排整棵树，
而是按约束把 `column` 里的子节点重新量一遍，必要时把 `text` 的换行点前移一个标点，保证行首不出现
逗号与句号——这也是为什么样式表里要带一份 CJK 的禁则表，而不是交给浏览器的 `line-break: strict`。
数字与单位混排时（`320 px`、`1.78em`、`12 °C`）要留一个细空格，否则隶变的横画会顶到下一列。
