// Web Worker for scanning files in folder selection mode
// Performs batch processing, sends progress and heartbeat messages, and returns processed results

const allowedExts = new Set(['.srt', '.vtt', '.ass', '.ssa'])
const MAX_SIZE = 1024 * 1024 // 1MB

function extractVideoId(name) {
  const base = (name || '').replace(/\.[^/.]+$/, '')
  
  // 特殊格式处理
  // 1. (1pondo)(061016_314)コスプレイヤーをお貸しします 川越ゆい -> PONDO-061016_314
  let m = base.match(/\(1pondo\)\((\d{6}_\d{3})\)/i)
  if (m) return `PONDO-${m[1]}`
  
  // 2. 1Pondo-030615_039 秋野千尋 -> PONDO-030615_039
  m = base.match(/1Pondo-(\d{6}_\d{3})/i)
  if (m) return `PONDO-${m[1]}`
  
  // 3. 022720_979-1pon -> PON-022720_979
  m = base.match(/(\d{6}_\d{3})-1pon/i)
  if (m) return `PON-${m[1]}`
  
  // 4. 040816_276-1pon-1080p -> PON-040816_276
  m = base.match(/(\d{6}_\d{3})-1pon/i)
  if (m) return `PON-${m[1]}`
  
  // 5. 050420_01-10mu-1080p -> MU-050420_01
  m = base.match(/(\d{6}_\d{2})-10mu/i)
  if (m) return `MU-${m[1]}`
  
  // 6. 051620_01-10mu -> MU-051620_01
  m = base.match(/(\d{6}_\d{2})-10mu/i)
  if (m) return `MU-${m[1]}`
  
  // 7. Carib-070417-455 朝桐光 -> CARIB-070417_455
  m = base.match(/^Carib-(\d{6})-(\d{3})/i)
  if (m) return `CARIB-${m[1]}_${m[2]}`
  
  // 8. 080616-225-carib-1080p -> CARIB-080616_225
  m = base.match(/(\d{6})-(\d{3})-carib/i)
  if (m) return `CARIB-${m[1]}_${m[2]}`
  
  // 9. 081520_344-paco-1080p -> PACO-081520_344
  m = base.match(/(\d{6}_\d{3})-paco/i)
  if (m) return `PACO-${m[1]}`
  
  // 10. 112615_431-caribpr-high -> CARIBPR-112615_431
  m = base.match(/(\d{6}_\d{3})-caribpr/i)
  if (m) return `CARIBPR-${m[1]}`
  
  // 10. n0310 -> N0310
  m = base.match(/^n(\d{4})$/i)
  if (m) return `N${m[1]}`
  
  // 11. N0417 -> N0417 (已经是正确格式)
  m = base.match(/^N(\d{4})$/i)
  if (m) return `N${m[1]}`
  
  // 12. Tokyo-Hot-n1004 -> N1004
  m = base.match(/Tokyo-Hot-n(\d{4})/i)
  if (m) return `N${m[1]}`
  
  // 13. Tokyo-Hot_k1179餌食牝_美咲結衣 -> K1179
  m = base.match(/Tokyo-Hot[_-]k(\d{4})/i)
  if (m) return `K${m[1]}`
  
  // 14. 010210-259 -> 010210-259 (保持原格式)
  m = base.match(/^(\d{6}-\d{3})/)
  if (m) return m[1]
  
  // 15. 012415_01 -> 012415-01 (下划线转连字符)
  m = base.match(/^(\d{6})_(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}`
  
  // 16. 080416_353 -> 080416-353 (下划线转连字符，3位数字)
  m = base.match(/^(\d{6})_(\d{3})$/)
  if (m) return `${m[1]}-${m[2]}`
  
  // 17. 050717_524 - chs -> 050717-524 (带语言后缀)
  m = base.match(/^(\d{6})_(\d{2,3})\s*-?\s*(chs|cht)$/i)
  if (m) return `${m[1]}-${m[2]}`
  
  // 18. 050717_524cht -> 050717-524 (直接连接语言后缀)
  m = base.match(/^(\d{6})_(\d{2,3})(chs|cht)$/i)
  if (m) return `${m[1]}-${m[2]}`
  
  // 19. 072415_928-carib-CHS -> CARIB-072415_928 (carib格式带语言后缀)
  m = base.match(/^(\d{6})_(\d{3})-carib-(chs|cht)$/i)
  if (m) return `CARIB-${m[1]}_${m[2]}`
  
  // 20. 080416_353 今夏來海灘超嗨亂交！ 真琴涼 希咲彩 蒼井櫻 -> 080416-353 (带中文描述)
  m = base.match(/^(\d{6})_(\d{2,3})\s+[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/)
  if (m) return `${m[1]}-${m[2]}`
  
  // 21. 100516_398  -> 100516-398 (带空格)
  m = base.match(/^(\d{6})_(\d{2,3})\s*$/)
  if (m) return `${m[1]}-${m[2]}`
  
  // 22. 1pondo – 061014_824 – Nami Itoshino -> PONDO-061014_824 (带破折号和描述)
  m = base.match(/1pondo\s*[–-]\s*(\d{6}_\d{3})/i)
  if (m) return `PONDO-${m[1]}`
  
  // 23. 1Pondo_081418_728 -> PONDO-081418_728 (下划线连接)
  m = base.match(/^1Pondo_(\d{6}_\d{3})/i)
  if (m) return `PONDO-${m[1]}`
  
  // 原有逻辑保持不变
  m = base.match(/([a-z]+)-(\d{2,5})/i)
  if (m) return `${m[1]}-${m[2]}`.toUpperCase()
  
  m = base.match(/([a-z]+)(\d{2,5})/i)
  if (m) return `${m[1]}-${m[2]}`.toUpperCase()
  
  m = base.match(/([a-z]+)\s+(\d{2,5})/i)
  if (m) return `${m[1]}-${m[2]}`.toUpperCase()
  
  return null
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