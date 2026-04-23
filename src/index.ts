// ABOUTME: MailHooks main entry point
// ABOUTME: Spawns sync and consumer processes based on mode

import { spawn } from 'bun'

type ProcessMode = 'all' | 'sync' | 'consumer'

function getMode(): ProcessMode {
  const mode = process.env.MAILHOOKS_MODE ?? 'all'
  if (mode === 'sync' || mode === 'consumer' || mode === 'all') {
    return mode
  }
  console.error(`Invalid MAILHOOKS_MODE: ${mode}. Valid values: all, sync, consumer`)
  process.exit(1)
}

async function main() {
  const mode = getMode()
  
  console.log(`[MAIN] Starting MailHooks in mode: ${mode}`)
  
  const processes: Promise<void>[] = []
  
  if (mode === 'all' || mode === 'sync') {
    processes.push(runProcess('sync', './src/sync.ts'))
  }
  
  if (mode === 'all' || mode === 'consumer') {
    processes.push(runProcess('consumer', './src/consumer.ts'))
  }
  
  await Promise.all(processes)
}

async function runProcess(name: string, path: string): Promise<void> {
  const proc = spawn({
    cmd: ['bun', 'run', path],
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env
  })
  
  const exitCode = await proc.exited
  
  if (exitCode !== 0) {
    console.error(`[MAIN] Process ${name} exited with code ${exitCode}`)
    process.exit(exitCode)
  }
}

main().catch(err => {
  console.error('[MAIN] Fatal error:', err)
  process.exit(1)
})