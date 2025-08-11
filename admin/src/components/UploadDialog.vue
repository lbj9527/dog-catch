<template>
  <el-dialog
    v-model="visible"
    :title="isUpdate ? '更新字幕文件' : '上传字幕文件'"
    width="500px"
    :before-close="handleClose"
  >
    <el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
      <el-form-item label="视频编号" prop="videoId">
        <el-input
          v-model="form.videoId"
          placeholder="请输入视频编号，如：hmn-387"
          :disabled="!!videoId"
        />
      </el-form-item>
      
      <el-form-item label="字幕文件" prop="file">
        <el-upload
          ref="uploadRef"
          :auto-upload="false"
          :limit="1"
          :accept="'.srt,.vtt'"
          :on-change="handleFileChange"
          :on-remove="handleFileRemove"
          :file-list="fileList"
          drag
        >
          <el-icon class="el-icon--upload"><upload-filled /></el-icon>
          <div class="el-upload__text">
            将字幕文件拖到此处，或<em>点击上传</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">
              只能上传 .srt 或 .vtt 格式文件，且不超过 1MB
            </div>
          </template>
        </el-upload>
      </el-form-item>
      
      <el-form-item v-if="currentFile" label="文件信息">
        <div class="file-info">
          <p><strong>文件名：</strong>{{ currentFile.name }}</p>
          <p><strong>文件大小：</strong>{{ formatFileSize(currentFile.size) }}</p>
          <p><strong>文件类型：</strong>{{ getFileType(currentFile.name) }}</p>
        </div>
      </el-form-item>
    </el-form>
    
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          @click="handleSubmit"
          :loading="uploading"
          :disabled="!currentFile || !form.videoId"
        >
          {{ uploading ? '上传中...' : (isUpdate ? '更新' : '上传') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { subtitleAPI } from '../utils/api'

// Props
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  videoId: {
    type: String,
    default: ''
  }
})

// Emits
const emit = defineEmits(['update:modelValue', 'success'])

// 响应式数据
const formRef = ref()
const uploadRef = ref()
const uploading = ref(false)
const currentFile = ref(null)
const fileList = ref([])

const form = reactive({
  videoId: '',
  file: null
})

const rules = {
  videoId: [
    { required: true, message: '请输入视频编号', trigger: 'blur' },
    { 
      pattern: /^[a-z0-9]+-[0-9]+$/i, 
      message: '视频编号格式不正确，如：hmn-387', 
      trigger: 'blur' 
    }
  ],
  file: [
    { required: true, message: '请选择字幕文件', trigger: 'change' }
  ]
}

// 计算属性
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const isUpdate = computed(() => !!props.videoId)

// 监听器
watch(() => props.videoId, (newVal) => {
  if (newVal) {
    form.videoId = newVal
  }
}, { immediate: true })

watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    resetForm()
  }
})

// 方法
const handleFileChange = (file) => {
  // 验证文件类型
  const allowedTypes = ['.srt', '.vtt']
  const fileExt = '.' + file.name.split('.').pop().toLowerCase()
  
  if (!allowedTypes.includes(fileExt)) {
    ElMessage.error('只支持 .srt 和 .vtt 格式的字幕文件')
    return false
  }
  
  // 验证文件大小 (1MB)
  if (file.size > 1024 * 1024) {
    ElMessage.error('文件大小不能超过 1MB')
    return false
  }
  
  currentFile.value = file.raw
  form.file = file.raw
  
  // 清除验证错误
  if (formRef.value) {
    formRef.value.clearValidate('file')
  }
}

const handleFileRemove = () => {
  currentFile.value = null
  form.file = null
  fileList.value = []
}

const handleSubmit = async () => {
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
    
    if (!currentFile.value) {
      ElMessage.error('请选择字幕文件')
      return
    }
    
    uploading.value = true
    
    // 根据是否有videoId判断是上传还是更新
    if (isUpdate.value) {
      await subtitleAPI.update(form.videoId, currentFile.value)
      ElMessage.success('字幕文件更新成功')
    } else {
      await subtitleAPI.upload(form.videoId, currentFile.value)
      ElMessage.success('字幕文件上传成功')
    }
    
    emit('success')
    handleClose()
    
  } catch (error) {
    console.error('操作失败:', error)
  } finally {
    uploading.value = false
  }
}

const handleClose = () => {
  if (!uploading.value) {
    visible.value = false
    resetForm()
  }
}

const resetForm = () => {
  if (formRef.value) {
    formRef.value.resetFields()
  }
  currentFile.value = null
  fileList.value = []
  form.videoId = props.videoId || ''
  form.file = null
  uploading.value = false
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getFileType = (filename) => {
  const ext = filename.split('.').pop().toLowerCase()
  const types = {
    'srt': 'SubRip 字幕文件',
    'vtt': 'WebVTT 字幕文件'
  }
  return types[ext] || '未知格式'
}
</script>

<style scoped>
.file-info {
  padding: 15px;
  background-color: #f5f7fa;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
}

.file-info p {
  margin: 5px 0;
  font-size: 14px;
  color: #606266;
}

.dialog-footer {
  text-align: right;
}

:deep(.el-upload-dragger) {
  width: 100%;
}

:deep(.el-upload__tip) {
  margin-top: 10px;
  font-size: 12px;
  color: #999;
}
</style> 