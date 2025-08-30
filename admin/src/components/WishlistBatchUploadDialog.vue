<template>
  <el-dialog
    v-model="visible"
    title="批量上传字幕"
    width="800px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @close="handleClose"
  >
    <div class="upload-container">
      <!-- 文件选择区域 -->
      <div class="file-select-area" v-if="!uploading && !uploadComplete">
        <el-upload
          ref="uploadRef"
          class="upload-dragger"
          drag
          multiple
          :auto-upload="false"
          :show-file-list="false"
          :accept="'.srt,.ass,.ssa,.vtt'"
          :on-change="handleFileChange"
          :before-upload="() => false"
        >
          <el-icon class="el-icon--upload"><upload-filled /></el-icon>
          <div class="el-upload__text">
            将字幕文件拖拽到此处，或<em>点击选择文件</em>
          </div>
          <div class="el-upload__tip">
            支持 .srt, .ass, .ssa, .vtt 格式，最多50个文件
          </div>
        </el-upload>
      </div>

      <!-- 文件列表 -->
      <div class="file-list" v-if="fileList.length > 0 && !uploading && !uploadComplete">
        <div class="file-list-header">
          <span>已选择 {{ fileList.length }} 个文件</span>
          <el-button size="small" @click="clearFiles">清空</el-button>
        </div>
        <div class="file-items">
          <div
            v-for="(file, index) in fileList"
            :key="index"
            class="file-item"
            :class="{ 'file-error': file.error }"
          >
            <div class="file-info">
              <el-icon><document /></el-icon>
              <span class="file-name">{{ file.name }}</span>
              <span class="file-size">{{ formatFileSize(file.size) }}</span>
            </div>
            <div class="file-status">
              <el-tag v-if="file.error" type="danger" size="small">{{ file.error }}</el-tag>
              <el-tag v-else type="success" size="small">有效</el-tag>
              <el-button
                size="small"
                type="danger"
                text
                @click="removeFile(index)"
              >
                <el-icon><delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 上传进度 -->
      <div class="upload-progress" v-if="uploading">
        <div class="progress-header">
          <h4>正在上传...</h4>
          <span>{{ uploadedCount }}/{{ totalCount }}</span>
        </div>
        <el-progress
          :percentage="uploadProgress"
          :status="uploadProgress === 100 ? 'success' : undefined"
        />
        <div class="progress-details" v-if="currentFile">
          <span>当前文件: {{ currentFile }}</span>
        </div>
      </div>

      <!-- 上传结果 -->
      <div class="upload-result" v-if="uploadComplete">
        <div class="result-summary">
          <el-result
            :icon="uploadResult.success > 0 ? 'success' : 'warning'"
            :title="getResultTitle()"
            :sub-title="getResultSubTitle()"
          >
            <template #extra>
              <div class="result-stats">
                <div class="stat-item success">
                  <span class="stat-number">{{ uploadResult.success }}</span>
                  <span class="stat-label">成功</span>
                </div>
                <div class="stat-item warning" v-if="uploadResult.skipped > 0">
                  <span class="stat-number">{{ uploadResult.skipped }}</span>
                  <span class="stat-label">跳过</span>
                </div>
                <div class="stat-item danger" v-if="uploadResult.failed > 0">
                  <span class="stat-number">{{ uploadResult.failed }}</span>
                  <span class="stat-label">失败</span>
                </div>
              </div>
            </template>
          </el-result>
        </div>

        <!-- 详细结果 -->
        <div class="result-details" v-if="uploadResult.details && uploadResult.details.length > 0">
          <el-collapse>
            <el-collapse-item title="查看详细结果" name="details">
              <div class="detail-list">
                <div
                  v-for="(detail, index) in uploadResult.details"
                  :key="index"
                  class="detail-item"
                  :class="detail.status"
                >
                  <div class="detail-info">
                    <el-icon v-if="detail.status === 'success'"><check /></el-icon>
                    <el-icon v-else-if="detail.status === 'skipped'"><warning /></el-icon>
                    <el-icon v-else><close /></el-icon>
                    <span class="detail-filename">{{ detail.filename }}</span>
                  </div>
                  <div class="detail-message">{{ detail.message }}</div>
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose" :disabled="uploading">
          {{ uploading ? '上传中...' : '取消' }}
        </el-button>
        <el-button
          v-if="!uploading && !uploadComplete"
          type="primary"
          @click="startUpload"
          :disabled="!canUpload"
        >
          开始上传 ({{ validFileCount }})
        </el-button>
        <el-button
          v-if="uploadComplete"
          type="primary"
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
import { UploadFilled, Document, Delete, Check, Warning, Close } from '@element-plus/icons-vue'
import { subtitleAPI } from '../utils/api'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'success'])

