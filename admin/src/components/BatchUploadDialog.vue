<template>
  <el-dialog
    v-model="visible"
    title="批量上传字幕文件"
    width="600px"
    :before-close="handleClose"
  >
    <div class="batch-upload-container">
      <el-alert
        title="批量上传说明"
        type="info"
        :closable="false"
        style="margin-bottom: 20px"
      >
        <p>1. 选择一个文件夹后，将自动递归扫描其中的 .srt、.vtt、.ass、.ssa 字幕文件</p>
        <p>2. 文件名应包含视频编号，如：hmn-387.srt</p>
        <p>3. 系统会自动从文件名中提取视频编号</p>
        <p>4. 单个文件大小不超过 1MB</p>
      </el-alert>
      
      <!-- 改为选择文件夹并递归扫描 -->
      <div class="folder-select">
        <el-button type="primary" @click="triggerSelectFolder">
          选择文件夹
        </el-button>
        <span class="folder-tip">将自动递归扫描子文件夹；仅导入 .srt/.vtt/.ass/.ssa，单文件 ≤ 1MB</span>
        <input
          ref="dirInput"
          type="file"
          style="display:none"
          webkitdirectory
          directory
          multiple
          accept=".srt,.vtt,.ass,.ssa"
          @change="handleDirectoryChange"
        />
      </div>
      
      <!-- 扫描结果统计 -->
      <div v-if="parsedFiles.length > 0" class="scan-results">
        <div class="scan-summary">
          <span>扫描结果：</span>
          <el-tag type="success" size="small">有效 {{ validFiles.length }}</el-tag>
          <el-tag v-if="invalidCount > 0" type="danger" size="small">无效 {{ invalidCount }}</el-tag>
          <el-button 
            v-if="invalidCount > 0" 
            type="primary" 
            size="small" 
            @click="downloadInvalidList"
            style="margin-left: 10px;"
          >
            下载无效文件清单
          </el-button>
        </div>
      </div>
      
      <!-- 文件列表 -->
      <div v-if="parsedFiles.length > 0" class="file-list">
        <h4>待上传文件列表 ({{ parsedFiles.length }} 个)</h4>
        <el-table :data="parsedFiles" size="small" max-height="300">
          <el-table-column label="文件名" prop="fileName" min-width="200" />
          <el-table-column label="视频编号" prop="videoId" width="120">
            <template #default="scope">
              <el-tag v-if="scope.row.videoId" type="success" size="small">
                {{ scope.row.videoId }}
              </el-tag>
              <el-tag v-else type="danger" size="small">无法识别</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="文件大小" prop="size" width="100" align="right">
            <template #default="scope">
              {{ formatFileSize(scope.row.size) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" prop="status" width="100" align="center">
            <template #default="scope">
              <el-tag 
                :type="getStatusType(scope.row.status)" 
                size="small"
              >
                {{ getStatusText(scope.row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      
      <!-- 上传进度 -->
      <div v-if="uploading" class="upload-progress">
        <h4>上传进度</h4>
        <el-progress
          :percentage="uploadProgress"
          :status="uploadStatus"
          :stroke-width="8"
        >
          <template #default="{ percentage }">
            <span>{{ uploadedCount }}/{{ totalCount }} ({{ percentage }}%)</span>
          </template>
        </el-progress>
        <p class="progress-text">{{ uploadStatusText }}</p>
      </div>
      
      <!-- 上传结果 -->
      <div v-if="uploadResults.length > 0 && !uploading" class="upload-results">
        <h4>上传结果</h4>
        <div class="result-summary">
          <el-tag type="success">成功: {{ successCount }}</el-tag>
          <el-tag type="danger">失败: {{ failedCount }}</el-tag>
        </div>
        <el-table :data="uploadResults" size="small" max-height="200">
          <el-table-column label="文件名" prop="fileName" min-width="200" />
          <el-table-column label="视频编号" prop="videoId" width="120" />
          <el-table-column label="结果" prop="success" width="80" align="center">
            <template #default="scope">
              <el-icon v-if="scope.row.success" color="green"><Check /></el-icon>
              <el-icon v-else color="red"><Close /></el-icon>
            </template>
          </el-table-column>
          <el-table-column label="信息" prop="message" min-width="150">
            <template #default="scope">
              <span :style="{ color: scope.row.success ? 'green' : 'red' }">
                {{ scope.row.message }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
    
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose" :disabled="uploading">
          {{ uploadResults.length > 0 ? '关闭' : '取消' }}
        </el-button>
        <el-button
          v-if="!uploadResults.length"
          type="primary"
          @click="handleBatchUpload"
          :loading="uploading"
          :disabled="validFiles.length === 0"
        >
          {{ uploading ? '上传中...' : `批量上传 (${validFiles.length})` }}
        </el-button>
        <el-button
          v-else
          type="success"
          @click="handleClose"
        >
          完成
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Check, Close } from '@element-plus/icons-vue'
import { subtitleAPI } from '../utils/api'

// Props
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['update:modelValue', 'success'])

// 响应式数据
const uploadRef = ref()
const fileList = ref([])
const parsedFiles = ref([])
const uploading = ref(false)
const uploadResults = ref([])
const uploadedCount = ref(0)
const totalCount = ref(0)
const uploadStatusText = ref('')
// 新增：目录选择 input 引用
const dirInput = ref()
// 新增：无效文件名集合
const invalidFileNames = ref(new Set())

// 计算属性
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const validFiles = computed(() => {
  return parsedFiles.value.filter(file => file.videoId && file.status === 'valid')
})

const uploadProgress = computed(() => {
  if (totalCount.value === 0) return 0
  return Math.round((uploadedCount.value / totalCount.value) * 100)
})

const uploadStatus = computed(() => {
  if (uploading.value) return 'active'
  if (uploadResults.value.length > 0) {
    return failedCount.value > 0 ? 'exception' : 'success'
  }
  return 'normal'
})

const successCount = computed(() => {
  return uploadResults.value.filter(result => result.success).length
})

const failedCount = computed(() => {
  return uploadResults.value.filter(result => !result.success).length
})

const invalidCount = computed(() => {
  return invalidFileNames.value.size
})

// 监听器
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    resetData()
  }
})

// 生命周期钩子 - 组件卸载前清理
onBeforeUnmount(() => {
  resetData()
})

// 方法
const handleFileChange = (file, files) => {
  // 兼容保留：若有拖入文件（非目录），仍按原逻辑解析
  const validation = validateFile(file)
  if (!validation.valid) {
    ElMessage.error(validation.message)
    const index = files.findIndex(f => f.uid === file.uid)
    if (index > -1) {
      files.splice(index, 1)
    }
    return
  }
  parseFiles(files)
}

const handleFileRemove = (file, files) => {
  parseFiles(files)
}

// 新增：触发选择文件夹
const triggerSelectFolder = () => {
  if (dirInput.value) dirInput.value.click()
}

// 新增：处理目录选择结果（递归文件由浏览器提供 files 列表）
const handleDirectoryChange = (e) => {
  const files = Array.from(e.target.files || [])
  if (files.length === 0) {
    parsedFiles.value = []
    return
  }
  const allowedTypes = ['.srt', '.vtt', '.ass', '.ssa']
  const filtered = []
  for (const f of files) {
    const ext = '.' + f.name.split('.').pop().toLowerCase()
    if (!allowedTypes.includes(ext)) continue
    if (f.size > 1024 * 1024) continue
    filtered.push(f)
  }
  // 重置无效文件名集合
  invalidFileNames.value.clear()
  
  parsedFiles.value = filtered.map((file, idx) => {
    const videoId = extractVideoId(file.name)
    // 记录无效文件名
    if (!videoId) {
      invalidFileNames.value.add(file.name)
    }
    return {
      uid: `${Date.now()}_${idx}`,
      fileName: file.name,
      videoId: videoId,
      size: file.size,
      file: file,
      status: videoId ? 'valid' : 'invalid'
    }
  })
  // 对相同视频编号的文件，按扩展名优先级排序：.srt → .vtt → .ass/.ssa
  parsedFiles.value.sort((a, b) => {
    const byId = (a.videoId || '').localeCompare(b.videoId || '')
    if (byId !== 0) return byId
    const prio = (name) => {
      const ext = (name.split('.').pop() || '').toLowerCase()
      if (ext === 'srt') return 0
      if (ext === 'vtt') return 1
      if (ext === 'ass' || ext === 'ssa') return 2
      return 9
    }
    const byExt = prio(a.fileName) - prio(b.fileName)
    if (byExt !== 0) return byExt
    return (a.fileName || '').localeCompare(b.fileName || '')
  })
  // 重置进度/结果
  uploadResults.value = []
  uploadedCount.value = 0
  totalCount.value = 0
  uploadStatusText.value = ''
}

const validateFile = (file) => {
  const allowedTypes = ['.srt', '.vtt', '.ass', '.ssa']
  const fileExt = '.' + file.name.split('.').pop().toLowerCase()
  
  if (!allowedTypes.includes(fileExt)) {
    return {
      valid: false,
      message: `文件 "${file.name}" 格式不支持，只支持 .srt、.vtt、.ass、.ssa 格式`
    }
  }
  
  if (file.size > 1024 * 1024) {
    return {
      valid: false,
      message: `文件 "${file.name}" 大小超过 1MB 限制`
    }
  }
  
  return { valid: true }
}

const parseFiles = (files) => {
  // 重置无效文件名集合
  invalidFileNames.value.clear()
  
  parsedFiles.value = files.map(file => {
    const videoId = extractVideoId(file.name)
    // 记录无效文件名
    if (!videoId) {
      invalidFileNames.value.add(file.name)
    }
    return {
      uid: file.uid,
      fileName: file.name,
      videoId: videoId,
      size: file.size,
      file: file.raw,
      status: videoId ? 'valid' : 'invalid'
    }
  })
  // 同一编号优先上传 .srt，再 .vtt，最后 .ass/.ssa，确保基础号尽量落在 .srt 上
  parsedFiles.value.sort((a, b) => {
    const byId = (a.videoId || '').localeCompare(b.videoId || '')
    if (byId !== 0) return byId
    const prio = (name) => {
      const ext = (name.split('.').pop() || '').toLowerCase()
      if (ext === 'srt') return 0
      if (ext === 'vtt') return 1
      if (ext === 'ass' || ext === 'ssa') return 2
      return 9
    }
    const byExt = prio(a.fileName) - prio(b.fileName)
    if (byExt !== 0) return byExt
    return (a.fileName || '').localeCompare(b.fileName || '')
  })
}

const extractVideoId = (fileName) => {
  const base = (fileName || '').replace(/\.[^/.]+$/, '')
  // 优先：已有连字符，如 JUL-721
  let m = base.match(/([a-z]+)-(\d{2,5})/i)
  if (m) return `${m[1]}-${m[2]}`.toUpperCase()
  // 其次：无连字符的字母+数字，如 NAKA008 -> NAKA-008
  m = base.match(/([a-z]+)(\d{2,5})/i)
  if (m) return `${m[1]}-${m[2]}`.toUpperCase()
  // 新增：字母+空格+数字，如 ABP 744 -> ABP-744
  m = base.match(/([a-z]+)\s+(\d{2,5})/i)
  if (m) return `${m[1]}-${m[2]}`.toUpperCase()
  return null
}

const handleBatchUpload = async () => {
  if (validFiles.value.length === 0) {
    ElMessage.error('没有有效的文件可以上传')
    return
  }
  
  uploading.value = true
  uploadResults.value = []
  uploadedCount.value = 0
  totalCount.value = validFiles.value.length
  
  for (const fileInfo of validFiles.value) {
    uploadStatusText.value = `正在上传: ${fileInfo.fileName}`
    
    try {
      const res = await subtitleAPI.upload(fileInfo.videoId, fileInfo.file)
      const finalId = res?.subtitle?.video_id || fileInfo.videoId
      
      uploadResults.value.push({
        fileName: fileInfo.fileName,
        videoId: finalId,
        success: true,
        message: '上传成功'
      })
      
    } catch (error) {
      let errorMessage = '上传失败'
      if (error.response?.status === 409) {
        const exists = error.response.data?.exists_video_id
        errorMessage = `内容重复，已存在：${exists || '已存在字幕'}`
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error
      } else if (error.message) {
        errorMessage = error.message
      }
      
      uploadResults.value.push({
        fileName: fileInfo.fileName,
        videoId: fileInfo.videoId,
        success: false,
        message: errorMessage
      })
    }
    
    uploadedCount.value++
  }
  
  uploading.value = false
  uploadStatusText.value = `上传完成：成功 ${successCount.value} 个，失败 ${failedCount.value} 个`
  
  if (successCount.value > 0) {
    emit('success')
  }
  
  if (failedCount.value === 0) {
    ElMessage.success(`批量上传完成，共成功上传 ${successCount.value} 个文件`)
  } else {
    ElMessage.warning(`批量上传完成，成功 ${successCount.value} 个，失败 ${failedCount.value} 个`)
  }
}

const handleClose = () => {
  if (!uploading.value) {
    visible.value = false
    resetData()
  }
}

const resetData = () => {
  fileList.value = []
  parsedFiles.value = []
  uploadResults.value = []
  uploadedCount.value = 0
  totalCount.value = 0
  uploadStatusText.value = ''
  uploading.value = false
  // 重置无效文件名集合
  invalidFileNames.value.clear()
}

// 新增：下载无效文件清单
const downloadInvalidList = () => {
  if (invalidFileNames.value.size === 0) {
    ElMessage.warning('暂无无效文件')
    return
  }
  
  try {
    // 生成文件内容
    const content = Array.from(invalidFileNames.value).join('\n')
    
    // 生成文件名
    const now = new Date()
    const dateStr = now.getFullYear() + 
      String(now.getMonth() + 1).padStart(2, '0') + 
      String(now.getDate()).padStart(2, '0') + '-' +
      String(now.getHours()).padStart(2, '0') + 
      String(now.getMinutes()).padStart(2, '0') + 
      String(now.getSeconds()).padStart(2, '0')
    const fileName = `无效文件清单-${dateStr}.txt`
    
    // 创建 Blob 并下载
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    
    ElMessage.success('无效文件清单下载成功')
  } catch (error) {
    console.error('下载失败:', error)
    ElMessage.error('下载失败，请重试')
  }
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getStatusType = (status) => {
  return status === 'valid' ? 'success' : 'danger'
}

const getStatusText = (status) => {
  return status === 'valid' ? '有效' : '无效'
}
</script>

<style scoped>
.batch-upload-container {
  max-height: 70vh;
  overflow-y: auto;
}

/* 新增：文件夹选择区域样式 */
.folder-select {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  background-color: #fafafa;
}

.folder-tip {
  color: #909399;
  font-size: 12px;
}

.scan-results {
  margin-top: 15px;
  padding: 12px;
  background-color: #f0f9ff;
  border-radius: 4px;
  border: 1px solid #b3d8ff;
}

.scan-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #333;
}

.batch-upload :deep(.el-upload-dragger) {
  width: 100%;
  height: 120px;
}

.file-list {
  margin-top: 20px;
  padding: 15px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.file-list h4 {
  margin: 0 0 15px 0;
  color: #333;
}

.upload-progress {
  margin-top: 20px;
  padding: 15px;
  background-color: #f0f9ff;
  border-radius: 4px;
  border: 1px solid #b3d8ff;
}

.upload-progress h4 {
  margin: 0 0 15px 0;
  color: #333;
}

.progress-text {
  margin: 10px 0 0 0;
  font-size: 14px;
  color: #666;
}

.upload-results {
  margin-top: 20px;
  padding: 15px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.upload-results h4 {
  margin: 0 0 15px 0;
  color: #333;
}

.result-summary {
  margin-bottom: 15px;
  display: flex;
  gap: 10px;
}

.dialog-footer {
  text-align: right;
}

:deep(.el-upload__tip) {
  margin-top: 10px;
  font-size: 12px;
  color: #999;
}

:deep(.el-alert__content) {
  padding: 0;
}

:deep(.el-alert__content p) {
  margin: 2px 0;
  font-size: 13px;
}
</style>