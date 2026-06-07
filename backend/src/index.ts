import './load-env.js'
import express from 'express'
import cors from 'cors'
import { resolve } from 'path'
import { assertTheHandRequiredEnv } from '@thehand/core'
import { initDB } from './db.js'
import { requirementsRouter } from './routes/requirements.js'
import { eventsRouter } from './routes/events.js'
import { orchestratorRouter } from './routes/orchestrator.js'
import { log } from './logger.js'

assertTheHandRequiredEnv()

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors())
app.use(express.json())

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    log.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`)
  })
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/requirements', requirementsRouter)
app.use('/api/events', eventsRouter)
app.use('/api/orchestrator', orchestratorRouter)

// 启动
async function start() {
  await initDB()
  app.listen(PORT, () => {
    log.info(`TheHand backend running on http://localhost:${PORT}`)
    log.info(`数据目录: ${resolve(process.cwd(), '..', 'data')}`)
  })
}

start().catch(err => {
  console.error('启动失败:', err)
  process.exit(1)
})
