// ABOUTME: Tests for environment variable handling
// ABOUTME: Provides typed access to environment variables

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { getEnv, getEnvNumber, expandEnvVars } from './env'

describe('getEnv', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('returns environment variable value', () => {
    process.env.TEST_VAR = 'test-value'
    expect(getEnv('TEST_VAR')).toBe('test-value')
  })

  test('returns default value when env var is not set', () => {
    delete process.env.MISSING_VAR
    expect(getEnv('MISSING_VAR', 'default-value')).toBe('default-value')
  })

  test('throws when env var is not set and no default', () => {
    delete process.env.UNDEFINED_VAR
    expect(() => getEnv('UNDEFINED_VAR')).toThrow('Environment variable UNDEFINED_VAR is required but not set')
  })

  test('returns empty string when env var is empty', () => {
    process.env.EMPTY_VAR = ''
    expect(getEnv('EMPTY_VAR')).toBe('')
  })

  test('returns env var even when default is provided', () => {
    process.env.EXISTING_VAR = 'actual-value'
    expect(getEnv('EXISTING_VAR', 'default-value')).toBe('actual-value')
  })
})

describe('getEnvNumber', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('returns number value from env var', () => {
    process.env.NUM_VAR = '42'
    expect(getEnvNumber('NUM_VAR', 0)).toBe(42)
  })

  test('returns default value when env var is not set', () => {
    delete process.env.MISSING_NUM
    expect(getEnvNumber('MISSING_NUM', 100)).toBe(100)
  })

  test('parses negative numbers', () => {
    process.env.NEG_VAR = '-10'
    expect(getEnvNumber('NEG_VAR', 0)).toBe(-10)
  })

  test('parses zero', () => {
    process.env.ZERO_VAR = '0'
    expect(getEnvNumber('ZERO_VAR', 100)).toBe(0)
  })

  test('throws when env var is not a number', () => {
    process.env.NOT_NUM = 'not-a-number'
    expect(() => getEnvNumber('NOT_NUM', 0)).toThrow('Environment variable NOT_NUM must be a number: not-a-number')
  })

  test('parses decimal numbers as integer', () => {
    process.env.DECIMAL_VAR = '3.14'
    expect(getEnvNumber('DECIMAL_VAR', 0)).toBe(3)
  })
})

describe('expandEnvVars', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('expands single environment variable', () => {
    process.env.PASSWORD = 'secret123'
    expect(expandEnvVars('password is ${PASSWORD}')).toBe('password is secret123')
  })

  test('expands multiple environment variables', () => {
    process.env.USER = 'john'
    process.env.HOST = 'example.com'
    expect(expandEnvVars('${USER}@${HOST}')).toBe('john@example.com')
  })

  test('returns original string when no variables', () => {
    expect(expandEnvVars('no-variables-here')).toBe('no-variables-here')
  })

  test('handles empty string', () => {
    expect(expandEnvVars('')).toBe('')
  })

  test('throws when variable is not set', () => {
    delete process.env.UNDEFINED_VAR
    expect(() => expandEnvVars('${UNDEFINED_VAR}')).toThrow('Environment variable UNDEFINED_VAR is not set')
  })

  test('handles adjacent variables', () => {
    process.env.A = 'foo'
    process.env.B = 'bar'
    expect(expandEnvVars('${A}${B}')).toBe('foobar')
  })

  test('handles variable at start and end', () => {
    process.env.PREFIX = 'start'
    process.env.SUFFIX = 'end'
    expect(expandEnvVars('${PREFIX}-middle-${SUFFIX}')).toBe('start-middle-end')
  })

  test('handles variable with special characters in value', () => {
    process.env.SPECIAL = 'hello@world.com'
    expect(expandEnvVars('email: ${SPECIAL}')).toBe('email: hello@world.com')
  })

  test('handles variable with spaces in value', () => {
    process.env.SPACES = 'value with spaces'
    expect(expandEnvVars('${SPACES}')).toBe('value with spaces')
  })
})