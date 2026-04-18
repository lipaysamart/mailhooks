# Webhook Payload Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Handlebars template rendering with fixed JSON payload schema for webhook delivery.

**Architecture:** Remove template compilation, build JSON payload directly in WebhookSender using new WebhookPayload schema.

**Tech Stack:** TypeScript, Bun

---

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `src/types.ts` | Modify | Add WebhookPayload type |
| `src/config/types.ts` | Modify | Remove template field |
| `src/config/schema.ts` | Modify | Remove template validation |
| `src/webhooks/sender.ts` | Modify | Build JSON payload directly |
| `src/utils/template.ts` | Delete | No longer needed |
| `config.example.yaml` | Modify | Remove template example |
| `package.json` | Modify | Remove handlebars dependency |

---

### Task 1: Add WebhookPayload Type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add WebhookPayload interface**

Add after the `Email` interface:

```typescript
export interface WebhookPayload {
  subject: string
  from_name: string
  context: {
    text: string
    date: string
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add WebhookPayload type definition"
```

---

### Task 2: Remove Template Field from WebhookConfig

**Files:**
- Modify: `src/config/types.ts`

- [ ] **Step 1: Remove template field**

In `WebhookConfig` interface, remove the `template: string` line.

The interface should look like:

```typescript
export interface WebhookConfig {
  url: string
  method?: string
  headers?: Record<string, string>
  timeout?: number
  retry?: WebhookRetryConfig
  poll_interval?: number
  expires_hours?: number
  cleanup_days?: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/types.ts
git commit -m "refactor: remove template field from WebhookConfig"
```

---

### Task 3: Remove Template Validation

**Files:**
- Modify: `src/config/schema.ts`

- [ ] **Step 1: Remove template validation in validateWebhook()**

Remove these lines from `validateWebhook()`:

```typescript
if (!webhook.template || typeof webhook.template !== 'string') {
  throw new Error('webhook.template: required and must be string')
}
```

And remove `template: webhook.template as string` from the return object.

The return should look like:

```typescript
return {
  url: webhook.url,
  method: webhook.method as string | undefined,
  headers: webhook.headers as Record<string, string> | undefined,
  timeout: webhook.timeout as number | undefined,
  retry: webhook.retry as WebhookRetryConfig | undefined,
  poll_interval: webhook.poll_interval as number | undefined,
  expires_hours: webhook.expires_hours as number | undefined,
  cleanup_days: webhook.cleanup_days as number | undefined
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/schema.ts
git commit -m "refactor: remove template validation from config schema"
```

---

### Task 4: Update WebhookSender to Build JSON Payload

**Files:**
- Modify: `src/webhooks/sender.ts`

- [ ] **Step 1: Update imports**

Change:
```typescript
import type { Email } from '../types'
import { compileTemplate } from '../utils/template'
```

To:
```typescript
import type { Email, WebhookPayload } from '../types'
```

- [ ] **Step 2: Remove templateFn property**

Remove from class:
```typescript
private templateFn: (email: Email) => string
```

- [ ] **Step 3: Update constructor**

Change:
```typescript
constructor(config: WebhookConfig, logger: Logger) {
  this.logger = logger.child({ module: 'webhook' })
  this.templateFn = compileTemplate(config.template)
}
```

To:
```typescript
constructor(logger: Logger) {
  this.logger = logger.child({ module: 'webhook' })
}
```

- [ ] **Step 4: Add buildPayload method**

Add after constructor:

```typescript
private buildPayload(email: Email): WebhookPayload {
  const text = email.text ?? ''
  const truncatedText = text.length > 500 
    ? text.substring(0, 500) + '...(内容过长已截断)' 
    : text
  
  return {
    subject: email.subject ?? '',
    from_name: email.fromName ?? '',
    context: {
      text: truncatedText,
      date: email.date
    }
  }
}
```

- [ ] **Step 5: Update send method**

Change:
```typescript
const body = this.templateFn(email)
```

To:
```typescript
const payload = this.buildPayload(email)
const body = JSON.stringify(payload)
```

- [ ] **Step 6: Update headers for JSON content type**

In the `send` method, update headers handling:

```typescript
const headers = {
  'Content-Type': 'application/json',
  ...config.headers
}
```

- [ ] **Step 7: Commit**

```bash
git add src/webhooks/sender.ts
git commit -m "feat: build JSON payload directly in WebhookSender"
```

---

### Task 5: Delete Template Utility

**Files:**
- Delete: `src/utils/template.ts`

- [ ] **Step 1: Delete the file**

```bash
rm src/utils/template.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "refactor: remove template utility"
```

---

### Task 6: Update Example Config

**Files:**
- Modify: `config.example.yaml`

- [ ] **Step 1: Remove template field**

Remove lines 41-44:
```yaml
  template: |
    {
      "text": "📧 New Email\nFrom: {{from_name}} <{{from_addr}}>\nSubject: {{subject}}\n\n{{text}}"
    }
```

- [ ] **Step 2: Commit**

```bash
git add config.example.yaml
git commit -m "docs: remove template from example config"
```

---

### Task 7: Remove Handlebars Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove handlebars from dependencies**

Remove:
```json
"handlebars": "^4.7.8",
```

- [ ] **Step 2: Install dependencies**

```bash
bun install
```

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: remove handlebars dependency"
```

---

### Task 8: Verify Build

- [ ] **Step 1: Build and verify**

```bash
bun run build
```

Expected: Build succeeds without errors.

- [ ] **Step 2: Run type check**

```bash
bunx tsc --noEmit
```

Expected: No type errors.