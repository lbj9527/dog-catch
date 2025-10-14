<template>
  <div class="usage-monitoring page">
    <!-- 顶部区域 -->
    <div class="topbar">
      <div class="title">安全监控</div>
      <div class="actions">
        <label>时间范围：</label>
        <select class="select" v-model="selectedTimeRange" @change="loadStats">
          <option value="24h">24小时</option>
          <option value="7d">7天</option>
          <option value="30d">30天</option>
        </select>
        <span :class="['status', paused ? 'disconnected' : (isConnected ? 'connected' : 'disconnected')]">
          {{ paused ? '已暂停' : (isConnected ? '已连接' : '未连接') }}
        </span>
        <button class="button secondary" @click="refreshStats">刷新统计</button>
        <button class="button" @click="togglePause">{{ paused ? '恢复实时' : '暂停实时' }}</button>
        <button class="button secondary" @click="clearEvents">清空实时</button>
      </div>
    </div>

    <!-- 指标总览 -->
    <div class="cards" v-if="stats">
      <div class="card">
        <h3>总事件</h3>
        <div class="value">{{ stats.summary?.totalEvents ?? 0 }}</div>
      </div>
      <div class="card">
        <h3>独立用户</h3>
        <div class="value">{{ stats.summary?.uniqueUsers ?? 0 }}</div>
      </div>
      <div class="card">
        <h3>独立视频</h3>
        <div class="value">{{ stats.summary?.uniqueVideos ?? 0 }}</div>
      </div>
      <div class="card">
        <h3>热门IP数</h3>
        <div class="value">{{ stats.topIPs?.length ?? 0 }}</div>
      </div>
    </div>

    <!-- 主体双列 -->
    <div class="page-grid">
      <!-- 左列 -->
      <div class="left">
        <div class="panel" v-if="stats">
          <div class="charts-row">
            <div class="chart" v-if="stats.hourlyDistribution && stats.hourlyDistribution.length">
              <h3>小时分布</h3>
              <div class="bars">
                <div class="bar-wrap" v-for="hour in stats.hourlyDistribution" :key="hour.hour">
                  <div class="bar" :style="{ height: getBarHeight(hour.count) + '%' }" :title="`${hour.hour}:00 - ${hour.count}`"></div>
                  <div class="bar-label" :style="{ bottom: `calc(${getBarHeight(hour.count)}% + 4px)` }">{{ hour.count }}</div>
                </div>
              </div>
              <div class="axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
            </div>
            <div class="chart" v-if="stats.eventTypes && stats.eventTypes.length">
              <h3>事件类型分布</h3>
              <div class="bars">
                <div class="bar-wrap" v-for="t in stats.eventTypes" :key="t.event_type">
                  <div class="bar" :style="{ height: getTypeBarHeight(t.count) + '%' }" :title="`${getEventTypeName(t.event_type)}: ${t.count}`"></div>
                  <div class="bar-label" :style="{ bottom: `calc(${getTypeBarHeight(t.count)}% + 4px)` }">{{ t.count }}</div>
                </div>
              </div>
              <div class="axis">
                <span v-for="t in stats.eventTypes" :key="t.event_type">{{ getEventTypeName(t.event_type) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="panel" v-if="stats && stats.topVideos && stats.topVideos.length">
          <h3>Top 视频</h3>
          <div class="top-videos-grid">
            <div class="video-item" v-for="video in stats.topVideos" :key="video.video_id">
              <div>
                <div class="video-id">{{ video.video_id }}</div>
                <div class="video-meta">最近活跃：{{ formatTime(video.last_active || video.lastActive) }}</div>
                <div class="video-tags">
                  <span class="tag">事件数 {{ video.access_count ?? video.count }}</span>
                  <span class="tag">独立用户 {{ video.unique_users ?? video.uniqueUsers }}</span>
                </div>
              </div>
              <button class="button secondary" @click="copyVideoId(video.video_id)">复制ID</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右列 -->
      <div class="right sticky-panel">
        <div class="panel">
          <div class="tabs">
            <div class="tab" :class="{ active: activeRightTab === 'users' }" @click="activeRightTab = 'users'">Top 用户</div>
            <div class="tab" :class="{ active: activeRightTab === 'ips' }" @click="activeRightTab = 'ips'">Top IP</div>
          </div>
          <div>
            <div class="list" v-if="activeRightTab === 'users' && stats && stats.topUsers && stats.topUsers.length">
              <div class="list-item" v-for="user in stats.topUsers" :key="user.user_id">
                <div>{{ user.username || `用户${user.user_id}` }}</div>
                <div class="meta">事件 {{ user.activity_count }} · 独立视频 {{ user.unique_videos }}</div>
              </div>
            </div>
            <div v-else-if="activeRightTab === 'users'" class="no-events">暂无数据</div>
            <div class="list" v-if="activeRightTab === 'ips' && stats && stats.topIPs && stats.topIPs.length">
              <div class="list-item" v-for="ip in stats.topIPs" :key="ip.ip_address">
                <div>{{ formatIP(ip.ip_address) }}</div>
                <div class="meta">事件 {{ ip.count }} · 独立用户 {{ ip.unique_users }}</div>
              </div>
            </div>
            <div v-else-if="activeRightTab === 'ips'" class="no-events">暂无数据</div>
          </div>
        </div>

        <div class="panel">
          <h3>实时事件流 
            <span :class="['status', paused ? 'disconnected' : (isConnected ? 'connected' : 'disconnected')]" style="margin-left: 8px">
              {{ paused ? '已暂停' : (isConnected ? '已连接' : '未连接') }}
            </span>
          </h3>
          <div class="toolbar">
            <input v-model="eventFilter" class="input" placeholder="按类型/视频ID过滤" />
          </div>
          <div class="events">
            <div v-if="filteredEvents.length === 0" class="no-events">暂无实时事件</div>
            <div v-else>
              <div class="event-item" v-for="event in filteredEvents" :key="event.id">
                <div class="event-header">
                  <span>{{ getEventTypeName(event.event_type) }}</span>
                  <span class="event-time">{{ formatTime(event.created_at) }}</span>
                </div>
                <div class="event-details">
                  <span class="tag">视频ID: {{ event.video_id }}</span>
                  <span v-if="event.user_id" class="tag">用户: {{ getUserLabel(event.user_id) }}</span>
                  <span class="tag">IP: {{ formatIP(event.ip_address) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import usageMonitorAPI from '../utils/usageMonitorApi'

export default {
  name: 'UsageMonitoring',
  data() {
    return {
      stats: null,
      selectedTimeRange: '24h',
      realtimeEvents: [],
      eventSource: null,
      isConnected: false,
      maxEvents: 50, // 最多显示50个实时事件
      paused: false,
      eventFilter: '',
      activeRightTab: 'users',
      userNameMap: {}
    }
  },
  async mounted() {
    await this.loadStats()
    await this.loadRecentEvents()
    this.connectEventStream()
  },
  beforeUnmount() {
    this.disconnectEventStream()
  },
  methods: {
    formatIP(ip) {
      if (!ip) return '—'
      // IPv6 loopback variants => IPv4 loopback
      if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return '127.0.0.1'
      // IPv6-mapped IPv4, e.g. ::ffff:127.0.0.1
      const mapped = ip.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
      if (mapped) return mapped[1]
      return ip
    },
    async loadStats() {
      try {
        const data = await usageMonitorAPI.getStats(this.selectedTimeRange)
        this.stats = data
        // 根据 Top 用户列表构建 user_id -> username 映射
        this.buildUserNameMap()
      } catch (error) {
        console.error('加载统计数据失败:', error)
        this.$message.error('加载统计数据失败')
      }
    },

    async loadRecentEvents() {
      try {
        const data = await usageMonitorAPI.getRecentEvents({ limit: this.maxEvents, timeRange: '24h' })
        const events = Array.isArray(data?.events) ? data.events : []
        // 将最近事件按时间倒序加入，确保最新在最前
        this.realtimeEvents = events.map(e => ({
          ...e,
          // 兜底 created_at
          created_at: e.created_at || new Date().toISOString(),
          // 兜底 id
          id: e.id || `${e.event_type || 'event'}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
        }))
      } catch (err) {
        console.error('加载最近事件失败:', err)
      }
    },
    
    connectEventStream() {
      try {
        this.eventSource = usageMonitorAPI.createEventStream()
        
        this.eventSource.onopen = () => {
          this.isConnected = true
          console.log('SSE连接已建立')
        }
        
        this.eventSource.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (this.paused) return
            // 仅处理后端广播的使用事件，其它类型（heartbeat/connected）忽略
            if (payload && payload.type === 'usage_event' && payload.data) {
              this.addRealtimeEvent(payload.data)
            } else if (payload && payload.type === 'connected') {
              this.isConnected = true
            }
          } catch (error) {
            console.error('解析事件数据失败:', error)
          }
        }
        
        this.eventSource.onerror = (error) => {
          console.error('SSE连接错误:', error)
          this.isConnected = false
          // 尝试重连
          setTimeout(() => {
            if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
              this.connectEventStream()
            }
          }, 5000)
        }
      } catch (error) {
        console.error('创建SSE连接失败:', error)
        this.$message.error('无法连接实时事件流')
      }
    },
    
    addRealtimeEvent(event) {
      if (!event) return
      // 到达事件若携带 username，则补充映射
      if (event.username && event.user_id != null && !this.userNameMap[event.user_id]) {
        this.userNameMap[event.user_id] = event.username
      }
      // 缺省 created_at
      if (!event.created_at) {
        event.created_at = new Date().toISOString()
      }
      // 缺省 id
      if (!event.id) {
        event.id = `${event.event_type || 'event'}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
      }
      // 去重：若已有同 id，则跳过
      const exists = this.realtimeEvents.some(e => e.id === event.id)
      if (exists) return

      // 插入到最前
      this.realtimeEvents.unshift(event)
      
      // 维持最大长度
      if (this.realtimeEvents.length > this.maxEvents) {
        this.realtimeEvents = this.realtimeEvents.slice(0, this.maxEvents)
      }
    },
    
    formatTime(timeValue) {
      if (!timeValue) return '—'
      let date
      if (typeof timeValue === 'number') {
        date = new Date(timeValue)
      } else if (typeof timeValue === 'string') {
        const num = Number(timeValue)
        if (!Number.isNaN(num) && timeValue.trim() !== '') {
          date = new Date(num)
        } else {
          date = new Date(timeValue)
        }
      } else if (timeValue instanceof Date) {
        date = timeValue
      } else {
        return '—'
      }
      if (isNaN(date.getTime())) {
        return 'Invalid Date'
      }
      return date.toLocaleTimeString('zh-CN', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    },
    disconnectEventStream() {
      if (this.eventSource) {
        this.eventSource.close()
        this.eventSource = null
        this.isConnected = false
      }
    },
    
    getEventTypeName(eventType) {
      const eventTypeNames = {
        'subtitle_access': '字幕访问',
        'video_view_report': '观看报告'
      }
      return eventTypeNames[eventType] || eventType
    },
    
    getBarHeight(count) {
      if (!this.stats || !this.stats.hourlyDistribution) return 0
      const maxCount = Math.max(...this.stats.hourlyDistribution.map(h => h.count))
      return maxCount > 0 ? (count / maxCount) * 100 : 0
    },
    togglePause() {
      this.paused = !this.paused
    },
    clearEvents() {
      this.realtimeEvents = []
    },
    async refreshStats() {
      await this.loadStats()
    },
    copyVideoId(id) {
      if (!id) return
      navigator.clipboard?.writeText(String(id)).catch(() => {})
    },
    getTypeBarHeight(count) {
      if (!this.stats || !this.stats.eventTypes) return 0
      const maxCount = Math.max(...this.stats.eventTypes.map(t => t.count))
      return maxCount > 0 ? (count / maxCount) * 100 : 0
    },
    // 在 methods 中新增：用户ID -> 用户名 映射与显示
    getUserLabel(id) {
      if (id == null) return '—'
      const name = this.userNameMap[id]
      return name || `用户${id}`
    },
    buildUserNameMap() {
      const map = {}
      const list = this.stats?.topUsers || []
      list.forEach(u => {
        if (u && u.user_id != null) {
          map[u.user_id] = u.username || `用户${u.user_id}`
        }
      })
      this.userNameMap = map
    }
  },
  computed: {
    filteredEvents() {
      const q = (this.eventFilter || '').trim()
      if (!q) return this.realtimeEvents
      return this.realtimeEvents.filter(e =>
        String(e.event_type || '').includes(q) || String(e.video_id || '').includes(q)
      )
    }
  }
}
</script>

<style scoped>
.usage-monitoring {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header h2 {
  margin: 0;
  color: #333;
}

.time-range-selector {
  display: flex;
  align-items: center;
  gap: 10px;
}

.time-range-selector label {
  font-weight: 500;
}

.time-range-selector select {
  padding: 5px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
}

.stats-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.stat-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  text-align: center;
}

.stat-card h3 {
  margin: 0 0 10px 0;
  color: #666;
  font-size: 14px;
  font-weight: 500;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
  color: #333;
}

.event-types, .top-videos, .real-time-events, .top-users, .hourly-stats, .ip-stats {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 20px;
}

.event-types h3, .top-videos h3, .real-time-events h3, .top-users h3, .hourly-stats h3, .ip-stats h3 {
  margin: 0 0 15px 0;
  color: #333;
  display: flex;
  align-items: center;
  gap: 10px;
}

.connection-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: normal;
}

.connection-status.connected {
  background: #e8f5e8;
  color: #2e7d32;
}

.connection-status.disconnected {
  background: #ffebee;
  color: #c62828;
}

.event-type-list, .video-list, .user-list, .ip-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.event-type-item, .video-item, .user-item, .ip-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 4px;
}

.event-name, .video-id, .username, .ip-address {
  font-weight: 500;
}

.event-count, .video-count, .user-activity, .ip-activity {
  color: #666;
  font-size: 14px;
}

.hourly-chart {
  display: flex;
  align-items: end;
  gap: 4px;
  height: 200px;
  padding: 10px 0;
}

.hour-bar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.bar {
  background: #409eff;
  width: 100%;
  min-height: 2px;
  border-radius: 2px 2px 0 0;
  margin-bottom: 5px;
}

.hour-label {
  font-size: 10px;
  color: #666;
  margin-bottom: 2px;
}

.hour-count {
  font-size: 10px;
  color: #333;
  font-weight: 500;
}

.events-container {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 4px;
}

.no-events {
  padding: 20px;
  text-align: center;
  color: #999;
}

.event-item {
  padding: 12px;
  border-bottom: 1px solid #eee;
}

.event-item:last-child {
  border-bottom: none;
}

.event-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.event-type {
  font-weight: 500;
  color: #333;
}

.event-time {
  font-size: 12px;
  color: #666;
}

.event-details {
  display: flex;
  gap: 15px;
  font-size: 12px;
  color: #666;
}

.event-details span {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
}
.page { padding: 0 20px 20px 20px; width: 100%; margin: 0; }
.topbar { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; margin-bottom: 16px; }
.title { font-size: 20px; font-weight: 600; }
.actions { display: flex; gap: 8px; align-items: center; }
.select, .input, .button { padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; background: #fff; font-size: 14px; }
.button { background: #409eff; color: #fff; border-color: #409eff; cursor: pointer; }
.button.secondary { background: #fff; color: #333; border-color: #ddd; }
.status { font-size: 12px; padding: 4px 10px; border-radius: 14px; }
.status.connected { background: #e8f5e8; color: #2e7d32; }
.status.disconnected { background: #ffebee; color: #c62828; }

.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.card { background: #fff; border: 1px solid #e5e9ef; border-radius: 10px; padding: 16px; }
.card h3 { margin: 0 0 6px; font-size: 13px; color: #666; font-weight: 500; }
.card .value { font-size: 26px; font-weight: 700; }

.page-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
.panel { background: #fff; border: 1px solid #e5e9ef; border-radius: 10px; padding: 16px; }
.panel h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }

.charts-row { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
.chart { height: 240px; }
.chart .bars { display: flex; align-items: flex-end; gap: 6px; height: 180px; padding: 8px 0; }
.chart .bar { background: #409eff; width: 100%; min-height: 2px; border-radius: 3px 3px 0 0; }
.chart .bar-wrap { position: relative; flex: 1; height: 100%; }
.chart .bar-wrap .bar { position: absolute; bottom: 0; left: 0; right: 0; }
.chart .bar-label { position: absolute; left: 50%; transform: translateX(-50%); font-size: 11px; color: #666; white-space: nowrap; }
.chart .axis { display: flex; justify-content: space-between; font-size: 11px; color: #666; }

.top-videos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.video-item { border: 1px solid #e5e9ef; border-radius: 8px; padding: 10px; display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
.video-id { font-weight: 600; }
.video-meta { font-size: 12px; color: #666; display: flex; gap: 8px; }
.video-tags { display: flex; gap: 6px; }
.tag { background: #f0f2f5; color: #666; font-size: 12px; padding: 2px 6px; border-radius: 4px; }

.sticky-panel { position: sticky; top: 20px; }
.events { max-height: 65vh; overflow-y: auto; border: 1px solid #e5e9ef; border-radius: 8px; }
.event-item { padding: 10px 12px; border-bottom: 1px solid #e5e9ef; }
.event-item:last-child { border-bottom: none; }
.event-header { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
.event-time { color: #666; }
.event-details { display: flex; gap: 8px; font-size: 12px; color: #666; flex-wrap: wrap; }

.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }

.tabs { display: flex; gap: 8px; border-bottom: 1px solid #e5e9ef; margin-bottom: 10px; }
.tab { padding: 8px 12px; cursor: pointer; font-size: 14px; }
.tab.active { border-bottom: 2px solid #409eff; color: #409eff; }
.list { display: flex; flex-direction: column; gap: 8px; }
.list-item { display: flex; justify-content: space-between; padding: 8px 12px; border: 1px solid #e5e9ef; border-radius: 8px; }
.list-item .meta { color: #666; font-size: 12px; }

@media (max-width: 1399px) { .chart { height: 220px; } }
@media (max-width: 992px) {
  .cards { grid-template-columns: repeat(2, 1fr); }
  .page-grid { grid-template-columns: 1fr; }
  .charts-row { grid-template-columns: 1fr; }
  .top-videos-grid { grid-template-columns: 1fr; }
  .sticky-panel { position: static; }
  .events { max-height: none; }
}
</style>