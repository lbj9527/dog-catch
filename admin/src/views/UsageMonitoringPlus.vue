<template>
  <div class="usage-monitor-plus">
    <div class="header">
      <div class="header-inner">
        <div class="title">安全监测（加强版）</div>
        <div class="subtitle">字幕访问频率 · 报警 · 手动封禁（显示最近24小时）</div>
        <div style="flex:1"></div>
        <!-- 已移除时间范围下拉框，改为默认近24小时 -->
        
        <button class="button secondary" @click="toggleThresholds" :aria-expanded="String(showThresholds)">{{ showThresholds ? '关闭设定' : '阈值设定' }}</button>
        <button class="button secondary" @click="refreshData">刷新数据</button>
        <span :class="['status', isConnected ? 'ok' : 'danger']" style="margin-left:8px">{{ isConnected ? '实时已连接' : '未连接' }}</span>
      </div>
    </div>

    <div class="container">
      <div class="grid">
        <!-- 左列：统计与列表 -->
        <div>
          <div class="panel section" v-show="showThresholds">
            <h3>阈值与报警设定</h3>
            <div class="toolbar">
              <label class="tag">IP-10分钟请求阈值 <input class="input" type="number" v-model.number="thresholds.ip10m" style="width:90px"></label>
              <label class="tag">IP-1小时请求阈值 <input class="input" type="number" v-model.number="thresholds.ip1h" style="width:90px"></label>
              <label class="tag">IP-10分钟不同视频数 <input class="input" type="number" v-model.number="thresholds.ipVid10m" style="width:90px"></label>
              <label class="tag">用户-1小时请求阈值 <input class="input" type="number" v-model.number="thresholds.user1h" style="width:90px"></label>
              <label class="tag">IP-6小时请求阈值 <input class="input" type="number" v-model.number="thresholds.ip6h" style="width:90px"></label>
              <label class="tag">IP-12小时请求阈值 <input class="input" type="number" v-model.number="thresholds.ip12h" style="width:90px"></label>
              <label class="tag">用户-6小时请求阈值 <input class="input" type="number" v-model.number="thresholds.user6h" style="width:90px"></label>
              <label class="tag">用户-12小时请求阈值 <input class="input" type="number" v-model.number="thresholds.user12h" style="width:90px"></label>
              <button class="button primary" @click="applyThresholds">应用</button>
            </div>
            <div class="footnote">说明：数据来源于后端 usage_events（subtitle_access），当前前端对 1m/10m/1h 进行窗口聚合。</div>
          </div>

          <div class="panel section">
            <div class="cards">
              <div class="card"><div class="label">高风险 IP</div><div class="value">{{ summary.ipDanger }}</div></div>
              <div class="card"><div class="label">高风险 用户</div><div class="value">{{ summary.userDanger }}</div></div>
              <div class="card"><div class="label">预警 IP</div><div class="value">{{ summary.ipWarn }}</div></div>
              <div class="card"><div class="label">预警 用户</div><div class="value">{{ summary.userWarn }}</div></div>
            </div>
            <h3>频率统计</h3>
            <div class="tabs">
              <button class="tab" :class="{active: activeTab==='ip'}" @click="activeTab='ip'">按 IP</button>
              <button class="tab" :class="{active: activeTab==='user'}" @click="activeTab='user'">按 用户</button>
            </div>
            <div class="muted" style="margin:6px 0" v-if="isLoading">正在加载最近24小时事件…</div>
            <div class="muted" style="margin:6px 0" v-else>
              <!-- 自动加载已实现，移除“加载更多历史”按钮 -->
            </div>
            <div class="tab-panels">
              <div class="tab-panel" :class="{active: activeTab==='ip'}">
                <div class="toolbar stats">
                  <div class="toolbar-left">
                    <input class="input" v-model.trim="ipFilter" placeholder="按 IP/UA过滤">
                    <button class="button secondary" @click="ipFilter='';">清空过滤</button>
                  </div>
                  <div class="toolbar-right">
                    <button class="button danger" @click="banSelectedIPs">批量封禁所选IP</button>
                    <button class="button secondary" @click="exportIPView">导出当前IP视图</button>
                  </div>
                </div>
                <div class="table-scroll">
                  <table>
                    <colgroup>
                      <col style="width:60px"><!-- 选择 -->
                      <col style="width:280px"><!-- IP -->
                      <col style="width:70px"><!-- 1分钟 -->
                      <col style="width:80px"><!-- 10分钟 -->
                      <col style="width:80px"><!-- 1小时 -->
                      <col style="width:80px"><!-- 6小时 -->
                      <col style="width:80px"><!-- 12小时 -->
                      <col style="width:120px"><!-- 不同视频(1h) -->
                      <col style="width:80px"><!-- UA多样性 -->
                      <col style="width:80px"><!-- 风险评分 -->
                      <col style="width:140px"><!-- 标签 -->
                      <col style="width:90px"><!-- 状态 -->
                      <col style="width:260px"><!-- 操作 -->
                    </colgroup>
                    <thead>
                      <tr>
                        <th>选择</th>
                        <th>IP</th>
                        <th>1分钟</th>
                        <th>10分钟</th>
                        <th>1小时</th>
                        <th>6小时</th>
                        <th>12小时</th>
                        <th>不同视频(1h)</th>
                        <th>UA多样性</th>
                        <th>风险评分</th>
                        <th>标签</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in filteredIPRows" :key="row.ip">
                        <td class="select-cell"><input type="checkbox" v-model="row._selected"></td>
                        <td class="mono">{{ formatIP(row.ip) }} <span class="muted">({{ row.region || '-' }})</span></td>
                        <td>{{ row.m1 }}</td>
                        <td>{{ row.m10 }}</td>
                        <td>{{ row.h1 }}</td>
                        <td>{{ row.h6 }}</td>
                        <td>{{ row.h12 }}</td>
                        <td>{{ row.distinctVideosH1 }}</td>
                        <td>{{ row.uaDiversity }}</td>
                        <td :class="riskColorClass(row._risk)">{{ row._risk }}</td>
                        <td>
                          <span class="tag" v-for="t in row.tags" :key="t">{{ t }}</span>
                        </td>
                        <td :class="riskColorClass(row._risk)">{{ riskLabel(row._risk) }}</td>
                        <td>
                          <button class="button" @click="showIpDetail(row)">查看明细</button>
                          <button class="button danger" @click="banIP(row.ip)">封禁</button>
                        </td>
                      </tr>
                      <tr v-if="filteredIPRows.length===0"><td colspan="10" class="muted" style="text-align:center;padding:14px">暂无数据</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="tab-panel" :class="{active: activeTab==='user'}">
                <div class="toolbar stats">
                  <div class="toolbar-left">
                    <input class="input" v-model.trim="userFilter" placeholder="按用户ID/昵称过滤">
                    <button class="button secondary" @click="userFilter='';">清空过滤</button>
                  </div>
                  <div class="toolbar-right">
                    <button class="button danger" @click="deleteSelectedUsers">批量删除所选用户</button>
                    <button class="button secondary" @click="exportUserView">导出当前用户视图</button>
                  </div>
                </div>
                <div class="table-scroll">
                  <table>
                    <colgroup>
                      <col style="width:60px"><!-- 选择 -->
                      <col style="width:260px"><!-- 用户 -->
                      <col style="width:80px"><!-- 1小时 -->
                      <col style="width:80px"><!-- 6小时 -->
                      <col style="width:80px"><!-- 12小时 -->
                      <col style="width:120px"><!-- 不同视频(1h) -->
                      <col style="width:80px"><!-- IP数 -->
                      <col style="width:80px"><!-- 风险评分 -->
                      <col style="width:140px"><!-- 标签 -->
                      <col style="width:80px"><!-- 状态 -->
                      <col style="width:200px"><!-- 操作 -->
                    </colgroup>
                    <thead>
                      <tr>
                        <th>选择</th>
                        <th>用户</th>
                        <th>1小时</th>
                        <th>6小时</th>
                        <th>12小时</th>
                        <th>不同视频(1h)</th>
                        <th>IP数</th>
                        <th>风险评分</th>
                        <th>标签</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="u in filteredUserRows" :key="u.id">
                        <td class="select-cell"><input type="checkbox" v-model="u._selected"></td>
                        <td class="mono">{{ (u.name && u.name.trim()) ? u.name : ('用户'+u.id) }}</td>
                        <td>{{ u.h1 }}</td>
                        <td>{{ u.h6 }}</td>
                        <td>{{ u.h12 }}</td>
                        <td>{{ u.distinctVideosH1 }}</td>
                        <td>{{ u.ipCount }}</td>
                        <td :class="riskColorClass(u._risk)">{{ u._risk }}</td>
                        <td>
                          <span class="tag" v-for="t in u.tags" :key="t">{{ t }}</span>
                        </td>
                        <td :class="riskColorClass(u._risk)">{{ riskLabel(u._risk) }}</td>
                        <td>
                          <button class="button" @click="showUserDetail(u)">查看明细</button>
                          <button class="button danger" @click="deleteUser(u.id)">封禁</button>
                        </td>
                      </tr>
                      <tr v-if="filteredUserRows.length===0"><td colspan="8" class="muted" style="text-align:center;padding:14px">暂无数据</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右列：报警流 -->
        <div class="right-sticky">
          <div class="panel section">
            <h3>报警与事件</h3>
            <div id="alerts" class="alerts">
              <div v-if="alerts.length===0" class="muted">暂无报警</div>
              <div v-else class="alerts-wrap">
                <div class="tag" v-for="a in alerts" :key="a.key" :style="a.style">{{ a.text }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- 风险解释面板 -->
    <div v-if="showRiskDetail" class="modal-overlay" @click.self="closeDetail">
      <div class="modal-card">
        <div class="modal-header">
          <h3>{{ detailTitle }}</h3>
          <button class="button secondary" @click="closeDetail">关闭</button>
        </div>
        <div class="modal-body">
          <div v-if="riskDetail">
            <div class="muted" v-if="riskDetail.hardRuleTriggered">已触发硬规则：超过设定阈值，风险提升为至少 85</div>
            <table class="breakdown-table">
              <thead>
                <tr><th>项</th><th>值</th><th>阈值</th><th>权重/系数</th><th>分值</th></tr>
              </thead>
              <tbody>
                <tr v-for="c in riskDetail.components" :key="c.key">
                  <td class="mono">{{ c.key }}</td>
                  <td>{{ c.value ?? '-' }}</td>
                  <td>{{ c.threshold ?? '-' }}</td>
                  <td>{{ c.weight }}</td>
                  <td>{{ c.score }}</td>
                </tr>
              </tbody>
            </table>
            <div class="total-line">基础总分：{{ riskDetail.baseTotal }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import usageMonitorAPI from '../utils/usageMonitorApi'
import { userAdminAPI } from '../utils/userAdminApi'
import { computeIpRisk, computeUserRisk, computeIpBreakdown, computeUserBreakdown } from '../utils/riskScoring'

export default {
  name: 'UsageMonitoringPlus',
  data() {
    return {
      thresholds: { ip10m: 100, ip1h: 500, ip6h: 2000, ip12h: 3000, ipVid10m: 50, user1h: 300, user6h: 1200, user12h: 1800 },
      showThresholds: false,
      activeTab: 'ip',
      ipFilter: '',
      userFilter: '',
      ipRows: [],
      userRows: [],
      alerts: [],
      events: [],
      eventSource: null,
      // 新增：分页游标与加载状态
      nextCursor: null,
      isLoading: false,
      // 新增：风险解释面板状态
      showRiskDetail: false,
      riskDetail: null,
      detailTitle: '',
      detailType: '',
      isConnected: false,
      summary: { ipDanger: 0, userDanger: 0, ipWarn: 0, userWarn: 0 },
      // 新增：用户ID到用户名的本地缓存映射，避免显示为纯ID
      userNameById: {},
      // 新增：跨天轻量缓存（本地存储），记录最近活跃日期
      riskCache: { ip: {}, user: {}, lastCleanup: 0, ttlDays: 7 }
    }
  },
  async mounted() {
    // 预加载部分用户数据到缓存，提升用户名显示的命中率
    await this.loadUserCache()
    // 新增：加载持久化的阈值设定
    this.loadThresholds()
    // 新增：加载跨天缓存
    this.loadRiskCache()
    await this.loadInitialEvents()
    this.connectEventStream()
  },
  beforeUnmount() {
    this.disconnectEventStream()
  },
  computed: {
    filteredIPRows() {
      const q = (this.ipFilter || '').toLowerCase()
      return this.ipRows.filter(r => !q || r.ip.toLowerCase().includes(q) || String(r.uaDiversity).includes(q))
    },
    filteredUserRows() {
      const q = (this.userFilter || '').toLowerCase()
      return this.userRows.filter(r => !q || String(r.id).includes(q) || (r.name||'').toLowerCase().includes(q))
    }
  },
  // 新增：监听阈值输入变化，自动持久化，避免未点击“应用”时刷新丢失
  watch: {
    thresholds: {
      deep: true,
      handler() {
        this.saveThresholds()
      }
    }
  },
  methods: {
    // 新增：规范化视频ID，忽略空格并大小写不敏感
    normalizeVideoId(vidRaw) {
      if (vidRaw === null || vidRaw === undefined) return null
      try {
        const s = String(vidRaw).trim().toLowerCase()
        return s.length ? s : null
      } catch {
        return null
      }
    },
    // 新增：规范化用户ID，统一为字符串，避免 "1" 与 1 被当作不同键导致重复
    normalizeUserId(uidRaw) {
      if (uidRaw === null || uidRaw === undefined) return null
      try { return String(uidRaw).trim() } catch { return null }
    },
    // 新增：规范化 IP（合并 IPv6 映射到 IPv4），确保聚合键一致，避免同一 IP 出现两条记录
    normalizeIP(ipRaw) {
      try {
        const ip = String(ipRaw || '').trim()
        if (!ip) return 'unknown'
        if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return '127.0.0.1'
        const m = ip.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
        return m ? m[1] : ip
      } catch {
        return 'unknown'
      }
    },
    // 批量加载用户列表，建立 id -> username 缓存
    async loadUserCache() {
      try {
        const res = await userAdminAPI.getList({ page: 1, limit: 500 })
        const list = Array.isArray(res?.data) ? res.data : []
        const map = {}
        for (const u of list) {
          if (u && (u.id !== undefined && u.id !== null)) {
            map[String(u.id)] = u.username || ''
          }
        }
        this.userNameById = map
      } catch (e) {
        // 缓存加载失败不阻塞主流程
        console.warn('加载用户缓存失败:', e)
      }
    },
    formatIP(ip) {
      // 使用归一化后的 IP 进行展示，确保与聚合键一致
      return this.normalizeIP(ip)
    },
    onTimeRangeChange() {
      // 仅用于控制初始加载数据量；列展示始终依据当前时间的 1m/10m/1h 窗口
      this.loadInitialEvents()
    },
    // 时间范围选择已移除，默认加载近24小时数据
    async loadInitialEvents() {
      try {
        this.isLoading = true
        this.events = []
        this.nextCursor = null

        // 分页抓取：每页200条，直到覆盖24小时或没有下一页
        const cutoffMs = Date.now() - 24*60*60*1000
        let hasMore = true
        let before_id = undefined
        let before_created_at = undefined

        while (hasMore) {
          const pageSize = 200
          const data = await usageMonitorAPI.getRecentEvents({ limit: pageSize, timeRange: '24h', before_id, before_created_at })
          const events = Array.isArray(data?.events) ? data.events : []
          const mapped = events.map(e => ({
            ...e,
            created_ms: this.parseTimeMs(e.created_at),
            username: e.username || this.userNameById[this.normalizeUserId(e.user_id)] || ''
          }))
          // 追加到数组尾部，保持时间倒序整体（后端已按 created_at DESC,id DESC）
          this.events = this.events.concat(mapped)
          // 边拉边裁剪超出24小时的数据，保持内存稳定
          this.pruneOldEvents()

          // 计算下一页游标
          const cursor = data?.page?.next_cursor || null
          if (cursor && mapped.length === pageSize) {
            this.nextCursor = cursor
            before_id = cursor.before_id
            before_created_at = cursor.before_created_at
            // 若当前最末事件时间已早于24小时界限，则停止
            const last = this.events[this.events.length - 1]
            if (last && (last.created_ms || 0) < cutoffMs) {
              hasMore = false
            }
          } else {
            hasMore = false
          }
        }

        // 保留最近24小时并重建聚合
        this.pruneOldEvents()
        this.rebuildAggregations()
      } catch (e) {
        console.error('加载事件失败:', e)
      } finally {
        this.isLoading = false
      }
    },
    parseTimeMs(t) {
      if (!t) return Date.now()
      const d = new Date(t)
      return isNaN(d.getTime()) ? Date.now() : d.getTime()
    },
    connectEventStream() {
      try {
        this.eventSource = usageMonitorAPI.createEventStream()
        this.eventSource.onopen = () => { this.isConnected = true }
        this.eventSource.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (payload && payload.type === 'usage_event' && payload.data) {
              const e = payload.data
              e.created_ms = this.parseTimeMs(e.created_at)
              // 规范化与用户名补全
              const uidKey = this.normalizeUserId(e.user_id)
              if (!e.username && uidKey) {
                e.username = this.userNameById[uidKey] || ''
              }
              this.events.unshift(e)
              // 增大保留上限以容纳多页历史（轻量）：上限3000
              if (this.events.length > 3000) this.events.pop()
              this.pruneOldEvents()
              this.rebuildAggregations()
            }
          } catch (err) { console.error('SSE事件解析失败:', err) }
        }
        this.eventSource.onerror = () => { this.isConnected = false }
      } catch (err) {
        console.error('创建SSE失败:', err)
      }
    },
    disconnectEventStream() {
      if (this.eventSource) { this.eventSource.close(); this.eventSource = null; this.isConnected = false }
    },
    pruneOldEvents() {
      const now = Date.now()
      const cutoff = now - 24*60*60*1000 // 保留最近24小时事件，确保6h/12h窗口统计有效
      this.events = this.events.filter(e => (e.created_ms || 0) >= cutoff)
    },
    // 统一得分计算（迁移至 utils）：保留占位，旧引用不报错
    computeIpScoreBase(ip, thresholds){
      return computeIpRisk(ip, thresholds)
    },
    computeUserScoreBase(u, thresholds){
      return computeUserRisk(u, thresholds)
    },
    // 最终版本：调用 utils 计算分值
    calcIpRisk(ip){
      return computeIpRisk(ip, this.thresholds)
    },
    calcUserRisk(u){
      return computeUserRisk(u, this.thresholds)
    },
    rebuildAggregations() {
      const now = Date.now()
      const m1 = now - 60*1000
      const m10 = now - 10*60*1000
      const h1 = now - 60*60*1000
      const h6 = now - 6*60*60*1000
      const h12 = now - 12*60*60*1000

      const ipMap = new Map()
      const userMap = new Map()

      for (const e of this.events) {
        const ts = e.created_ms || now
        const ipKey = this.normalizeIP(e.ip_address)
        const uidKey = this.normalizeUserId(e.user_id)
        const vid = e.video_id
        const normVid = this.normalizeVideoId(vid)
        const ua = e.user_agent || ''

        // IP聚合（使用归一化键）
        if (!ipMap.has(ipKey)) ipMap.set(ipKey, { ip: ipKey, m1:0, m10:0, h1:0, h6:0, h12:0, distinctVideosH1Set:new Set(), uaSet:new Set(), region: '-' , tags: [], _selected:false })
        const ipRec = ipMap.get(ipKey)
        if (ts >= h12) ipRec.h12++
        if (ts >= h6) ipRec.h6++
        if (ts >= h1) {
          ipRec.h1++
          if (normVid) ipRec.distinctVideosH1Set.add(normVid)
          if (ua) ipRec.uaSet.add(ua)
        }
        if (ts >= m10) ipRec.m10++
        if (ts >= m1) ipRec.m1++

        // 用户聚合
        if (uidKey != null) {
          if (!userMap.has(uidKey)) userMap.set(uidKey, { id: uidKey, h1:0, h6:0, h12:0, vids:new Set(), ips:new Set(), name: this.userNameById[uidKey] || '', tags: [], _selected:false })
          const uRec = userMap.get(uidKey)
          if (ts >= h12) uRec.h12++
          if (ts >= h6) uRec.h6++
          if (ts >= h1) {
            uRec.h1++
            if (normVid) uRec.vids.add(normVid)
            if (ipKey && ipKey !== 'unknown') uRec.ips.add(ipKey)
          }
        }
      }

      const ipRows = Array.from(ipMap.values()).map(r => {
        const row = {
          ip: r.ip,
          m1: r.m1,
          m10: r.m10,
          h1: r.h1,
          h6: r.h6,
          h12: r.h12,
          distinctVideosH1: r.distinctVideosH1Set.size,
          uaDiversity: r.uaSet.size,
          region: r.region,
          _selected: false,
          tags: []
        }
        row._risk = this.calcIpRisk(row)
        const ipExceed = (
          (this.thresholds.ip10m > 0 && row.m10 >= this.thresholds.ip10m) ||
          (this.thresholds.ip1h > 0 && row.h1 >= this.thresholds.ip1h) ||
          (this.thresholds.ipVid10m > 0 && row.distinctVideosH1 >= this.thresholds.ipVid10m) ||
          (this.thresholds.ip6h > 0 && row.h6 >= this.thresholds.ip6h) ||
          (this.thresholds.ip12h > 0 && row.h12 >= this.thresholds.ip12h)
        )
        if (ipExceed) row._risk = Math.max(row._risk, 85)
        return row
      }).sort((a,b) => b.h1 - a.h1)

      const userRows = Array.from(userMap.values()).map(u => {
        const row = {
          id: u.id,
          name: u.name || '',
          h1: u.h1,
          h6: u.h6,
          h12: u.h12,
          distinctVideosH1: u.vids.size,
          ipCount: u.ips.size,
          _selected: false,
          tags: []
        }
        row._risk = this.calcUserRisk(row)
        const userExceed = (
          (this.thresholds.user1h > 0 && row.h1 >= this.thresholds.user1h) ||
          (this.thresholds.user6h > 0 && row.h6 >= this.thresholds.user6h) ||
          (this.thresholds.user12h > 0 && row.h12 >= this.thresholds.user12h)
        )
        if (userExceed) row._risk = Math.max(row._risk, 85)
        return row
      }).sort((a,b) => b.h1 - a.h1)

      this.updateCrossDayTags(ipRows, userRows)

      this.ipRows = ipRows
      this.userRows = userRows

      // 报警与概览
      const ipDanger = ipRows.filter(r => r._risk >= 80).length
      const userDanger = userRows.filter(r => r._risk >= 80).length
      const ipWarn = ipRows.filter(r => r._risk >= 50 && r._risk < 80).length
      const userWarn = userRows.filter(r => r._risk >= 50 && r._risk < 80).length
      this.summary = { ipDanger, userDanger, ipWarn, userWarn }

      const alerts = []
      for (const r of ipRows) {
        if (r._risk >= 80) alerts.push({ key: `ip-${r.ip}-danger`, text: `⚠️ IP ${this.formatIP(r.ip)} 超过阈值（1h:${r.h1} / 10m:${r.m10} / 视频:${r.distinctVideosH1}）`, style:{borderColor:'#4a2627',color:'#ffb3b4'} })
        else if (r._risk >= 50) alerts.push({ key: `ip-${r.ip}-warn`, text: `ℹ️ IP ${this.formatIP(r.ip)} 接近阈值（1h:${r.h1} / 10m:${r.m10}）`, style:{borderColor:'#4a3a17',color:'#ffd89c'} })
      }
      for (const u of userRows) {
        const displayName = (u.name && u.name.trim()) ? u.name : `用户${u.id}`
        if (u._risk >= 80) alerts.push({ key: `u-${u.id}-danger`, text: `⚠️ 用户 ${displayName} 超过阈值（1h:${u.h1} / 视频:${u.distinctVideosH1} / IP数:${u.ipCount}）`, style:{borderColor:'#4a2627',color:'#ffb3b4'} })
        else if (u._risk >= 50) alerts.push({ key: `u-${u.id}-warn`, text: `ℹ️ 用户 ${displayName} 接近阈值（1h:${u.h1}）`, style:{borderColor:'#4a3a17',color:'#ffd89c'} })
      }
      this.alerts = alerts
    },
    // 颜色与标签
    riskColorClass(score){ return score >= 80 ? 'danger' : (score >= 50 ? 'warn' : 'ok') },
    riskLabel(score){ return score >= 80 ? '高风险' : (score >= 50 ? '预警' : '正常') },
    toggleThresholds(){ this.showThresholds = !this.showThresholds },
    applyThresholds(){
      // 先保存到本地，再重建聚合
      this.saveThresholds()
      this.rebuildAggregations()
    },
    refreshData(){ this.loadInitialEvents() },

    // 操作区（示意）
    banSelectedIPs(){ const ips = this.ipRows.filter(r => r._selected).map(r => r.ip); if (!ips.length) return alert('未选择IP'); alert('批量封禁IP（示意）: '+ ips.join(', ')) },
    exportIPView(){ const lines = this.filteredIPRows.map(r => `${r.ip}\t${r.m1}\t${r.m10}\t${r.h1}\t${r.h6}\t${r.h12}\t${r.distinctVideosH1}\t${r.uaDiversity}\t${r._risk}\t${(r.tags||[]).join('|')}`)
      this.copyText(lines.join('\n'))
    },
    exportUserView(){ const lines = this.filteredUserRows.map(u => `${u.id}\t${u.name}\t${u.h1}\t${u.h6}\t${u.h12}\t${u.distinctVideosH1}\t${u.ipCount}\t${u._risk}\t${(u.tags||[]).join('|')}`)
      this.copyText(lines.join('\n'))
    },
    banIP(ip){ alert(`封禁IP（示意）: ${ip}`) },
    copyText(text){ navigator.clipboard?.writeText(String(text)).catch(()=>{}) },
    deleteSelectedUsers(){ const uids = this.userRows.filter(u => u._selected).map(u => u.id); if (!uids.length) return alert('未选择用户'); alert('批量删除用户（示意）: '+ uids.join(', ')) },
    deleteUser(id){ alert(`封禁用户（示意）: ${id}`) },
    // 新增：解释面板入口
    showIpDetail(row){ const breakdown = computeIpBreakdown(row, this.thresholds); this.openDetail('IP 风险明细', 'ip', row, breakdown) },
    showUserDetail(u){ const breakdown = computeUserBreakdown(u, this.thresholds); this.openDetail('用户 风险明细', 'user', u, breakdown) },
    openDetail(title, type, src, breakdown){ this.detailTitle = title; this.detailType = type; this.riskDetail = { src, ...breakdown }; this.showRiskDetail = true },
    closeDetail(){ this.showRiskDetail = false; this.riskDetail = null; this.detailTitle = ''; this.detailType = '' },
    saveThresholds(){
      try {
        const t = this.thresholds || {}
        const num = {
          ip10m: Number(t.ip10m) || 0,
          ip1h: Number(t.ip1h) || 0,
          ipVid10m: Number(t.ipVid10m) || 0,
          user1h: Number(t.user1h) || 0,
          ip6h: Number(t.ip6h) || 0,
          ip12h: Number(t.ip12h) || 0,
          user6h: Number(t.user6h) || 0,
          user12h: Number(t.user12h) || 0
        }
        localStorage.setItem('usage_thresholds', JSON.stringify(num))
      } catch (e) {
        console.warn('保存阈值失败:', e)
      }
    },
    loadThresholds(){
      try {
        const raw = localStorage.getItem('usage_thresholds')
        if (!raw) return
        const parsed = JSON.parse(raw)
        const merged = {
          ip10m: isFinite(Number(parsed.ip10m)) ? Number(parsed.ip10m) : this.thresholds.ip10m,
          ip1h: isFinite(Number(parsed.ip1h)) ? Number(parsed.ip1h) : this.thresholds.ip1h,
          ipVid10m: isFinite(Number(parsed.ipVid10m)) ? Number(parsed.ipVid10m) : this.thresholds.ipVid10m,
          user1h: isFinite(Number(parsed.user1h)) ? Number(parsed.user1h) : this.thresholds.user1h,
          ip6h: isFinite(Number(parsed.ip6h)) ? Number(parsed.ip6h) : (isFinite(Number(parsed.ip8h)) ? Number(parsed.ip8h) : this.thresholds.ip6h),
          ip12h: isFinite(Number(parsed.ip12h)) ? Number(parsed.ip12h) : this.thresholds.ip12h,
          user6h: isFinite(Number(parsed.user6h)) ? Number(parsed.user6h) : (isFinite(Number(parsed.user8h)) ? Number(parsed.user8h) : this.thresholds.user6h),
          user12h: isFinite(Number(parsed.user12h)) ? Number(parsed.user12h) : this.thresholds.user12h
        }
        this.thresholds = merged
      } catch (e) {
        console.warn('加载阈值失败:', e)
      }
    },

    // 新增：跨天缓存（localStorage）管理与标签生成
    loadRiskCache(){
      try {
        const raw = localStorage.getItem('usage_risk_cache_v1')
        const parsed = raw ? JSON.parse(raw) : null
        if (parsed && typeof parsed === 'object') {
          const def = { ip: {}, user: {}, lastCleanup: 0, ttlDays: 7 }
          this.riskCache = { ...def, ...parsed }
          if (!Number.isFinite(this.riskCache.ttlDays) || this.riskCache.ttlDays <= 0) this.riskCache.ttlDays = 7
        }
      } catch (e) {
        console.warn('加载风险缓存失败:', e)
      }
    },
    saveRiskCache(){
      try {
        const safe = this.riskCache || { ip: {}, user: {}, lastCleanup: 0, ttlDays: 7 }
        localStorage.setItem('usage_risk_cache_v1', JSON.stringify(safe))
      } catch (e) {
        console.warn('保存风险缓存失败:', e)
      }
    },
    fmtDate(ts){
      const d = new Date(ts || Date.now())
      const y = d.getFullYear()
      const m = String(d.getMonth()+1).padStart(2,'0')
      const dd = String(d.getDate()).padStart(2,'0')
      return `${y}-${m}-${dd}`
    },
    updateCrossDayTags(ipRows, userRows){
      const now = Date.now()
      const today = this.fmtDate(now)
      // 定期清理：每6小时做一次，移除 ttlDays 之前的日期
      if (!this.riskCache.lastCleanup || (now - this.riskCache.lastCleanup) > 6*60*60*1000) {
        const cutoffDate = new Date(now - (this.riskCache.ttlDays || 7)*24*60*60*1000)
        const cutoffStr = this.fmtDate(cutoffDate)
        const prune = (map)=>{
          for (const k of Object.keys(map)) {
            const entry = map[k] || {}
            const dates = entry.dates || {}
            const kept = {}
            for (const d of Object.keys(dates)) {
              if (d >= cutoffStr) kept[d] = true
            }
            if (Object.keys(kept).length) map[k] = { dates: kept }
            else delete map[k]
          }
        }
        prune(this.riskCache.ip)
        prune(this.riskCache.user)
        this.riskCache.lastCleanup = now
        this.saveRiskCache()
      }
      const markActive = (key, type)=>{
        const root = type === 'ip' ? (this.riskCache.ip || (this.riskCache.ip = {})) : (this.riskCache.user || (this.riskCache.user = {}))
        const entry = root[key] || { dates: {} }
        entry.dates[today] = true
        root[key] = entry
      }
      for (const r of ipRows) {
        const active = (r.m1 || r.m10 || r.h1 || r.h6 || r.h12) > 0
        if (active) markActive(r.ip, 'ip')
        const entry = (this.riskCache.ip || {})[r.ip]
        const dates = entry?.dates ? Object.keys(entry.dates) : []
        if (dates.length >= 2) {
          r.tags = Array.isArray(r.tags) ? r.tags : []
          if (!r.tags.includes('跨天活跃')) r.tags.push('跨天活跃')
        }
      }
      for (const u of userRows) {
        const active = (u.h1 || u.h6 || u.h12 || u.distinctVideosH1 || u.ipCount) > 0
        if (active) markActive(u.id, 'user')
        const entry = (this.riskCache.user || {})[u.id]
        const dates = entry?.dates ? Object.keys(entry.dates) : []
        if (dates.length >= 2) {
          u.tags = Array.isArray(u.tags) ? u.tags : []
          if (!u.tags.includes('跨天活跃')) u.tags.push('跨天活跃')
        }
      }
      this.saveRiskCache()
    },

    // 清理：移除所有 Legacy 方法，避免误用与混淆（方案A收尾）
    // （已删除 legacy 方法）

  }
}
</script>

