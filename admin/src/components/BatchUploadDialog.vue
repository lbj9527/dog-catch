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
        <p>1. 支持同时选择多个 .srt 或 .vtt 格式的字幕文件</p>
        <p>2. 文件名应包含视频编号，如：hmn-387.srt</p>
        <p>3. 系统会自动从文件名中提取视频编号</p>
        <p>4. 单个文件大小不超过 1MB</p>
      </el-alert>
      
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :multiple="true"
        :accept="'.srt,.vtt'"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
        :file-list="fileList"
        drag
        class="batch-upload"
      >
        <el-icon class="el-icon--upload"><upload-filled /></el-icon>
        <div class="el-upload__text">
          将多个字幕文件拖到此处，或<em>点击选择文件</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            支持 .srt 和 .vtt 格式，单个文件不超过 1MB
          </div>
        </template>
      </el-upload>
      
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
import { ref, computed, watch } from 'vue'
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

// 监听器
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    resetData()
  }
})

// 方法
const handleFileChange = (file, files) => {
  // 验证文件
  const validation = validateFile(file)
  if (!validation.valid) {
    ElMessage.error(validation.message)
    // 从文件列表中移除无效文件
    const index = files.findIndex(f => f.uid === file.uid)
    if (index > -1) {
      files.splice(index, 1)
    }
    return
  }
  
  // 解析文件信息
  parseFiles(files)
}

const handleFileRemove = (file, files) => {
  parseFiles(files)
}

const validateFile = (file) => {
  // 验证文件类型
  const allowedTypes = ['.srt', '.vtt']
  const fileExt = '.' + file.name.split('.').pop().toLowerCase()
  
  if (!allowedTypes.includes(fileExt)) {
    return {
      valid: false,
      message: `文件 "${file.name}" 格式不支持，只支持 .srt 和 .vtt 格式`
    }
  }
  
  // 验证文件大小 (1MB)
  if (file.size > 1024 * 1024) {
    return {
      valid: false,
      message: `文件 "${file.name}" 大小超过 1MB 限制`
    }
  }
  
  return { valid: true }
}

const parseFiles = (files) => {
  parsedFiles.value = files.map(file => {
    const videoId = extractVideoId(file.name)
    return {
      uid: file.uid,
      fileName: file.name,
      videoId: videoId,
      size: file.size,
      file: file.raw,
      status: videoId ? 'valid' : 'invalid'
    }
  })
}

const extractVideoId = (fileName) => {
  // 从文件名中提取视频编号
  // 支持格式：hmn-387.srt, jufd-924.vtt, abc-123-uncensored.srt 等
  const match = fileName.match(/([a-z0-9]+-[0-9]+)/i)
  return match ? match[1] : null
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
      await subtitleAPI.upload(fileInfo.videoId, fileInfo.file)
      
      uploadResults.value.push({
        fileName: fileInfo.fileName,
        videoId: fileInfo.videoId,
        success: true,
        message: '上传成功'
      })
      
    } catch (error) {
      let errorMessage = '上传失败'
      if (error.response?.data?.error) {
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