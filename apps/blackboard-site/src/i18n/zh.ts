import type { Dict } from "./types.ts";

export const zh: Dict = {
  locale: "zh",
  lang: "zh-CN",
  title: "Blackboard — 和你的编程 agent 一起评审 markdown",
  description:
    "把方案评审搬回文档里：划选正文写批注，编程 agent 用同一条 CLI 接话，改到定稿。本地运行，MIT 开源。",
  languageName: "中文",
  switcher: { href: "/", label: "English", lang: "en" },
  hero: {
    tagline: "把方案评审，搬回文档里。",
    who: "划一句，批一句；你的 agent 用同一条 CLI 接话，改到定稿。",
    cta: "开始使用",
    github: "GitHub ↗",
    shot: {
      src: "/assets/doc-zh.png",
      alt: "Blackboard 文档页：一份中文方案，正文有高亮段落，左侧目录，mermaid 示意图，右侧评论面板里 agent 提问、人回复",
      width: 1440,
      height: 1160,
      caption: "文档页：划一段文字、写一句批注；agent 在 shell 里回话，改动实时上屏。",
    },
  },
  install: {
    rows: ["npm install -g blackboard", "blackboard open docs/plan.md"],
    copy: "复制",
    copied: "已复制",
    bunPrefix: "也可以用 bun：",
    bunCommand: "bunx blackboard open docs/plan.md",
  },
  inbox: {
    heading: "收件箱",
    shot: {
      src: "/assets/inbox-zh.png",
      alt: "Blackboard 收件箱：按更新时间排列的文档列表，未读的用实心圆点标出——邮件模型，不是仪表盘",
      width: 1440,
      height: 540,
      caption: "一排文档，最新在前，未读加粗带点——邮件模型。点开一行阅读；正文在专注的阅读器里展开。",
      loading: "lazy",
    },
  },
  features: {
    heading: "它能做什么",
    items: [
      { title: "一份 markdown", text: "agent 写报告、计划或审计；`blackboard open` 注册它。一个文件，一份文档。" },
      { title: "正文批注", text: "划出提问的那段，写一句批注；回复平铺展示，可标记解决、也可重新打开——串就是对话。" },
      { title: "实时视图", text: "文件一改页面就刷新，高亮始终跟着它标注的段落。" },
      { title: "拉取，非推送", text: "agent 用 `blackboard comments` 读评论，`reply` 回，`resolve` 标完成——无 wait、无推送，shell 就行。" },
      { title: "地道的 markdown", text: "GFM 表格（表头吸顶）、标题锚点、目录，front matter 渲染成表格。" },
      { title: "离线 mermaid", text: "图表用内置库在浏览器里渲染，断网也能看。" },
      { title: "本地且安全", text: "只绑 127.0.0.1，只服务注册过的文件，每次请求都重新校验。" },
      { title: "一键复制", text: "未解决的评论复制成 markdown，粘到哪儿都能接着聊。" },
    ],
  },
  cli: {
    heading: "给 agent 的 CLI",
    rows: [
      { command: "open     <file> [--no-browser]                ", comment: '打印 "<id>  <url>"' },
      { command: "sessions [--json]                             ", comment: "id、标题、位置、分支、未解决评论" },
      { command: "comments <session> [--json]                   ", comment: "评论和回复" },
      { command: 'reply    <session> <comment-id> "text"' },
      { command: "resolve  <session> <comment-id>               ", comment: "或者：reopen" },
      { command: 'comment  <session> --quote "passage" "note"' },
      { command: "blocks   <session>                            ", comment: "文档的内容块" },
      { command: 'patch    <session> --id <block> --new "text"    ', comment: "改写一个块" },
    ],
    note: {
      before: "CLI 直接读写 ",
      code: "~/.blackboard",
      after: " 下的文件，和 web 应用共用一把锁——应用开着关着都能用，开着的页面会实时跟着变。",
    },
  },
  footer: {
    license: "MIT 许可证",
    requirements: "需要 bun 1.3+ · macOS 和 Linux · Chrome/Edge、Safari 17.2+",
  },
};
