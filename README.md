# mailhooks

**邮件 → Webhook 桥接服务** — 监听 IMAP 邮箱，将收到的邮件以 HTTP POST 转发到指定 URL。

## 前置条件

- **Node.js 22.6+**（`--experimental-strip-types` 直接运行 TypeScript；Node 23.6+/24 起默认开启，无需 flag）
- **npm**

## 安装

```bash
git clone https://github.com/lipaysamart/mailhooks.git
cd mailhooks
npm install
```

## 配置

```bash
cp config.example.json config.json
```

编辑 `config.json` 填入真实配置，完整示例见 [`config.example.json`](./config.example.json)：

```json
{
  "host": "imap.gmail.com",
  "port": 993,
  "secure": true,
  "username": "you@gmail.com",
  "password": "your-app-password",
  "routes": [
    {
      "address": "alerts@yourdomain.com",
      "url": "https://hooks.example.com/alerts"
    }
  ]
}
```

> 💡 Gmail 用户需使用 [App Password](https://myaccount.google.com/apppasswords)（需先开启两步验证），不要使用账号主密码。

启动时会校验配置：`host` / `port` / `secure` / `username` / `password` / `routes`（及其每一项的 `address` / `url`）均为必填且类型正确，否则直接报错退出。

### 配置参考

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|:----:|--------|------|
| `host` | `string` | ✅ | — | IMAP 服务器地址 |
| `port` | `number` | ✅ | — | IMAP 端口（通常 993） |
| `secure` | `boolean` | ✅ | — | 是否启用 TLS |
| `username` | `string` | ✅ | — | IMAP 用户名 |
| `password` | `string` | ✅ | — | IMAP 密码 |
| `routes` | `array` | ✅ | — | 路由规则数组，至少 1 条（见下表） |
| `proxy` | `string` | — | — | SOCKS 代理（如 `socks5://127.0.0.1:1080`） |
| `mailbox` | `string` | — | `INBOX` | 监听的文件夹 |
| `pollIntervalSeconds` | `number` | — | `60` | 轮询间隔（秒），须为正数 |
| `dbPath` | `string` | — | `./mailhooks.db` | SQLite 数据库文件路径 |

**routes 子项（每项必填）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `address` | `string` | 匹配的收件人地址（不区分大小写） |
| `url` | `string` | 转发目标 Webhook URL |

> 配置为明文持有 IMAP 密码，请留意 `config.json` 的文件权限（已加入 `.gitignore`，不会提交到仓库）。

## 启动

```bash
npm run dev        # 直接运行
npm run dev:watch  # watch 模式（开发用）
```

首次启动立即执行一轮轮询，之后按 `pollIntervalSeconds`（默认 60s）周期性轮询。

### Docker 部署

```bash
docker compose up -d
```

`docker-compose.yml` 会挂载当前目录的 `config.json`。**如需持久化队列数据，请在 `config.json` 中设置** `"dbPath": "./data/mailhooks.db"`（对应命名卷 `mailhooks-data`），否则数据存于容器可写层，容器销毁后丢失。

查看日志：`docker compose logs -f mailhooks`

## License

MIT