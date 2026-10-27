# 路径链接测试

行内代码里的相对路径：`lib/markdown.ts:228`

`~/` 路径：`~/code/gjuoun/blackboard/app/page.tsx`

绝对路径：`/Users/junguo/code/gjuoun/blackboard/package.json`

不存在的文件：`lib/does-not-exist.ts`

越界尝试：`../../../../etc/passwd`

散文里的裸路径（不应链接）：见 lib/markdown.ts 第 228 行。

围栏里（不应链接）：

```ts
// lib/markdown.ts:228
const x = 1;
```
