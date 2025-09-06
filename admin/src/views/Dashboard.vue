<template>
  <div class="dashboard-container">
    <!-- 头部 -->
    <div class="header">
      <div class="header-left">
        <span class="main-title">管理系统</span>
        <span class="separator">|</span>
        <span class="sub-title">字幕与用户管理</span>
      </div>
      <div class="header-right">
        <span class="welcome-text">欢迎，{{ currentUser.username }}</span>
        <el-button @click="handleLogout" type="danger" plain size="small">
          <el-icon><SwitchButton /></el-icon>
          退出登录
        </el-button>
      </div>
    </div>

    <!-- 标签页 -->
    <el-tabs v-model="activeTab" @tab-click="onTabClick">
      <el-tab-pane label="字幕管理" name="subtitles">
        <!-- 工具栏 -->
        <div class="toolbar">
          <div class="toolbar-left">
            <el-button type="primary" @click="openCreateUploadDialog">
              <el-icon><Upload /></el-icon>
              上传字幕
            </el-button>
            <el-button @click="showBatchUploadDialog = true">
              <el-icon><FolderOpened /></el-icon>
              批量上传
            </el-button>
            <el-button @click="exportData" :loading="exporting">
              <el-icon><Download /></el-icon>
              导出数据
            </el-button>
            <el-divider direction="vertical" />
            <el-button @click="selectAllCurrentPage" :disabled="loading || tableData.length === 0">
              全选当前页
            </el-button>
            <el-button @click="invertSelection" :disabled="loading || tableData.length === 0">
              反选当前页
            </el-button>
            <el-button @click="clearSelection" :disabled="selectedIds.size === 0">
              取消选择
            </el-button>
            <el-button type="danger" @click="bulkDelete" :loading="deleting" :disabled="selectedIds.size === 0">
              <el-icon><Delete /></el-icon>
              批量删除
            </el-button>
          </div>
          <div class="toolbar-right">
            <el-input
              v-model="searchQuery"
              placeholder="搜索视频编号..."
              prefix-icon="Search"
              style="width: 300px"
              @input="handleSearch"
              clearable
            />
          </div>
        </div>

        <!-- 统计卡片 -->
        <div class="stats-cards">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ allStats.total }}</div>
              <div class="stat-label">总视频数</div>
            </div>
            <div class="stat-icon">
              <el-icon><VideoCamera /></el-icon>
            </div>
          </el-card>
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ allStats.hasSubtitle }}</div>
              <div class="stat-label">已有字幕</div>
            </div>
            <div class="stat-icon">
              <el-icon><Document /></el-icon>
            </div>
          </el-card>
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ allStats.missing }}</div>
              <div class="stat-label">缺失字幕</div>
            </div>
            <div class="stat-icon">
              <el-icon><Warning /></el-icon>
            </div>
          </el-card>
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ allStats.completion }}%</div>
              <div class="stat-label">完成度</div>
            </div>
            <div class="stat-icon">
              <el-icon><TrendCharts /></el-icon>
            </div>
          </el-card>
        </div>

        <!-- 数据表格 -->
        <el-card class="table-card">
          <el-table
            ref="tableRef"
            :data="tableData"
            v-loading="loading"
            style="width: 100%"
            height="400"
            stripe
            @selection-change="onSelectionChange"
          >
            <el-table-column type="selection" width="48" />
            <el-table-column prop="video_id" label="视频编号" width="200" sortable>
              <template #default="scope">
                <el-tag>{{ scope.row.video_id }}</el-tag>
              </template>
            </el-table-column>
            
            <el-table-column label="字幕状态" width="120" align="center">
              <template #default="scope">
                <el-tag :type="scope.row.filename ? 'success' : 'danger'">
                  {{ scope.row.filename ? '✅已上传' : '❌缺失' }}
                </el-tag>
              </template>
            </el-table-column>
            
            <el-table-column prop="filename" label="文件名" min-width="200">
              <template #default="scope">
                <span v-if="scope.row.filename">{{ scope.row.original_filename || scope.row.filename }}</span>
                <span v-else style="color: #ccc;">-</span>
              </template>
            </el-table-column>
            
            <!-- 新增：HASH 列（显示前缀，悬浮可见完整值，支持复制） -->
            <el-table-column prop="content_hash" label="HASH" width="220">
              <template #default="scope">
                <template v-if="scope.row.filename && scope.row.content_hash">
                  <el-tooltip effect="dark" :content="scope.row.content_hash" placement="top">
                    <span class="monospace">{{ scope.row.content_hash.slice(0, 16) }}...</span>
                  </el-tooltip>
                  <el-link type="primary" :underline="false" style="margin-left:8px;" @click="copyText(scope.row.content_hash)">复制</el-link>
                </template>
                <span v-else style="color:#ccc;">-</span>
              </template>
            </el-table-column>
            
            <el-table-column prop="file_size" label="文件大小" width="120" align="right">
              <template #default="scope">
                <span v-if="scope.row.file_size">{{ formatFileSize(scope.row.file_size) }}</span>
                <span v-else style="color: #ccc;">-</span>
              </template>
            </el-table-column>
            
            <!-- 新增：点赞数列 -->
            <el-table-column prop="likes_count" label="点赞数" width="120" align="right" sortable>
              <template #default="scope">
                <span>{{ scope.row.likes_count ?? 0 }}</span>
              </template>
            </el-table-column>
            
            <el-table-column prop="updated_at" label="更新时间" width="180">
              <template #default="scope">
                <span v-if="scope.row.updated_at">{{ formatDate(scope.row.updated_at) }}</span>
                <span v-else style="color: #ccc;">-</span>
              </template>
            </el-table-column>
            
            <el-table-column label="操作" width="200" align="center" fixed="right">
              <template #default="scope">
                <div class="action-buttons">
                  <el-button
                    v-if="scope.row.filename"
                    size="small"
                    @click="previewSubtitle(scope.row)"
                    title="预览"
                  >
                    <el-icon><View /></el-icon>
                  </el-button>
                  
                  <el-button
                    v-if="scope.row.filename"
                    size="small"
                    type="warning"
                    @click="updateSubtitle(scope.row)"
                    title="更新"
                  >
                    <el-icon><Edit /></el-icon>
                  </el-button>
                  
                  <el-button
                    v-if="!scope.row.filename"
                    size="small"
                    type="primary"
                    @click="uploadSubtitle(scope.row.video_id)"
                    title="上传"
                  >
                    <el-icon><Upload /></el-icon>
                  </el-button>
                  
                  <el-button
                    v-if="scope.row.filename"
                    size="small"
                    type="danger"
                    @click="deleteSubtitle(scope.row)"
                    title="删除"
                  >
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <!-- 分页 -->
          <div class="pagination-wrapper">
            <el-pagination
              :current-page="pagination.page"
              :page-size="pagination.limit"
              :page-sizes="[20, 50, 100]"
              :total="pagination.total"
              layout="total, sizes, prev, pager, next, jumper"
              @size-change="handleSizeChange"
              @current-change="handleCurrentChange"
            />
          </div>
        </el-card>

        <!-- 上传对话框 -->
        <UploadDialog
          v-model="showUploadDialog"
          :video-id="selectedVideoId"
          @success="handleUploadSuccess"
        />

        <!-- 批量上传对话框 -->
        <BatchUploadDialog
          v-model="showBatchUploadDialog"
          @success="handleUploadSuccess"
        />

        <!-- 预览对话框 -->
        <PreviewDialog
          v-model="showPreviewDialog"
          :subtitle-data="previewData"
        />

        <!-- 心愿单批量上传对话框 已移至心愿单标签页内 -->
      </el-tab-pane>

      <el-tab-pane label="用户管理" name="users">
        <UserManagement />
      </el-tab-pane>

      <!-- 新增：心愿单管理 -->
      <el-tab-pane label="心愿单" name="wishlist">
        <div class="toolbar">
          <div class="toolbar-left">
            <el-button @click="refreshWishlist" :loading="wishlist.loading">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
            <el-button type="primary" @click="showWishlistBatchUploadDialog = true" style="margin-left: 8px;">
              <el-icon><Upload /></el-icon>
              批量上传字幕
            </el-button>
            <el-button @click="exportUnupdated" :loading="wishlist.exporting" style="margin-left: 8px;">
              <el-icon><Download /></el-icon>
              导出未更新心愿单
            </el-button>
          </div>
          <div class="toolbar-right">
            <el-input
              v-model="wishlist.searchQuery"
              placeholder="搜索用户名或邮箱..."
              prefix-icon="Search"
              style="width: 300px; margin-right: 16px"
              @input="handleWishlistSearch"
              @keyup.enter="handleWishlistSearch"
              clearable
            />
            <span style="color:#666">共 {{ wishlist.items.length }} 条</span>
          </div>
        </div>
        <el-card class="table-card">
          <el-table :data="wishlist.items" v-loading="wishlist.loading" height="400" stripe style="width:100%">
            <el-table-column prop="id" label="ID" width="80" align="right" />
            <el-table-column label="用户" min-width="200">
              <template #default="scope">
                <div>
                  <div>{{ scope.row.username || ('用户#' + scope.row.user_id) }}</div>
                  <div style="color:#999;font-size:12px">{{ scope.row.email || '-' }}</div>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="video_id" label="视频编号" width="200">
              <template #default="scope">
                <el-tag>{{ scope.row.video_id }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="base_video_id" label="基础ID" width="160" />
            <el-table-column label="备注" min-width="200">
              <template #default="scope">
                <div v-if="!scope.row.note || !scope.row.note.trim()" style="color: #ccc;">-</div>
                <el-popover
                  v-else
                  trigger="click"
                  placement="right"
                  :width="480"
                  popper-class="note-popover"
                >
                  <template #reference>
                    <div class="note-clamp-2" role="button" tabindex="0">
                      {{ scope.row.note }}
                      <el-link v-if="isLongText(scope.row.note)" type="primary" size="small" style="margin-left: 8px;">查看全部</el-link>
                    </div>
                  </template>
                  <div class="note-full-content">{{ scope.row.note }}</div>
                  <div class="popover-actions">
                    <el-button size="small" plain @click="copyText(scope.row.note)">复制备注</el-button>
                  </div>
                </el-popover>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="120" align="center">
              <template #default="scope">
                <el-tag :type="scope.row.status === '已更新' ? 'success' : 'warning'">
                  {{ scope.row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="创建时间" width="180">
              <template #default="scope">
                {{ formatDate(scope.row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column prop="updated_at" label="更新时间" width="180">
              <template #default="scope">
                {{ formatDate(scope.row.updated_at) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="160" align="center" fixed="right">
               <template #default="scope">
                 <el-button
                   size="small"
                   :type="scope.row.status === '已更新' ? 'success' : 'primary'"
                   :loading="wishlist.updatingId === scope.row.id"
                   @click="toggleWishlistStatus(scope.row)"
                 >
                   {{ scope.row.status === '已更新' ? '标记未更新' : '标记已更新' }}
                 </el-button>
               </template>
             </el-table-column>
          </el-table>
          <div class="pagination-wrapper" style="margin-top:16px; text-align: center;">
            <el-pagination
              :current-page="wishlist.page"
              :page-size="wishlist.limit"
              :page-sizes="[10, 20, 50, 100]"
              :total="wishlist.total"
              layout="total, sizes, prev, pager, next, jumper"
              @size-change="handleWishlistSizeChange"
              @current-change="handleWishlistCurrentChange"
            />
          </div>
        </el-card>

        <!-- 心愿单批量上传对话框 放置在心愿单标签页内确保可见 -->
        <WishlistBatchUploadDialog
          v-model="showWishlistBatchUploadDialog"
          @success="handleWishlistBatchUploadSuccess"
        />
      </el-tab-pane>

      <!-- 通知管理 -->
      <el-tab-pane label="通知管理" name="notifications">
        <div class="toolbar">
          <div class="toolbar-left">
            <el-button type="primary" @click="showBroadcastDialog = true">
              <el-icon><Bell /></el-icon>
              发送系统通知
            </el-button>
            <el-button @click="refreshNotifications" :loading="notifications.loading">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
          </div>
          <div class="toolbar-right">
            <el-input
              v-model="notifications.searchQuery"
              placeholder="搜索通知内容..."
              prefix-icon="Search"
              style="width: 300px; margin-right: 16px"
              @input="handleNotificationSearch"
              clearable
            />
            <span style="color:#666">共 {{ notifications.total }} 条</span>
          </div>
        </div>

        <!-- 通知统计卡片 -->
        <div class="stats-cards">
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ notificationStats.total }}</div>
              <div class="stat-label">总通知数</div>
            </div>
            <div class="stat-icon">
              <el-icon><Bell /></el-icon>
            </div>
          </el-card>
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ notificationStats.system }}</div>
              <div class="stat-label">系统通知</div>
            </div>
            <div class="stat-icon">
              <el-icon><Message /></el-icon>
            </div>
          </el-card>
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ notificationStats.mention }}</div>
              <div class="stat-label">@提及通知</div>
            </div>
            <div class="stat-icon">
              <el-icon><ChatDotRound /></el-icon>
            </div>
          </el-card>
          <el-card class="stat-card">
            <div class="stat-content">
              <div class="stat-number">{{ notificationStats.today }}</div>
              <div class="stat-label">今日发送</div>
            </div>
            <div class="stat-icon">
              <el-icon><Calendar /></el-icon>
            </div>
          </el-card>
        </div>

        <!-- 通知列表 -->
        <el-card class="table-card">
          <el-table :data="notifications.items" v-loading="notifications.loading" height="400" stripe style="width:100%">
            <el-table-column prop="id" label="ID" width="80" align="right" />
            <el-table-column label="类型" width="120" align="center">
              <template #default="scope">
                <el-tag :type="scope.row.type === 'system' ? 'primary' : 'success'">
                  {{ scope.row.type === 'system' ? '系统通知' : '@提及' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="标题" min-width="200" />
            <el-table-column label="内容" min-width="300">
              <template #default="scope">
                <div v-if="!scope.row.content || !scope.row.content.trim()" style="color: #ccc;">-</div>
                <el-popover
                  v-else
                  trigger="click"
                  placement="right"
                  :width="480"
                  popper-class="note-popover"
                >
                  <template #reference>
                    <div class="note-clamp-2" role="button" tabindex="0">
                      {{ scope.row.content }}
                      <el-link v-if="isLongText(scope.row.content)" type="primary" size="small" style="margin-left: 8px;">查看全部</el-link>
                    </div>
                  </template>
                  <div class="note-full-content">{{ scope.row.content }}</div>
                  <div class="popover-actions">
                    <el-button size="small" plain @click="copyText(scope.row.content)">复制内容</el-button>
                  </div>
                </el-popover>
              </template>
            </el-table-column>
            <el-table-column label="接收用户" width="120" align="center">
              <template #default="scope">
                <span v-if="scope.row.receiver_username">{{ scope.row.receiver_username }}</span>
                <el-tag v-else-if="!scope.row.user_id" type="warning">全体用户</el-tag>
                <span v-else>用户#{{ scope.row.user_id }}</span>
              </template>
            </el-table-column>
            <el-table-column label="删除状态" width="120" align="center">
              <template #default="scope">
                <span v-if="!scope.row.user_id" style="color: #999;">-</span>
                <el-tag v-else-if="scope.row.is_deleted === 1" type="danger" size="small">
                  已删除
                </el-tag>
                <el-tag v-else type="success" size="small">
                  未删除
                </el-tag>
                <div v-if="scope.row.is_deleted === 1 && scope.row.deleted_at" 
                     style="color: #999; font-size: 11px; margin-top: 2px;">
                  {{ formatDate(scope.row.deleted_at) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="发送时间" width="180">
              <template #default="scope">
                {{ formatDate(scope.row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" align="center" fixed="right">
              <template #default="scope">
                <el-button
                  size="small"
                  type="danger"
                  :loading="notifications.deletingId === scope.row.id"
                  @click="deleteNotification(scope.row)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination-wrapper" style="margin-top:16px; text-align: center;">
            <el-pagination
              :current-page="notifications.page"
              :page-size="notifications.limit"
              :page-sizes="[10, 20, 50, 100]"
              :total="notifications.total"
              layout="total, sizes, prev, pager, next, jumper"
              @size-change="handleNotificationSizeChange"
              @current-change="handleNotificationCurrentChange"
            />
          </div>
        </el-card>

        <!-- 发送系统通知对话框 -->
        <el-dialog
          v-model="showBroadcastDialog"
          title="发送系统通知"
          width="600px"
          :close-on-click-modal="false"
        >
          <el-form :model="broadcastForm" :rules="broadcastRules" ref="broadcastFormRef" label-width="80px">
            <el-form-item label="通知标题" prop="title">
              <el-input
                v-model="broadcastForm.title"
                placeholder="请输入通知标题"
                maxlength="100"
                show-word-limit
              />
            </el-form-item>
            <el-form-item label="通知内容" prop="content">
              <el-input
                v-model="broadcastForm.content"
                type="textarea"
                :rows="4"
                placeholder="请输入通知内容"
                maxlength="500"
                show-word-limit
              />
            </el-form-item>
            <el-form-item label="跳转链接">
              <el-input
                v-model="broadcastForm.link"
                placeholder="可选，点击通知后跳转的链接"
              />
            </el-form-item>
          </el-form>
          <template #footer>
            <span class="dialog-footer">
              <el-button @click="showBroadcastDialog = false">取消</el-button>
              <el-button type="primary" @click="sendBroadcast" :loading="broadcasting">
                发送通知
              </el-button>
            </span>
          </template>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { subtitleAPI, wishlistAPI, notificationAPI } from '../utils/api'
import UploadDialog from '../components/UploadDialog.vue'
import BatchUploadDialog from '../components/BatchUploadDialog.vue'
import PreviewDialog from '../components/PreviewDialog.vue'
import WishlistBatchUploadDialog from '../components/WishlistBatchUploadDialog.vue'
import UserManagement from './UserManagement.vue'

const router = useRouter()

// 新增：标签状态
defineOptions({ name: 'Dashboard' })
const activeTab = ref('subtitles')

// 修复：Element Plus 使用 tab-click 事件，且增加 watch 兜底
const onTabClick = async (pane) => {
  const name = pane?.paneName ?? pane?.name ?? ''
  if (name === 'wishlist' && wishlist.items.length === 0) {
    await loadWishlistPage()
  } else if (name === 'notifications' && notifications.items.length === 0) {
    await loadNotifications()
    await loadNotificationStats()
  }
}

watch(activeTab, async (name) => {
  if (name === 'wishlist' && wishlist.items.length === 0) {
    await loadWishlistPage()
  } else if (name === 'notifications' && notifications.items.length === 0) {
    await loadNotifications()
    await loadNotificationStats()
  }
})
// 响应式数据
const loading = ref(false)
const exporting = ref(false)
const deleting = ref(false)
const searchQuery = ref('')
const tableData = ref([])
const tableRef = ref()
const selectedIds = ref(new Set())
const showUploadDialog = ref(false)
const showBatchUploadDialog = ref(false)
const showWishlistBatchUploadDialog = ref(false)
const showPreviewDialog = ref(false)
const selectedVideoId = ref('')
const previewData = ref(null)

const pagination = reactive({
  page: 1,
  limit: 50,
  total: 0
})

// 新增：心愿单数据（页码分页）
const wishlist = reactive({
  items: [],
  nextCursor: null,
  limit: 50,
  loading: false,
  hasMore: true,
  updatingId: 0,
  searchQuery: '',
  // 页码分页字段
  page: 1,
  total: 0,
  exporting: false
})

// 通知管理数据
const notifications = reactive({
  items: [],
  loading: false,
  searchQuery: '',
  page: 1,
  limit: 20,
  total: 0,
  deletingId: 0
})

// 通知统计数据
const notificationStats = reactive({
  total: 0,
  system: 0,
  mention: 0,
  today: 0
})

// 系统广播相关
const showBroadcastDialog = ref(false)
const broadcasting = ref(false)
const broadcastFormRef = ref()
const broadcastForm = reactive({
  title: '',
  content: '',
  link: ''
})

const broadcastRules = {
  title: [
    { required: true, message: '请输入通知标题', trigger: 'blur' },
    { min: 1, max: 100, message: '标题长度在 1 到 100 个字符', trigger: 'blur' }
  ],
  content: [
    { required: true, message: '请输入通知内容', trigger: 'blur' },
    { min: 1, max: 500, message: '内容长度在 1 到 500 个字符', trigger: 'blur' }
  ]
}

// 当前用户
const currentUser = computed(() => {
  const user = localStorage.getItem('admin_user')
  return user ? JSON.parse(user) : { username: 'Admin' }
})

// 顶部统计（全量）
const allStats = reactive({ total: 0, hasSubtitle: 0, missing: 0, completion: 0 })

const fetchStats = async () => {
  try {
    const res = await subtitleAPI.getStats({ search: searchQuery.value })
    allStats.total = res.total
    allStats.hasSubtitle = res.hasSubtitle
    allStats.missing = res.missing
    allStats.completion = res.completion
  } catch (e) {
    // 忽略统计失败
  }
}

// 方法
const loadData = async () => {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      limit: pagination.limit,
      search: searchQuery.value
    }
    
    const response = await subtitleAPI.getList(params)
    tableData.value = response.data
    pagination.total = response.pagination.total
    await fetchStats()
  } catch (error) {
    console.error('加载数据失败:', error)
  } finally {
    loading.value = false
  }
}

// 新增：心愿单导出方法（最小侵入）
const exportUnupdated = async () => {
  if (wishlist.exporting) return
  const token = localStorage.getItem('admin_token')
  if (!token) {
    ElMessage.error('请先登录')
    return
  }
  wishlist.exporting = true
  try {
    const { blob, filename } = await wishlistAPI.exportUnupdated()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || 'wishlist-unupdated.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (e) {
    console.error(e)
    ElMessage.error(e.message || '导出失败')
  } finally {
    wishlist.exporting = false
  }
}

// 新增：加载心愿单（页码分页）
const loadWishlistPage = async () => {
  if (wishlist.loading) return
  wishlist.loading = true
  try {
    const params = { 
      page: wishlist.page, 
      limit: wishlist.limit 
    }
    if (wishlist.searchQuery.trim()) params.search = wishlist.searchQuery.trim()
    const res = await wishlistAPI.getList(params)
    wishlist.items = res.data || []
    wishlist.total = res.pagination?.total || 0
  } catch (e) {
    console.error('加载心愿单失败:', e)
  } finally {
    wishlist.loading = false
  }
}

const refreshWishlist = () => {
  wishlist.page = 1
  loadWishlistPage()
}

const handleWishlistSearch = () => {
  wishlist.page = 1
  loadWishlistPage()
}

const handleWishlistSizeChange = (limit) => {
  wishlist.limit = limit
  wishlist.page = 1
  loadWishlistPage()
}

const handleWishlistCurrentChange = (page) => {
  wishlist.page = page
  loadWishlistPage()
}

const handleSearch = () => {
  pagination.page = 1
  clearSelection()
  loadData()
}

const handleSizeChange = (size) => {
  pagination.limit = size
  pagination.page = 1
  clearSelection()
  loadData()
}

const handleCurrentChange = (page) => {
  pagination.page = page
  clearSelection()
  loadData()
}

const openCreateUploadDialog = () => {
  selectedVideoId.value = ''
  showUploadDialog.value = true
}

const uploadSubtitle = (videoId) => {
  selectedVideoId.value = ''
  showUploadDialog.value = true
}

const updateSubtitle = (row) => {
  selectedVideoId.value = row.video_id
  showUploadDialog.value = true
}

const previewSubtitle = async (row) => {
  try {
    const response = await subtitleAPI.getSubtitle(row.video_id)
    previewData.value = {
      video_id: row.video_id,
      filename: row.filename,
      content: response
    }
    showPreviewDialog.value = true
  } catch (error) {
    ElMessage.error('预览失败')
  }
}

const deleteSubtitle = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除视频 "${row.video_id}" 的字幕文件吗？`,
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    await subtitleAPI.delete(row.video_id)
    ElMessage.success('删除成功')
    await loadData()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除失败:', error)
    }
  }
}

// 新增：切换心愿单状态
const toggleWishlistStatus = async (row) => {
  const newStatus = row.status === '已更新' ? '未更新' : '已更新'
  wishlist.updatingId = row.id
  try {
    const res = await wishlistAPI.updateStatus(row.id, newStatus)
    const updated = res.item || {}
    row.status = updated.status || newStatus
    row.updated_at = updated.updated_at || row.updated_at
    ElMessage.success('更新成功')
  } catch (e) {
    console.error(e)
    ElMessage.error('更新失败')
  } finally {
    wishlist.updatingId = 0
  }
}

// 备注相关方法
const isLongText = (text) => {
  return !!text && text.trim().length > 50
}

const copyText = async (text) => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      ElMessage.success('复制成功')
    } else {
      // 回退方案
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      ElMessage.success('复制成功')
    }
  } catch (error) {
    console.error('复制失败:', error)
    ElMessage.error('复制失败')
  }
}

// 选择相关
const onSelectionChange = (rows) => {
  const ids = new Set(rows.map(r => r.video_id))
  selectedIds.value = ids
}

const clearSelection = () => {
  selectedIds.value = new Set()
  if (tableRef.value) tableRef.value.clearSelection()
}

const selectAllCurrentPage = () => {
  if (!tableRef.value) return
  tableRef.value.clearSelection()
  tableData.value.forEach(row => tableRef.value.toggleRowSelection(row, true))
}

const invertSelection = () => {
  if (!tableRef.value) return
  const currentSelected = new Set([...selectedIds.value])
  tableRef.value.clearSelection()
  tableData.value.forEach(row => {
    const willSelect = !currentSelected.has(row.video_id)
    if (willSelect) tableRef.value.toggleRowSelection(row, true)
  })
}

const bulkDelete = async () => {
  if (!selectedIds.value.size) return
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedIds.value.size} 条字幕记录吗？`,
      '批量删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    deleting.value = true
    const ids = [...selectedIds.value]
    const res = await subtitleAPI.bulkDelete(ids)
    const successCount = res.deleted || 0
    const failedCount = res.failed ? Object.keys(res.failed).length : 0

    if (failedCount === 0) {
      ElMessage.success(`已删除 ${successCount} 条`)
    } else {
      ElMessage.warning(`成功 ${successCount} 条，失败 ${failedCount} 条`)
    }

    clearSelection()
    await loadData()
  } catch (e) {
    if (e !== 'cancel') {
      console.error(e)
    }
  } finally {
    deleting.value = false
  }
}

const handleUploadSuccess = () => { loadData() }

// 心愿单批量上传成功处理
const handleWishlistBatchUploadSuccess = () => {
  ElMessage.success('批量上传完成')
  refreshWishlist()
}

// 新增：退出登录
const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '确认退出', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    ElMessage.success('已退出登录')
    router.push('/login')
  } catch (error) {
    // 用户取消
  }
}

const exportData = () => {
  exporting.value = true
  setTimeout(() => {
    const headers = ['视频编号', '字幕状态', '文件名', 'HASH', '文件大小', '更新时间']
    const rows = tableData.value.map(row => [
      row.video_id,
      row.filename ? '已上传' : '缺失',
      (row.original_filename || row.filename || ''),
      (row.content_hash || ''),
      row.file_size ? formatFileSize(row.file_size) : '',
      row.updated_at ? formatDate(row.updated_at) : ''
    ])
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'subtitles.csv'
    link.click()
    URL.revokeObjectURL(link.href)
    exporting.value = false
    ElMessage.success('导出成功')
  }, 1000)
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDate = (dateString) => new Date(dateString).toLocaleString('zh-CN')

// 通知管理方法
const loadNotifications = async () => {
  if (notifications.loading) return
  notifications.loading = true
  try {
    const params = {
      page: notifications.page,
      limit: notifications.limit
    }
    if (notifications.searchQuery.trim()) {
      params.search = notifications.searchQuery.trim()
    }
    const res = await notificationAPI.getList(params)
    notifications.items = res.data || []
    notifications.total = res.pagination?.total || 0
  } catch (e) {
    console.error('加载通知失败:', e)
    ElMessage.error('加载通知失败')
  } finally {
    notifications.loading = false
  }
}

const loadNotificationStats = async () => {
  try {
    const res = await notificationAPI.getStats()
    Object.assign(notificationStats, res)
  } catch (e) {
    console.error('加载通知统计失败:', e)
  }
}

const refreshNotifications = () => {
  notifications.page = 1
  loadNotifications()
  loadNotificationStats()
}

const handleNotificationSearch = () => {
  notifications.page = 1
  loadNotifications()
}

const handleNotificationSizeChange = (limit) => {
  notifications.limit = limit
  notifications.page = 1
  loadNotifications()
}

const handleNotificationCurrentChange = (page) => {
  notifications.page = page
  loadNotifications()
}

const sendBroadcast = async () => {
  if (!broadcastFormRef.value) return
  
  try {
    await broadcastFormRef.value.validate()
  } catch {
    return
  }
  
  broadcasting.value = true
  try {
    await notificationAPI.broadcast({
      title: broadcastForm.title,
      content: broadcastForm.content,
      linkUrl: broadcastForm.link || null
    })
    
    ElMessage.success('系统通知发送成功')
    showBroadcastDialog.value = false
    
    // 重置表单
    Object.assign(broadcastForm, {
      title: '',
      content: '',
      link: ''
    })
    
    // 刷新通知列表和统计
    refreshNotifications()
  } catch (e) {
    console.error('发送通知失败:', e)
    ElMessage.error('发送通知失败')
  } finally {
    broadcasting.value = false
  }
}

const deleteNotification = async (notification) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除通知"${notification.title}"吗？`,
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    notifications.deletingId = notification.id
    await notificationAPI.delete(notification.id)
    
    ElMessage.success('删除成功')
    refreshNotifications()
  } catch (e) {
    if (e !== 'cancel') {
      console.error('删除通知失败:', e)
      ElMessage.error('删除失败')
    }
  } finally {
    notifications.deletingId = 0
  }
}

onMounted(() => { loadData(); loadWishlistPage() })
</script>

<style scoped>
/* 保留原样式 */
.dashboard-container { padding: 20px; background-color: #f5f5f5; min-height: 100vh; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: white; padding: 6px 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); min-height: 40px; }
.header-left { display: flex; align-items: center; gap: 8px; }
.main-title { font-size: 18px; font-weight: bold; color: #303133; }
.separator { color: #dcdfe6; margin: 0 4px; }
.sub-title { font-size: 14px; color: #606266; }
.header-right { display: flex; align-items: center; gap: 12px; }
.welcome-text { font-size: 14px; color: #606266; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
.toolbar-left { display: flex; gap: 10px; }
.stats-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
.stat-card { cursor: default; }
.stat-card :deep(.el-card__body) { padding: 20px; display: flex; justify-content: space-between; align-items: center; }
.stat-number { font-size: 32px; font-weight: bold; color: #409EFF; margin-bottom: 5px; }
.stat-label { color: #666; font-size: 14px; }
.stat-icon { font-size: 40px; color: #409EFF; opacity: 0.3; }
.table-card { box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
.action-buttons { display: flex; gap: 5px; justify-content: center; }
.pagination-wrapper { display: flex; justify-content: center; margin-top: 20px; }

/* 备注相关样式 */
.note-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  cursor: pointer;
  transition: color 0.2s;
}

.note-clamp-2:hover {
  color: #409EFF;
}

/* Popover 样式 */
:deep(.note-popover) {
  max-width: 640px;
}

:deep(.note-popover .note-full-content) {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  color: #333;
  max-height: 300px;
  overflow-y: auto;
}

:deep(.note-popover .popover-actions) {
  margin-top: 12px;
  text-align: right;
  border-top: 1px solid #ebeef5;
  padding-top: 8px;
}
.monospace { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
</style>