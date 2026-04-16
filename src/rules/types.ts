// ABOUTME: Rule engine type definitions
// ABOUTME: Defines types for rule matching and filtering

import type { RuleConfig } from '../config/types'

export interface MatchResult {
  matched: boolean
  rule: RuleConfig
}

export interface MatcherContext {
  fromAddr: string
  subject: string | null
  folder: string
}