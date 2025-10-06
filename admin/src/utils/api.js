import axios from 'axios'
import { ElMessage } from 'element-plus'

// 新增：从环境变量读取后端 API 基地址（开发/生产可切换）
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

// 创建axios实例
const api = axios.create({
  baseURL: API_BASE_URL, // 后端API地址
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
api.interceptors.request.use(
  config => {
    const token = localStorage.getItem('admin_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  response => {
    return response.data
  },
  error => {
    const { response } = error
    
    if (response) {
      switch (response.status) {
        case 401:
          ElMessage.error('登录已过期，请重新登录')
          localStorage.removeItem('admin_token')
          localStorage.removeItem('admin_user')
          window.location.href = '/login'
          break
        case 403:
          ElMessage.error('没有权限访问')
          break
        case 404:
          ElMessage.error('请求的资源不存在')
          break
        case 500:
          ElMessage.error('服务器内部错误')
          break
        default:
          ElMessage.error(response.data?.error || '请求失败')
      }
    } else {
      ElMessage.error('网络连接失败')
    }
    
    return Promise.reject(error)
  }
)

// API方法
export const authAPI = {
  // 登录
  login(credentials) {
    return api.post('/api/auth/login', credentials)
  },
  
  // 验证token
  verify() {
    return api.get('/api/auth/verify')
  }
}

export const subtitleAPI = {
  // 获取字幕列表
  getList(params = {}) {
    return api.get('/api/subtitles', { params })
  },
  
  // 获取单个字幕
  getSubtitle(videoId) {
    return api.get(`/api/subtitle/${videoId}`)
  },
  
  // 上传字幕
  upload(videoId, file) {
    const formData = new FormData()
    formData.append('subtitle', file)
    
    return api.post(`/api/subtitle/${videoId}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
  },
  
  // 更新字幕
  update(videoId, file) {
    const formData = new FormData()
    formData.append('subtitle', file)
    
    return api.put(`/api/subtitle/${videoId}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
  },
  
  // 删除字幕
  delete(videoId) {
    return api.delete(`/api/subtitle/${videoId}`)
  },

  // 批量删除字幕
  bulkDelete(videoIds) {
    return api.request({
      method: 'delete',
      url: '/api/subtitles',
      data: { video_ids: videoIds }
    })
  },

  // 全部删除字幕
  deleteAll() {
    return api.delete('/api/subtitles/all', {
      timeout: 120000 // 增加超时时间到120秒
    })
  },

  // 获取删除状态
  getDeleteStatus() {
    return api.get('/api/subtitles/delete-status')
  },

  // 批量上传字幕（心愿单）
  batchUpload(formData) {
    return api.post('/api/admin/subtitles/batch-upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 60000 // 增加超时时间到60秒
    })
  },

  // 获取统计
  getStats(params = {}) {
    return api.get('/api/subtitles/stats', { params })
  }
}

// 新增：心愿单管理 API（管理端）
export const wishlistAPI = {
  // 获取心愿单列表（cursor 分页）
  getList(params = {}) {
    // params: { cursor?: string, limit?: number }
    return api.get('/api/admin/wishlists', { params })
  },

  // 更新心愿单状态
  updateStatus(id, status) {
    return api.patch(`/api/admin/wishlists/${id}`, { status })
  },

  // 新增：导出未更新心愿单（使用 fetch 以保留响应头部并获取文件名）
  async exportUnupdated() {
    const token = localStorage.getItem('admin_token')
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const resp = await fetch(`${API_BASE_URL}/api/admin/wishlists/export/unupdated`, {
      method: 'GET',
      headers
    })

    if (resp.status === 401) {
      ElMessage.error('登录已过期，请重新登录')
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_user')
      window.location.href = '/login'
      throw new Error('未授权')
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(text || `下载失败，HTTP ${resp.status}`)
    }

    const blob = await resp.blob()
    const cd = resp.headers.get('Content-Disposition') || ''
    const match = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/)
    let filename = 'wishlist-unupdated.json'
    if (match) filename = decodeURIComponent(match[1] || match[2] || filename)

    return { blob, filename, contentDisposition: cd }
  }
}

// 通知管理API
export const notificationAPI = {
  // 发送系统广播通知
  broadcast(data) {
    return api.post('/api/admin/notifications/broadcast', data)
  },
  
  // 获取通知统计
  getStats() {
    return api.get('/api/admin/notifications/stats')
  },
  
  // 获取通知列表（管理员视角）
  getList(params = {}) {
    return api.get('/api/admin/notifications', { params })
  },
  
  // 删除通知
  delete(id) {
    return api.delete(`/api/admin/notifications/${id}`)
  }
}

export default api