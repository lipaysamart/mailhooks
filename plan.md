# Implementation Plan (最终版)

## Goal
从零编写一个 mailhooks 程序，从 IMAP 邮箱增量拉取邮件，经 HTML→Markdown 转换后，通过队列和 goroutine 将结构化 payload 发送到配置的 webhook 端点，支持重试与过期清理。

---

## 1. 两轮 Oracle 质疑修正汇总

### 第一轮修正（已完成）

| # | 质疑 | 修正 |
|---|------|------|
| 1 | UIDSetNum 用法错误 | 改用 `UIDSet.AddRange` |
| 2 | Collect() API 不兼容 | 用 `msg.BodySection[].Bytes` |
| 3 | MIME 解析策略错误 | fetch `BODY[]` 完整原文 + `mail.CreateReader` |
| 4 | PopReady 并发不安全 | 原子移出 + in-flight map |
| 5 | Webhook URL 全局唯一 | 移到 `AccountConfig` 每账户独立 |
| 6 | address 字段缺失 | 新增 `Address` 字段 |
| 7 | 优雅关机不完整 | WaitGroup 跟踪 inflight |
| 8 | QueueConfig 时间字段用 string | → `time.Duration` |
| 9 | sync_interval 硬编码 | → `AccountConfig.SyncInterval` |
| 10 | 附件 content 配置缺失 | → `IncludeAttachmentContent` |
| 11 | 并发写 state 文件 | 每账户独立文件 + mutex |
| 12 | 抖动算法不精确 | 明确 `jitter = rand.Float64()*0.5-0.25` |
| 13 | IDLE 缺失 | 标注 v1.1 路线 |
| 14 | 重试超限 vs 过期混淆 | 两个独立清理条件 |
| 15 | BCC 字段 | 从 payload 移除 |

### 第二轮修正（本轮）

| # | 质疑 | 修正 |
|---|------|------|
| A | `UIDSetNum(uidSet...)` 编译错误 | 直接传 `uidSet` 给 `Fetch()`，`UIDSet` 实现了 `NumSet` 接口 |
| B | `SelectCommand.Collect()` 不存在 | 改为 `selectCmd.Wait()` 返回 `(*SelectData, error)` |
| C | `Filename()` 返回 `(string, error)` | 必须处理 error |
| D | yaml.v3 不原生支持 `time.Duration` | 时间字段回到 `string`，`LoadConfig` 内用 `time.ParseDuration` 解析 |
| E | 大邮箱 OOM：`Collect()` 一次性加载 | 改用流式 `fetchCmd.Next()` 逐封处理；每封处理完即更新 LastUID |
| F | 非 TLS 连接未处理 | 根据 `TLS bool` 分支 `DialTLS` / `DialStartTLS` |
| G | Message-ID 可能缺失 | ID 生成 fallback：`fmt.Sprintf("%d@%s", uid, accountName)` |
| H | account_name 做文件名不安全 | `Load()`/`Save()` 内部清洗路径（正则替换非 `[a-zA-Z0-9_-]`） |
| I | `UIDNext == 0` 时 uint32 下溢 | 增加空邮箱边界检查 |
| J | `stopCh` 定义未使用 | 移除，优雅关机仅走 context + WaitGroup |

---

## 2. 项目目录结构

```
mailhooks/
├── cmd/
│   └── mailhooks/
│       └── main.go              # 入口：加载配置、启动各组件、优雅关机
├── internal/
│   ├── config/
│   │   └── config.go            # Config + AccountConfig 定义与 YAML 加载
│   ├── model/
│   │   └── model.go             # Email, QueueItem, AccountState
│   ├── state/
│   │   └── state.go             # AccountState 持久化（每账户独立文件 + mutex，文件名清洗）
│   ├── syncer/
│   │   └── syncer.go            # IMAP 同步核心：完整邮件 fetch → MIME 解析
│   ├── queue/
│   │   └── queue.go             # 内存队列：PopReady 移除 + in-flight 跟踪 + 重试 + 清理
│   ├── converter/
│   │   └── converter.go         # HTML → Markdown
│   ├── webhook/
│   │   └── webhook.go           # 单次 HTTP POST 发送
│   └── logger/
│       └── logger.go            # zap 日志初始化
├── config.example.yaml          # 示例配置文件
├── go.mod
└── go.sum
```

---

## 3. 数据模型

