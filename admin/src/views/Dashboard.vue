<template>
  <div class="dashboard-container">
    <!-- 头部 -->
    <div class="header">
      <div class="header-left">
        <h1>字幕文件管理系统</h1>
        <p>管理和维护视频字幕文件</p>
      </div>
      <div class="header-right">
        <span>欢迎，{{ currentUser.username }}</span>
        <el-button @click="handleLogout" type="danger" plain>
          <el-icon><SwitchButton /></el-icon>
          退出登录
        </el-button>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-button type="primary" @click="showUploadDialog = true">
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
          <div class="stat-number">{{ stats.total }}</div>
          <div class="stat-label">总视频数</div>
        </div>
        <div class="stat-icon">
          <el-icon><VideoCamera /></el-icon>
        </div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-number">{{ stats.hasSubtitle }}</div>
          <div class="stat-label">已有字幕</div>
        </div>
        <div class="stat-icon">
          <el-icon><Document /></el-icon>
        </div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-number">{{ stats.missing }}</div>
          <div class="stat-label">缺失字幕</div>
        </div>
        <div class="stat-icon">
          <el-icon><Warning /></el-icon>
        </div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-number">{{ stats.completion }}%</div>
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
        :data="tableData"
        v-loading="loading"
        style="width: 100%"
        height="400"
        stripe
      >
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
            <span v-if="scope.row.filename">{{ scope.row.filename }}</span>
            <span v-else style="color: #ccc;">-</span>
          </template>
        </el-table-column>
        
        <el-table-column prop="file_size" label="文件大小" width="120" align="right">
          <template #default="scope">
            <span v-if="scope.row.file_size">{{ formatFileSize(scope.row.file_size) }}</span>
            <span v-else style="color: #ccc;">-</span>
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
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { subtitleAPI } from '../utils/api'
import UploadDialog from '../components/UploadDialog.vue'
import BatchUploadDialog from '../components/BatchUploadDialog.vue'
import PreviewDialog from '../components/PreviewDialog.vue'

const router = useRouter()

// 响应式数据
const loading = ref(false)
const exporting = ref(false)
const searchQuery = ref('')
const tableData = ref([])
const showUploadDialog = ref(false)
const showBatchUploadDialog = ref(false)
const showPreviewDialog = ref(false)
const selectedVideoId = ref('')
const previewData = ref(null)

const pagination = reactive({
  page: 1,
  limit: 50,
  total: 0
})

// 当前用户
const currentUser = computed(() => {
  const user = localStorage.getItem('admin_user')
  return user ? JSON.parse(user) : { username: 'Admin' }
})

// 统计数据
const stats = computed(() => {
  const total = tableData.value.length
  const hasSubtitle = tableData.value.filter(item => item.filename).length
  const missing = total - hasSubtitle
  const completion = total > 0 ? Math.round((hasSubtitle / total) * 100) : 0
  
  return { total, hasSubtitle, missing, completion }
})

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
    
  } catch (error) {
    console.error('加载数据失败:', error)
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  pagination.page = 1
  loadData()
}

const handleSizeChange = (size) => {
  pagination.limit = size
  pagination.page = 1
  loadData()
}

const handleCurrentChange = (page) => {
  pagination.page = page
  loadData()
}

const uploadSubtitle = (videoId) => {
  selectedVideoId.value = videoId
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
    loadData()
    
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除失败:', error)
    }
  }
}

const handleUploadSuccess = () => {
  loadData()
}

const exportData = () => {
  exporting.value = true
  
  // 模拟导出过程
  setTimeout(() => {
    const csvContent = generateCSV()
    downloadCSV(csvContent, 'subtitles.csv')
    exporting.value = false
    ElMessage.success('导出成功')
  }, 1000)
}

const generateCSV = () => {
  const headers = ['视频编号', '字幕状态', '文件名', '文件大小', '更新时间']
  const rows = tableData.value.map(row => [
    row.video_id,
    row.filename ? '已上传' : '缺失',
    row.filename || '',
    row.file_size ? formatFileSize(row.file_size) : '',
    row.updated_at ? formatDate(row.updated_at) : ''
  ])
  
  return [headers, ...rows].map(row => row.join(',')).join('\n')
}

const downloadCSV = (content, filename) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

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

// 工具函数
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString('zh-CN')
}

// 生命周期
onMounted(() => {
  loadData()
})
</script>

<style scoped>
.dashboard-container {
  padding: 20px;
  background-color: #f5f5f5;
  min-height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-left h1 {
  margin: 0 0 5px 0;
  color: #333;
  font-size: 24px;
}

.header-left p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 15px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  background: white;
  padding: 15px 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.toolbar-left {
  display: flex;
  gap: 10px;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.stat-card {
  cursor: default;
}

.stat-card :deep(.el-card__body) {
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-content {
  flex: 1;
}

.stat-number {
  font-size: 32px;
  font-weight: bold;
  color: #409EFF;
  margin-bottom: 5px;
}

.stat-label {
  color: #666;
  font-size: 14px;
}

.stat-icon {
  font-size: 40px;
  color: #409EFF;
  opacity: 0.3;
}

.table-card {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.action-buttons {
  display: flex;
  gap: 5px;
  justify-content: center;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .dashboard-container {
    padding: 10px;
  }
  
  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: 15px;
  }
  
  .header-right {
    align-self: stretch;
    justify-content: space-between;
  }
  
  .toolbar {
    flex-direction: column;
    gap: 15px;
    align-items: stretch;
  }
  
  .toolbar-right {
    align-self: stretch;
  }
  
  .toolbar-right .el-input {
    width: 100% !important;
  }
  
  .stats-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style> 