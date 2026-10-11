import { createServer } from 'http'
import { Server } from 'socket.io'

// WanVid real-time progress service (pure socket.io, port 3003)
//
// Two kinds of clients connect:
//   1. Browser clients — `subscribe` to a messageId/chatId and listen for `progress`.
//   2. The Next.js backend (trusted) — emits `push-progress` to broadcast updates.

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

const progressStore = new Map<string, any>()
const BACKEND_SECRET = process.env.BACKEND_SECRET || 'wanvid-backend-trust'
const backendSockets = new Set<string>()

io.on('connection', (socket) => {
  console.log(`[realtime] client connected: ${socket.id}`)

  // Trusted backend registers itself with a shared secret.
  socket.on('register-backend', (data: { secret?: string }) => {
    if (data?.secret === BACKEND_SECRET) {
      backendSockets.add(socket.id)
      console.log(`[realtime] backend registered: ${socket.id}`)
    }
  })

  // Backend pushes a progress update → broadcast to subscribers.
  socket.on('push-progress', (data: any) => {
    if (!backendSockets.has(socket.id)) return
    if (!data?.messageId) return
    progressStore.set(data.messageId, data)
    io.to(`message:${data.messageId}`).emit('progress', data)
    if (data.chatId) {
      io.to(`chat:${data.chatId}`).emit('progress', data)
    }
    if (data.status === 'ready' || data.status === 'failed') {
      setTimeout(() => progressStore.delete(data.messageId), 60000)
    }
  })

  // Browser subscription.
  socket.on('subscribe', (data: { messageId?: string; chatId?: string }) => {
    if (data.messageId) {
      socket.join(`message:${data.messageId}`)
      const latest = progressStore.get(data.messageId)
      if (latest) socket.emit('progress', latest)
    }
    if (data.chatId) socket.join(`chat:${data.chatId}`)
  })

  socket.on('unsubscribe', (data: { messageId?: string; chatId?: string }) => {
    if (data.messageId) socket.leave(`message:${data.messageId}`)
    if (data.chatId) socket.leave(`chat:${data.chatId}`)
  })

  socket.on('disconnect', () => {
    backendSockets.delete(socket.id)
    console.log(`[realtime] client disconnected: ${socket.id}`)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[realtime] WanVid progress service running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