```go
// package model

type AccountState struct {
    UIDValidity uint32 `json:"uid_validity"`
    LastUID     uint32 `json:"last_uid"`
}

type Address struct {
    Name    string `json:"name,omitempty"`
    Address string `json:"address"`
}

type Email struct {
    MessageID         string        `json:"message_id"`
    AccountName       string        `json:"account_name"`
    Subject           string        `json:"subject"`
    From              *Address      `json:"from"`
    To                []Address     `json:"to"`
    Cc                []Address     `json:"cc"`
    Date              time.Time     `json:"date"`
    TextBody          string        `json:"text_body,omitempty"`
    HTMLBody          string        `json:"html_body,omitempty"`
    MarkdownBody      string        `json:"markdown_body,omitempty"`
    Attachments       []Attachment  `json:"attachments,omitempty"`
}

type Attachment struct {
    Filename string `json:"filename"`
    MIMEType string `json:"mime_type"`
    Size     int    `json:"size"`
    Content  string `json:"content,omitempty"` // base64，仅 IncludeAttachmentContent=true 时填充
}

type QueueItem struct {
    ID          string    `json:"id"`
    Email       *Email    `json:"email"`
    RetryCount  int       `json:"retry_count"`
    MaxRetries  int       `json:"max_retries"`
    NextRetryAt time.Time `json:"next_retry_at"`
    CreatedAt   time.Time `json:"created_at"`
    ExpireAt    time.Time `json:"expire_at"`
}
```

---

## 4. 配置定义（修正：时间字段回退为 string，yaml.v3 兼容）

```go
// package config

type Config struct {
    Accounts []AccountConfig `yaml:"accounts"`
    Queue    QueueConfig     `yaml:"queue"`
    Log      LogConfig       `yaml:"log"`
}

type AccountConfig struct {
    Name                     string `yaml:"name"`
    Host                     string `yaml:"host"`
    Port                     int    `yaml:"port"`
    TLS                      bool   `yaml:"tls"`
    Username                 string `yaml:"username"`
    Password                 string `yaml:"password"`
    Address                  string `yaml:"address"`                     // payload 中的邮箱地址
    WebhookURL               string `yaml:"webhook_url"`                 // 每账户独立
    WebhookTimeout           string `yaml:"webhook_timeout"`             // 如 "30s"，LoadConfig 内 ParseDuration
    SyncInterval             string `yaml:"sync_interval"`               // 如 "60s"
    IncludeAttachmentContent bool   `yaml:"include_attachment_content"`  // 默认 false
}

type QueueConfig struct {
    PollInterval    string `yaml:"poll_interval"`    // 如 "5s"；LoadConfig 内 ParseDuration
    MaxRetries      int    `yaml:"max_retries"`      // 默认 3
    RetryDelay      string `yaml:"retry_delay"`      // 如 "30s"
    ExpireAfter     string `yaml:"expire_after"`     // 如 "24h"
    CleanupInterval string `yaml:"cleanup_interval"` // 如 "5m"
}

type LogConfig struct {
    Level  string `yaml:"level"`  // debug / info / warn / error，默认 info
    Format string `yaml:"format"` // console / json，默认 console
}
```

**LoadConfig 内部**：
- 用 `time.ParseDuration()` 将各 string 字段解析为内部使用的 `time.Duration`
- 未配置的字段填充默认值

---

## 5. 同步流程（最终修正版伪代码）

