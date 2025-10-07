// Web Worker for scanning files in folder selection mode
// Performs batch processing, sends progress and heartbeat messages, and returns processed results

const allowedExts = new Set(['.srt', '.vtt', '.ass', '.ssa'])
const MAX_SIZE = 1024 * 1024 // 1MB

function extractVideoId(name) {
  // 简化版本：假设文件已通过 rename_subtitle_files.py 脚本预处理
  // 只需要去除扩展名并进行基本格式校验
  const base = (name || '').replace(/\.[^/.]+$/, '')
  
  // 基本格式校验：只允许英文字母、数字、连字符、下划线和英文括号
  if (!/^[a-zA-Z0-9\-_()]+$/.test(base)) {
    return null
  }
  
  // 直接返回处理后的文件名作为视频ID
  return base.toUpperCase()
}

function extPriority(name) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'srt') return 0
  if (ext === 'vtt') return 1
  if (ext === 'ass' || ext === 'ssa') return 2
  return 9
}

let heartbeatTimer = null
let canceled = false

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

self.onmessage = async (evt) => {
  const { type, payload } = evt.data || {}
  if (type === 'cancel') {
    canceled = true
    clearHeartbeat()
    return
  }
  if (type !== 'start') return

  try {
    const { filesMeta = [], batchSize = 100, heartbeatInterval = 500 } = payload || {}
    const totalCount = Array.isArray(filesMeta) ? filesMeta.length : 0
    let processedCount = 0
    let batchCount = 0
    const processed = []
    const invalidSet = new Set()

    // Heartbeat
    clearHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (canceled) return
      self.postMessage({ type: 'heartbeat', ts: Date.now() })
    }, Math.max(100, heartbeatInterval))

    // Processing
    for (let i = 0; i < filesMeta.length; i += batchSize) {
      if (canceled) break
      const batch = filesMeta.slice(i, i + batchSize)
      batchCount++

      for (const meta of batch) {
        const name = meta.name || ''
        const size = meta.size || 0
        const ext = '.' + (name.split('.').pop() || '').toLowerCase()
        if (!allowedExts.has(ext)) continue
        if (size > MAX_SIZE) continue

        const videoId = extractVideoId(name)
        if (!videoId) invalidSet.add(name)
        processed.push({
          index: meta.index,
          fileName: name,
          videoId,
          size,
          status: videoId ? 'valid' : 'invalid'
        })
      }

      processedCount = Math.min(i + batchSize, filesMeta.length)
      const percentage = Math.floor((processedCount / totalCount) * 80) // up to 80% during processing
      self.postMessage({
        type: 'progress',
        payload: {
          stage: 'processing',
          processedCount,
          totalCount,
          percentage,
          invalidCount: invalidSet.size,
          batchCount
        }
      })
    }

    if (!canceled) {
      // Sort stage
      processed.sort((a, b) => {
        const byId = (a.videoId || '').localeCompare(b.videoId || '')
        if (byId !== 0) return byId
        const byExt = extPriority(a.fileName) - extPriority(b.fileName)
        if (byExt !== 0) return byExt
        return (a.fileName || '').localeCompare(b.fileName || '')
      })

      self.postMessage({
        type: 'progress',
        payload: {
          stage: 'sort',
          processedCount,
          totalCount,
          percentage: 90,
          invalidCount: invalidSet.size,
          batchCount
        }
      })

      // Done
      self.postMessage({
        type: 'done',
        payload: {
          processed,
          invalidFileNames: Array.from(invalidSet)
        }
      })
    }
  } catch (err) {
    self.postMessage({ type: 'error', payload: { message: err?.message || 'Worker error' } })
  } finally {
    clearHeartbeat()
  }
}