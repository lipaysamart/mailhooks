// ABOUTME: Tests for HTML to Markdown conversion
// ABOUTME: Verifies correct conversion of HTML email content to Markdown

import { describe, it, expect } from 'bun:test'
import { htmlToMarkdown, getEmailBody } from './markdown'

describe('htmlToMarkdown', () => {
  it('converts basic HTML to Markdown', () => {
    const html = '<h1>Hello</h1><p>This is <strong>bold</strong> text.</p>'
    const result = htmlToMarkdown(html)
    expect(result).toContain('# Hello')
    expect(result).toContain('**bold**')
  })

  it('converts links', () => {
    const html = '<a href="https://example.com">Click here</a>'
    const result = htmlToMarkdown(html)
    expect(result).toContain('[Click here](https://example.com)')
  })

  it('converts lists', () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li></ul>'
    const result = htmlToMarkdown(html)
    expect(result).toContain('Item 1')
    expect(result).toContain('Item 2')
    expect(result).toMatch(/-.*Item 1/)
    expect(result).toMatch(/-.*Item 2/)
  })
})

describe('getEmailBody', () => {
  it('returns HTML converted to Markdown when HTML is present', () => {
    const html = '<p>HTML content</p>'
    const result = getEmailBody(html)
    expect(result).toContain('HTML content')
  })

  it('returns empty string when HTML is null', () => {
    const result = getEmailBody(null)
    expect(result).toBe('')
  })
})