```go
// package syncer

func (s *Syncer) Sync(ctx context.Context) error {
    // 1. 连接 IMAP（分支 TLS / StartTLS）
    hostPort := s.cfg.Host + ":" + strconv.Itoa(s.cfg.Port)
    var client *imapclient.Client
    var err error
    if s.cfg.TLS {
        client, err = imapclient.DialTLS(hostPort, nil)
    } else {
        client, err = imapclient.DialStartTLS(hostPort, nil)
    }
    if err != nil { return err }
    defer client.Close()

    // 2. SELECT INBOX — 用 Wait() 而非 Collect()
    selectCmd := client.Select("INBOX", nil)
    mailboxData, err := selectCmd.Wait()
    if err != nil { return err }
    uidValidity := mailboxData.UIDValidity
    uidNext := mailboxData.UIDNext
    if uidNext == 0 { return nil } // 空邮箱

    // 3. 加载持久化状态
    state, err := s.stateStore.Load(s.cfg.Name)
    if err != nil { return err }
    if uidValidity != state.UIDValidity {
        s.log.Info("UIDValidity changed, full resync")
        state.LastUID = 0
    }

    // 4. 无新邮件则返回
    if uidNext <= state.LastUID+1 { return nil }

    // 5. 构造 UID 范围 — UIDSet 直接传 Fetch（实现了 NumSet 接口）
    var uidSet imap.UIDSet
    uidSet.AddRange(imap.UID(state.LastUID+1), 0) // 0 = '*'

    fetchOptions := &imap.FetchOptions{
        Flags:    true,
        Envelope: true,
        BodySection: []*imap.FetchItemBodySection{
            {}, // 零值 = BODY[] 完整邮件原文
        },
    }

    // 6. 流式消费 — 用 Next() 避免大邮箱 OOM
    fetchCmd := client.Fetch(uidSet, fetchOptions)
    for {
        msg := fetchCmd.Next()
        if msg == nil { break }

        rawBody := msg.BodySection[0].Bytes
        email, parseErr := s.parseMIME(rawBody)
        if parseErr != nil {
            s.log.Error("parse MIME failed", zap.Error(parseErr), "uid", msg.UID)
            continue
        }
        email.AccountName = s.cfg.Name

        // 生成队列 ID：Message-ID 优先，fallback 用 UID
        itemID := email.MessageID
        if itemID == "" {
            itemID = fmt.Sprintf("%d@%s", msg.UID, s.cfg.Name)
        } else {
            itemID = itemID + "@" + s.cfg.Name
        }

        // Push 内部去重（检查 ID 是否已在 pending/inFlight）
        s.queue.Push(&model.QueueItem{
            ID:          itemID,
            Email:       email,
            MaxRetries:  s.queueCfg.MaxRetries,
            NextRetryAt: time.Now(),
            CreatedAt:   time.Now(),
            ExpireAt:    time.Now().Add(s.queueCfg.ExpireAfter),
        })

        // 逐封更新 LastUID（流式处理的好处）
        if msg.UID > imap.UID(state.LastUID) {
            state.LastUID = uint32(msg.UID)
        }
    }
    if err := fetchCmd.Err(); err != nil { return err }

    // 7. 持久化状态
    state.UIDValidity = uidValidity
    return s.stateStore.Save(s.cfg.Name, state)
}

// parseMIME 使用 go-message/mail 解析完整 RFC 822 MIME
func (s *Syncer) parseMIME(raw []byte) (*model.Email, error) {
    mr, err := mail.CreateReader(bytes.NewReader(raw))
    if err != nil { return nil, err }
    email := &model.Email{}

    // 解析 header
    header := mr.Header
    email.MessageID, _ = header.MessageID()
    email.Subject, _ = header.Subject()
    if from, err := header.AddressList("From"); err == nil && len(from) > 0 {
        email.From = &model.Address{Name: from[0].Name, Address: from[0].Address}
    }
    if to, err := header.AddressList("To"); err == nil {
        for _, a := range to { email.To = append(email.To, model.Address{Name: a.Name, Address: a.Address}) }
    }
    if cc, err := header.AddressList("Cc"); err == nil {
        for _, a := range cc { email.Cc = append(email.Cc, model.Address{Name: a.Name, Address: a.Address}) }
    }
    if d, err := header.Date(); err == nil { email.Date = d }

    // 遍历 body 各部分
    for {
        part, err := mr.NextPart()
        if err == io.EOF { break }
        if err != nil { continue }

        switch h := part.Header.(type) {
        case *mail.InlineHeader:
            bodyBytes, _ := io.ReadAll(part.Body)
            ct := part.Header.Get("Content-Type")
            if strings.HasPrefix(ct, "text/plain") {
                email.TextBody = string(bodyBytes)
            } else if strings.HasPrefix(ct, "text/html") {
                email.HTMLBody = string(bodyBytes)
                md, convErr := s.converter.ConvertHTMLToMarkdown(string(bodyBytes))
                if convErr == nil { email.MarkdownBody = md }
            }
        case *mail.AttachmentHeader:
            bodyBytes, _ := io.ReadAll(part.Body)
            filename, fnErr := h.Filename() // 返回 (string, error)，修正！
            if fnErr != nil { filename = "unknown" }
            att := model.Attachment{
                Filename: filename,
                MIMEType: part.Header.Get("Content-Type"),
                Size:     len(bodyBytes),
            }
            if s.cfg.IncludeAttachmentContent {
                att.Content = base64.StdEncoding.EncodeToString(bodyBytes)
            }
            email.Attachments = append(email.Attachments, att)
        }
    }
    return email, nil
}
```

