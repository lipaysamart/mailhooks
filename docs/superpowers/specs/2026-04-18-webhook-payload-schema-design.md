# Webhook Payload Schema Design

## Summary

Replace Handlebars template rendering with a fixed JSON payload schema for webhook delivery.

## Background

Currently, webhooks use a configurable Handlebars template to format email data before sending. The user wants to simplify this to use a fixed JSON schema instead.

## Schema Definition

```typescript
interface WebhookPayload {
  subject: string      // email.subject ?? ''
  from_name: string    // email.fromName ?? ''
  context: {
    text: string       // email.text (truncated to 500 chars with suffix if longer)
    date: string       // email.date
  }
}
```

## Changes

### Files to Modify

1. **`src/types.ts`** - Add `WebhookPayload` type definition

2. **`src/config/types.ts`** - Remove `template` field from `WebhookConfig`

3. **`src/config/schema.ts`** - Remove template validation logic in `validateWebhook()`

4. **`src/webhooks/sender.ts`** - Remove template compilation, build JSON payload directly

### Files to Delete

- **`src/utils/template.ts`** - No longer needed

## Implementation Details

### Payload Building Logic

In `WebhookSender.send()`:

```typescript
const payload: WebhookPayload = {
  subject: email.subject ?? '',
  from_name: email.fromName ?? '',
  context: {
    text: email.text && email.text.length > 500 
      ? email.text.substring(0, 500) + '...(内容过长已截断)' 
      : email.text ?? '',
    date: email.date
  }
}

const body = JSON.stringify(payload)
```

### Request Headers

Update headers to include `Content-Type: application/json` if not already set by user.

## Migration

Users need to:
1. Remove `template` field from `webhook` config in `config.yaml`
2. Update their webhook endpoint to expect the new JSON schema