// 响应式数据
const visible = ref(false)
const uploadRef = ref()
const fileList = ref([])
const uploading = ref(false)
const uploadComplete = ref(false)
const uploadProgress = ref(0)
const uploadedCount = ref(0)
const totalCount = ref(0)
const currentFile = ref('')

const uploadResult = ref({
  success: 0,
  failed: 0,
  skipped: 0,
  details: []
})

// 计算属性
const validFileCount = computed(() => {
  return fileList.value.filter(file => !file.error).length
})

const canUpload = computed(() => {
  return validFileCount.value > 0 && !uploading.value
})

// 监听 modelValue 变化
watch(() => props.modelValue, (val) => {
  visible.value = val
  if (val) {
    resetDialog()
  }
})

watch(visible, (val) => {
  emit('update:modelValue', val)
})

// 方法
const resetDialog = () => {
  fileList.value = []
  uploading.value = false
  uploadComplete.value = false
  uploadProgress.value = 0
  uploadedCount.value = 0
  totalCount.value = 0
  currentFile.value = ''
  uploadResult.value = {
    success: 0,
    failed: 0,
    skipped: 0,
    details: []
  }
}

const handleFileChange = (file, files) => {
  // 限制文件数量
  if (files.length > 50) {
    ElMessage.warning('最多只能选择50个文件')
    return
  }

  // 验证并处理文件
  const processedFiles = files.map(f => {
    const fileObj = {
      name: f.name,
      size: f.size,
      raw: f.raw,
      error: null
    }

    // 验证文件名格式 (视频编号.扩展名)
    const nameMatch = f.name.match(/^([A-Za-z0-9_-]+)\.(srt|ass|ssa|vtt)$/i)
    if (!nameMatch) {
      fileObj.error = '文件名格式错误，应为：视频编号.扩展名'
      return fileObj
    }

    // 验证文件大小 (最大10MB)
    if (f.size > 10 * 1024 * 1024) {
      fileObj.error = '文件大小超过10MB'
      return fileObj
    }

    // 验证文件类型
    const allowedTypes = ['.srt', '.ass', '.ssa', '.vtt']
    const ext = '.' + nameMatch[2].toLowerCase()
    if (!allowedTypes.includes(ext)) {
      fileObj.error = '不支持的文件格式'
      return fileObj
    }

    return fileObj
  })

  fileList.value = processedFiles
}

const removeFile = (index) => {
  fileList.value.splice(index, 1)
}

const clearFiles = () => {
  fileList.value = []
  if (uploadRef.value) {
    uploadRef.value.clearFiles()
  }
}

