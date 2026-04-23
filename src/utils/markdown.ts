// ABOUTME: HTML to Markdown conversion utility
// ABOUTME: Converts HTML email content to clean Markdown format

import TurndownService from 'turndown'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-'
})

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}

export function getEmailBody(html: string | null): string {
  if (html) {
    return htmlToMarkdown(html)
  }
  return ''
}