**本轮修正要点**：
- 连接：分支 `DialTLS` / `DialStartTLS`（问题 F）
- SELECT：`Wait()` 替代 `Collect()`（问题 B）
- UID 范围：`uidSet` 直接传 `Fetch()`（问题 A）
- 消费：`Next()` 流式替代 `Collect()`（问题 E）
- 队列 ID：Message-ID 缺失时 fallback UID（问题 G）
- `Filename()` error 处理（问题 C）
- 每封邮件处理完即更新 LastUID（流式处理附带优化）

---

## 6. 队列设计（最终修正版）

### 数据结构

```go
// package queue

type Queue struct {
    mu       sync.Mutex
    pending  []*model.QueueItem           // 待发送（按 NextRetryAt 推入，PopReady 时顺序扫描）
    inFlight map[string]*model.QueueItem  // 正在发送（ID → item）
    cfg      QueueResolvedConfig          // 解析后的时间配置（time.Duration）
    url      string                       // webhook URL
    logger   *zap.Logger
    wg       sync.WaitGroup               // 跟踪 inflight goroutine
}
// stopCh 已移除 — 优雅关机走 context + WaitGroup
```

### PopReady（原子移出）

```
PopReady() []*model.QueueItem:
  1. mu.Lock()
  2. 遍历 pending，收集 NextRetryAt <= time.Now() 的 item
  3. 从 pending 中移除这些 item，放入 inFlight map
  4. mu.Unlock()
  5. 返回 collected items
```

### Consumer goroutine

```go
func (q *Queue) Consume(ctx context.Context) {
    ticker := time.NewTicker(q.cfg.PollInterval)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            for _, item := range q.PopReady() {
                q.wg.Add(1)
                go func(item *model.QueueItem) {
                    defer q.wg.Done()
                    err := webhook.Send(ctx, q.url, item.Email)
                    if err == nil {
                        q.MarkDone(item.ID)     // 从 inFlight 移除
                    } else {
                        q.MarkFailed(item.ID)   // re-enqueue 或丢弃
                    }
                }(item)
            }
        case <-ctx.Done():
            q.wg.Wait()  // 等待所有 inflight 完成
            return
        }
    }
}
```

### 重试逻辑（MarkFailed）

```
MarkFailed(id string):
  mu.Lock()
  item := inFlight[id]
  delete(inFlight, id)
  item.RetryCount++

  若 item.RetryCount > item.MaxRetries:
    mu.Unlock(); return  // 超过重试次数，直接丢弃

  // 指数退避 + 随机抖动
  base := float64(cfg.RetryDelay) * math.Pow(2, float64(item.RetryCount-1))
  jitter := (rand.Float64() * 0.5) - 0.25
  delay := time.Duration(base * (1 + jitter))
  item.NextRetryAt = time.Now().Add(delay)

  pending = append(pending, item)  // re-enqueue
  mu.Unlock()
```

### Push（带去重）

```
Push(item *model.QueueItem):
  mu.Lock()
  若 item.ID 已存在于 inFlight 或 pending 中 → mu.Unlock(); return  // 重复，跳过
  pending = append(pending, item)
  mu.Unlock()
```

### 过期清理

```
CleanupExpired():
  mu.Lock()
  新切片 = filter pending 中 ExpireAt >= time.Now()
  pending = 新切片
  mu.Unlock()
```

独立 cleanup goroutine 每 `cleanupInterval` 运行一次。

---

## 7. Webhook Payload

```json
{
  "event": "email.received",
  "account": {
    "name": "个人邮箱",
    "address": "user@example.com"
  },
  "email": {
    "message_id": "<abc123@mail.example.com>",
    "subject": "Hello from Mailhooks",
    "from": { "name": "Alice", "address": "alice@example.com" },
    "to": [{ "name": "Bob", "address": "bob@example.com" }],
    "cc": [],
    "date": "2025-06-01T10:30:00Z",
    "text_body": "...",
    "html_body": "<html>...</html>",
    "markdown_body": "**bold text**",
    "attachments": [
      {
        "filename": "report.pdf",
        "mime_type": "application/pdf",
        "size": 1024000
      }
    ]
  },
  "timestamp": "2025-06-01T10:30:05Z"
}
```

---

## 8. 实现步骤