const startUpload = async () => {
  const validFiles = fileList.value.filter(file => !file.error)
  if (validFiles.length === 0) {
    ElMessage.warning('没有有效的文件可以上传')
    return
  }

  uploading.value = true
  uploadComplete.value = false
  totalCount.value = validFiles.length
  uploadedCount.value = 0
  uploadProgress.value = 0

  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    details: []
  }

  try {
    // 准备FormData
    const formData = new FormData()
    validFiles.forEach(file => {
      formData.append('files', file.raw)
    })

    currentFile.value = '正在上传...'
    
    // 调用批量上传API
    const response = await subtitleAPI.batchUpload(formData)
    
    // 处理响应结果
    results.success = response.summary?.success || 0
    results.failed = response.summary?.failed || 0
    results.skipped = response.summary?.skipped || 0
    results.details = response.results || []

    uploadProgress.value = 100
    uploadedCount.value = totalCount.value
    
  } catch (error) {
    console.error('批量上传失败:', error)
    ElMessage.error('批量上传失败: ' + (error.message || '未知错误'))
    
    // 设置失败结果
    results.failed = validFiles.length
    results.details = validFiles.map(file => ({
      filename: file.name,
      status: 'failed',
      message: error.message || '上传失败'
    }))
  } finally {
    uploading.value = false
    uploadComplete.value = true
    uploadResult.value = results
    currentFile.value = ''
    
    // 如果有成功上传的文件，触发成功事件
    if (results.success > 0) {
      emit('success')
    }
  }
}

const getResultTitle = () => {
  const { success, failed, skipped } = uploadResult.value
  if (failed === 0 && skipped === 0) {
    return '上传完成'
  } else if (success > 0) {
    return '部分上传成功'
  } else {
    return '上传失败'
  }
}

const getResultSubTitle = () => {
  const { success, failed, skipped } = uploadResult.value
  const total = success + failed + skipped
  return `共 ${total} 个文件，成功 ${success} 个${failed > 0 ? `，失败 ${failed} 个` : ''}${skipped > 0 ? `，跳过 ${skipped} 个` : ''}`
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const handleClose = () => {
  if (uploading.value) {
    ElMessage.warning('上传进行中，无法关闭')
    return
  }
  visible.value = false
}
</script>

<style scoped>
.upload-container {
  min-height: 300px;
}

.file-select-area {
  margin-bottom: 20px;
}

.upload-dragger {
  width: 100%;
}

.upload-dragger :deep(.el-upload-dragger) {
  width: 100%;
  height: 180px;
  border: 2px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s;
}

.upload-dragger :deep(.el-upload-dragger:hover) {
  border-color: #409eff;
}

.file-list {
  margin-bottom: 20px;
}

.file-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.file-items {
  max-height: 300px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  margin-bottom: 8px;
  background-color: #fafafa;
}

.file-item.file-error {
  border-color: #f56c6c;
  background-color: #fef0f0;
}

.file-info {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 8px;
}

.file-name {
  font-weight: 500;
  color: #303133;
}

.file-size {
  color: #909399;
  font-size: 12px;
}

.file-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.upload-progress {
  padding: 20px;
  background-color: #f8f9fa;
  border-radius: 6px;
  margin-bottom: 20px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.progress-header h4 {
  margin: 0;
  color: #303133;
}

.progress-details {
  margin-top: 10px;
  color: #606266;
  font-size: 14px;
}

.upload-result {
  text-align: center;
}

.result-stats {
  display: flex;
  justify-content: center;
  gap: 30px;
  margin-top: 20px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-number {
  font-size: 24px;
  font-weight: bold;
  margin-bottom: 4px;
}

.stat-item.success .stat-number {
  color: #67c23a;
}

.stat-item.warning .stat-number {
  color: #e6a23c;
}

.stat-item.danger .stat-number {
  color: #f56c6c;
}

.stat-label {
  font-size: 12px;
  color: #909399;
}

.result-details {
  margin-top: 20px;
  text-align: left;
}

.detail-list {
  max-height: 200px;
  overflow-y: auto;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #ebeef5;
}

.detail-item:last-child {
  border-bottom: none;
}

.detail-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-filename {
  font-weight: 500;
}

.detail-item.success .detail-info {
  color: #67c23a;
}

.detail-item.skipped .detail-info {
  color: #e6a23c;
}

.detail-item.failed .detail-info {
  color: #f56c6c;
}

.detail-message {
  color: #606266;
  font-size: 12px;
}

.dialog-footer {
  text-align: right;
}
</style>