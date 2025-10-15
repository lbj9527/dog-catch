import api from './api'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const usageMonitorAPI = {
  getStats(timeRange = '24h') {
    return api.get('/api/admin/usage/stats', {
      params: { timeRange }
    })
  },
  
  // 新增：查询最近事件
  getRecentEvents(params = {}) {
    const { limit = 50, timeRange = '24h', before_id, before_created_at } = params
    return api.get('/api/admin/usage/events/recent', {
      params: { limit, timeRange, before_id, before_created_at }
    })
  },

  // 管理端 SSE 事件流
  createEventStream() {
    const token = localStorage.getItem('admin_token')
    const url = `${API_BASE_URL}/api/admin/usage/events${token ? `?token=${encodeURIComponent(token)}` : ''}`
    return new EventSource(url)
  }
}

export default usageMonitorAPI