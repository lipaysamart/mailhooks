// ABOUTME: Environment variable handling with validation
// ABOUTME: Provides typed access to environment variables

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue
  if (value === undefined) {
    throw new Error(`Environment variable ${key} is required but not set`)
  }
  return value
}

export function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key]
  if (value === undefined) {
    return defaultValue
  }
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number: ${value}`)
  }
  return parsed
}

export function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const value = process.env[key]
    if (value === undefined) {
      throw new Error(`Environment variable ${key} is not set`)
    }
    return value
  })
}