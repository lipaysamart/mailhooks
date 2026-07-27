export interface EmailSummary {
  from: string;
  to: string;
  subject: string;
  text_body: string;
  html_body: string | null;
  received_at: string;
}

export interface WebhookRoute {
  address: string;
  url: string;
}

export interface QueueJob {
  id: number;
  to_address: string;
  webhook_url: string;
  payload: string;
  status: "pending" | "done" | "failed";
  attempts: number;
  next_retry_at: number | null;
  created_at: number;
  updated_at: number;
}
