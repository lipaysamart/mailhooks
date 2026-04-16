// ABOUTME: Individual rule matching functions
// ABOUTME: Implements from, subject, folder, and wildcard matching

import type { MatchCondition } from '../config/types'
import type { MatcherContext } from './types'

export function matchWildcard(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) {
    return pattern.toLowerCase() === value.toLowerCase()
  }
  
  const parts = pattern.split('*')
  let remaining = value.toLowerCase()
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toLowerCase()
    
    if (i === 0) {
      if (part && !remaining.startsWith(part)) {
        return false
      }
      remaining = remaining.slice(part.length)
    } else if (i === parts.length - 1) {
      if (part && !remaining.endsWith(part)) {
        return false
      }
    } else {
      const idx = remaining.indexOf(part)
      if (idx === -1) {
        return false
      }
      remaining = remaining.slice(idx + part.length)
    }
  }
  
  return true
}

export function matchFrom(patterns: string[], fromAddr: string): boolean {
  for (const pattern of patterns) {
    if (matchWildcard(pattern, fromAddr)) {
      return true
    }
  }
  return false
}

export function matchSubject(patterns: string[], subject: string | null): boolean {
  if (!subject) return false
  
  const lowerSubject = subject.toLowerCase()
  for (const pattern of patterns) {
    if (lowerSubject.includes(pattern.toLowerCase())) {
      return true
    }
  }
  return false
}

export function matchFolders(patterns: string[], folder: string): boolean {
  for (const pattern of patterns) {
    if (matchWildcard(pattern, folder)) {
      return true
    }
  }
  return false
}

export function matchCondition(condition: MatchCondition, ctx: MatcherContext): boolean {
  if (condition.catch_all) {
    return true
  }
  
  let matched = true
  
  if (condition.from && condition.from.length > 0) {
    matched = matched && matchFrom(condition.from, ctx.fromAddr)
  }
  
  if (condition.subject && condition.subject.length > 0) {
    matched = matched && matchSubject(condition.subject, ctx.subject)
  }
  
  if (condition.folders && condition.folders.length > 0) {
    matched = matched && matchFolders(condition.folders, ctx.folder)
  }
  
  return matched
}