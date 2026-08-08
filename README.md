# 缓一缓（huan-yi-huan）

一个在情绪升高时提供即时觉察与短暂缓冲的极简应用。

项目目标、产品要求与限制统一记录在 [`docs/PRODUCT.md`](./docs/PRODUCT.md)。

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- pnpm

## 本地开发

请先安装 [Node.js](https://nodejs.org/) 20 或更高版本，以及 [pnpm](https://pnpm.io/)。

```bash
pnpm install
pnpm dev
```

启动后访问 [http://localhost:3000](http://localhost:3000)。

## 常用命令

```bash
pnpm dev       # 启动开发服务器
pnpm build     # 构建生产版本
pnpm start     # 启动生产服务器
pnpm lint      # 检查代码规范
```

## 项目结构

```text
app/           Next.js 页面与布局
public/        静态资源
```

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。