| # | 步骤 | 文件 | 验证 |
|---|------|------|------|
| 1 | 清理项目，重设 go.mod | `go.mod`, `cmd/main.go` | `go build ./...` |
| 2 | 实现 logger | `internal/logger/logger.go` | 运行验证 |
| 3 | 实现 model | `internal/model/model.go` | 编译通过 |
| 4 | 实现 config（string 时间字段 + ParseDuration） | `internal/config/config.go` | 单元测试 |
| 5 | 实现 state（每账户文件 + 路径清洗 + mutex） | `internal/state/state.go` | 并发测试 |
| 6 | 实现 converter（html-to-markdown/v2） | `internal/converter/converter.go` | 单元测试 |
| 7 | 实现 webhook | `internal/webhook/webhook.go` | mock server 验证 |
| 8 | 实现 queue（PopReady + inflight + 去重 + 重试 + 清理） | `internal/queue/queue.go` | 单元测试 |
| 9 | 实现 syncer（流式 Fetch + MIME 解析 + TLS 分支） | `internal/syncer/syncer.go` | mock/真实邮箱 |
| 10 | 实现 main.go（优雅关机） | `cmd/mailhooks/main.go` | 端到端测试 |
| 11 | 配置示例 | `config.example.yaml` | 文档化 |

### 依赖关系

```
model ← 无依赖
logger ← 无依赖
    ↗
config → state → queue → webhook
    ↘               ↗
     converter → syncer
          ↘         ↗
           main.go
```

---

## 9. 关键 API 调用确认（go-imap/v2 beta.8）

```go
// 连接 — 分支 TLS/StartTLS
hostPort := host + ":" + strconv.Itoa(port)
if tls {
    client, err = imapclient.DialTLS(hostPort, nil)
} else {
    client, err = imapclient.DialStartTLS(hostPort, nil)
}

// SELECT INBOX — Wait() 而非 Collect()
selectCmd := client.Select("INBOX", nil)
mailboxData, err := selectCmd.Wait()
uidValidity := mailboxData.UIDValidity  // uint32
uidNext := mailboxData.UIDNext           // imap.UID (uint32)

// UID 区间 — AddRange 后直接传 Fetch
var uidSet imap.UIDSet
uidSet.AddRange(imap.UID(lastUID+1), 0) // 0 = *
fetchCmd := client.Fetch(uidSet, fetchOptions)

// 流式消费 — Next() 而非 Collect()
for {
    msg := fetchCmd.Next()
    if msg == nil { break }
    raw := msg.BodySection[0].Bytes  // []byte，完整邮件原文
    uid := msg.UID                    // imap.UID
}
if err := fetchCmd.Err(); err != nil { ... }
```

**依赖库**：
- `github.com/emersion/go-imap/v2` — IMAP 客户端
- `github.com/emersion/go-message` — MIME 解析（`mail.CreateReader`）
- `github.com/JohannesKaufmann/html-to-markdown/v2` — HTML→Markdown
- `go.uber.org/zap` — 结构化日志
- `gopkg.in/yaml.v3` — YAML 配置

---

## 10. 优雅关机流程

```go
// cmd/mailhooks/main.go

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // 初始化各组件...

    // 启动 syncer goroutines（每个账户一个）
    for _, acc := range cfg.Accounts {
        go syncer.Run(ctx)
    }

    // 启动 queue consumer + cleanup goroutines
    go queue.Consume(ctx)
    go queue.Cleanup(ctx)

    // 等待信号
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh

    // 优雅关机
    cancel()         // 停止 syncer / consumer / cleanup 接受新任务
    queue.Shutdown() // 内部 wg.Wait() 等待所有 inflight webhook 完成
}
```

**Shutdown 实现**：
```
func (q *Queue) Shutdown() { q.wg.Wait() }
```

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| go-imap/v2 beta.8 API 变动 | go.mod 锁定版本 |
| IMAP 服务器兼容性差异 | 可替抽象接口 + mock 测试 |
| 大邮箱首次全量同步 | **流式 Next() 消费**（本版修正），逐封处理 |
| 内存队列重启丢失 | 邮件保留在 IMAP，重启后重新同步 |
| HTML→Markdown 转换异常 | payload 中 html_body + markdown_body 共存，失败时保留 HTML |
| 多账户并发写 state 文件 | 每账户独立文件 + StateStore 内部 sync.Mutex |
| account_name 路径遍历 | **正则清洗文件名**（本版修正） |
| Message-ID 缺失导致重复 | **UID fallback 生成 ID**（本版修正） |
| yaml 时间字段反序列化 | **string + ParseDuration**（本版修正） |
