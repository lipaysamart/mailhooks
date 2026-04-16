// ABOUTME: Retry logic for webhook sending
// ABOUTME: Implements configurable retry with delay

export async function retry<T>(
  fn: () => Promise<T>,
  count: number,
  delay: number
): Promise<{ success: boolean; result?: T; attempts: number; lastError?: string }> {
  let attempts = 0
  let lastError: string | undefined
  
  while (attempts < count) {
    attempts++
    
    try {
      const result = await fn()
      return { success: true, result, attempts }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      
      if (attempts < count) {
        await sleep(delay * 1000)
      }
    }
  }
  
  return { success: false, attempts, lastError }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}