<style scoped>
.usage-monitor-plus { --bg:#0f1320; --panel:#151a2e; --muted:#7e8ca3; --text:#e6ebf5; --primary:#4ea1ff; --danger:#ff4d4f; --warning:#faad14; --success:#52c41a; --border:#243052; }
*{ box-sizing:border-box; }
.usage-monitor-plus { background: var(--bg); color: var(--text); min-height: 100vh; }
.header { position: sticky; top:0; z-index:10; backdrop-filter:saturate(180%) blur(8px); background: rgba(15,19,32,0.7); border-bottom: 1px solid var(--border); }
.header-inner { margin:0 auto; padding:12px; display:flex; align-items:center; gap:12px; }
.title { font-size:18px; font-weight:600; }
.subtitle { color: var(--muted); font-size:13px; }
.container { margin:0 auto; padding:12px; }
.grid { display:grid; grid-template-columns:minmax(0,1fr) 380px; gap:20px; }
.panel { background: var(--panel); border:1px solid var(--border); border-radius:10px; padding:20px; }
.panel h3 { margin:0 0 12px; font-size:16px; }
.toolbar { display:flex; gap:12px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
.input,.select,.button { height:32px; border-radius:8px; border:1px solid var(--border); background:#0c1120; color:var(--text); padding:0 10px; }
.button { background:#0c1120; cursor:pointer; }
.button.primary { background:#183055; border-color:#22406f; color:#d6e6ff; }
.button.danger { background:#341a1a; border-color:#4c2323; color:#ffd9d9; }
.button.secondary { background:#121728; border-color:#28324f; color:#cfd6e6; }
.tag { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; font-size:13px; border:1px solid var(--border); color:var(--muted); margin:4px 6px 4px 0; }
.status { font-size:12px; padding:2px 8px; border-radius:999px; border:1px solid var(--border); }
.status.ok { color: var(--success); border-color:#2b4d2f; background:#102314; }
.status.warn { color: var(--warning); border-color:#4a3a17; background:#1a160d; }
.status.danger { color: var(--danger); border-color:#4a2627; background:#1a0f10; }
.mono { font-family: ui-monospace, Menlo, Monaco, Consolas, "Courier New", monospace; word-break: break-all; }
.cards { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:12px; }
.card { background:#0c1120; border:1px solid var(--border); border-radius:10px; padding:14px; }
.card .label { color: var(--muted); font-size:12px; }
.card .value { font-size:18px; font-weight:600; margin-top:6px; }
.section { margin-bottom:16px; }
.muted { color: var(--muted); }
.right-sticky { position: sticky; top: 68px; align-self: stretch; }
.table-scroll { height: 120vh; max-height: none; overflow:auto; }
.table-scroll thead th { position: sticky; top:0; background: var(--panel); z-index:1; }
.tabs { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
.tab { height:30px; padding:0 12px; border-radius:8px; border:1px solid var(--border); background:#121728; color:var(--text); cursor:pointer; font-size:13px; }
.tab.active { background:#183055; border-color:#22406f; color:#d6e6ff; }
.tab-panels {}
.tab-panel { display:none; }
.tab-panel.active { display:block; }
.alerts-wrap { display:flex; flex-wrap:wrap; gap:8px; }
.actions { display:flex; gap:8px; flex-wrap:wrap; }
.select-cell { text-align:center; }
.usage-monitor-plus table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.usage-monitor-plus th, .usage-monitor-plus td { border-bottom: 1px solid var(--border); padding: 12px 10px; text-align: left; font-size: 13px; line-height: 1.6; }
.usage-monitor-plus th { color: var(--muted); font-weight: 500; white-space: nowrap; }
.usage-monitor-plus td { word-break: break-word; overflow-wrap: anywhere; }
.usage-monitor-plus tbody tr:hover { background: rgba(255,255,255,0.03); }
.right-sticky .panel { height: 100%; display: flex; flex-direction: column; }
#alerts { display: flex; flex-wrap: wrap; gap: 8px; overflow: auto; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.select-cell { text-align: center; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; z-index: 1000; }
.modal-card { width: 640px; max-width: 90vw; background: var(--panel); border:1px solid var(--border); border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
.modal-header { display:flex; align-items:center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.modal-body { padding: 12px 16px; }
.breakdown-table { width: 100%; border-collapse: collapse; }
.breakdown-table th, .breakdown-table td { border-bottom: 1px solid var(--border); padding: 8px; font-size: 13px; }
.total-line { margin-top: 8px; font-weight: 600; }
@media (max-width: 992px){ .grid{ grid-template-columns:1fr; } .right-sticky{ position: static; } .table-scroll{ height:auto; } }
</style>