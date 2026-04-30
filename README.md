# 问医生助手

一个手机优先的寻医问药聊天网页。前端支持文字提问、拍照/图片上传，并可选择：

- `双医生`：同时请求 OpenAI医生 和 Gemini医生
- `OpenAI医生`：只请求 OpenAI
- `Gemini医生`：只请求 Gemini

后端是无依赖 Node.js 服务。没有配置 API key 时会返回演示内容；配置后会把文字和图片发送给对应模型。

## 已有功能

- 手机优先聊天界面
- OpenAI医生 / Gemini医生 / 双医生模式
- 图片上传，随问题一起发送给模型
- 服务端登录：管理员创建用户后，用户才能登录
- 本地历史：登录后，对话记录保存在浏览器 `localStorage`
- 管理员设置：只有管理员可以编辑 OpenAI医生 / Gemini医生 的 system prompt
- 管理员添加用户：初期可由管理员在页面中手动创建普通用户
- Railway Postgres：线上使用数据库保存用户、医生提示词和用户对话历史

注意：历史能更快恢复旧对话，但不会让模型生成本身更快。把长历史发送给模型通常会更慢、更贵；当前版本默认只保存和展示历史，不把完整历史自动塞进每次请求。

## 本地运行

```bash
npm start
```

打开 `http://localhost:3000`。

## 配置

在 `.env` 或部署平台环境变量中设置：

```bash
OPENAI_API_KEY=你的OpenAI密钥
GEMINI_API_KEY=你的Gemini密钥
OPENAI_MODEL=gpt-4.1-mini
GEMINI_MODEL=gemini-2.5-flash
ADMIN_PASSWORD=设置一个管理员密码
DATABASE_URL=Railway Postgres 自动提供
```

管理员用户名固定为 `admin`，密码来自 `ADMIN_PASSWORD`。普通用户需要管理员登录后在“管理”面板手动添加。

`OPENAI_MODEL` 和 `GEMINI_MODEL` 可不填，代码里已有默认值。

## Railway Postgres

线上建议添加 Railway Postgres：

1. Railway 项目中点击 `New`。
2. 选择 `Database` -> `Postgres`。
3. 将 Postgres 连接到同一个环境。
4. 回到 Web Service 的 `Variables`，确认能看到 `DATABASE_URL`。
5. `Apply changes` 并重新部署。

有 `DATABASE_URL` 时，用户、医生提示词和对话历史会保存到数据库；没有数据库时，本地开发会退回到文件和浏览器本地存储。

## 上线 Host Online

最简单方式是部署到 Render、Railway、Fly.io 或任意支持 Node.js 的平台：

1. 上传这个项目到 GitHub。
2. 在平台创建 Node.js Web Service。
3. Build command 留空或使用 `npm install`。
4. Start command 填 `npm start`。
5. 添加环境变量 `OPENAI_API_KEY`、`GEMINI_API_KEY`、`ADMIN_PASSWORD`。
6. 添加 Railway Postgres，并确认 `DATABASE_URL` 已注入 Web Service。

上线后，不要把 API key 放进前端代码。密钥只应放在服务端环境变量里。

## 医疗安全边界

这个网页用于就医前信息整理，不能替代医生面诊、诊断或处方。出现胸痛、呼吸困难、中风症状、意识不清、严重出血等急症时，应立即拨打当地急救电话。
