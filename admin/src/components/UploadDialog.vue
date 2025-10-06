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
          :disabled="isUpdate"
        />
      </el-form-item>
      
      <el-form-item label="字幕文件" prop="file">
        <el-upload
          ref="uploadRef"
          :auto-upload="false"
          :limit="1"
          :accept="'.srt,.vtt,.ass,.ssa'"
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
              只能上传 .srt、.vtt、.ass、.ssa 格式文件，且不超过 1MB
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
        <el-button @click="handleClose">
          {{ uploadSuccess ? '关闭' : '取消' }}
        </el-button>
        <template v-if="!uploadSuccess">
          <el-button
            type="primary"
            @click="handleSubmit"
            :loading="uploading"
            :disabled="!currentFile || !form.videoId"
          >
            {{ uploading ? '上传中...' : (isUpdate ? '更新' : '上传') }}
          </el-button>
        </template>
        <template v-else>
          <el-button type="success" @click="handleClose">完成</el-button>
        </template>
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
const uploadSuccess = ref(false)
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
  const allowedTypes = ['.srt', '.vtt', '.ass', '.ssa']
  const fileExt = '.' + file.name.split('.').pop().toLowerCase()
  
  if (!allowedTypes.includes(fileExt)) {
    ElMessage.error('只支持 .srt、.vtt、.ass、.ssa 格式的字幕文件')
    return false
  }
  
  // 验证文件大小 (1MB)
  if (file.size > 1024 * 1024) {
    ElMessage.error('文件大小不能超过 1MB')
    return false
  }
  
  currentFile.value = file.raw
  form.file = file.raw
  
  // 从文件名自动提取视频编号（如：JUL-721-zh-CN.srt → JUL-721）
  if (!isUpdate.value && !form.videoId) {
    const matchedId = extractVideoId(file.name)
    if (matchedId) {
      form.videoId = matchedId.toUpperCase()
      if (formRef.value) {
        formRef.value.clearValidate('videoId')
      }
    }
  }

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
    
    if (isUpdate.value) {
      const res = await subtitleAPI.update(form.videoId, currentFile.value)
      ElMessage.success(`字幕文件更新成功${res?.subtitle?.video_id ? `（编号：${res.subtitle.video_id}）` : ''}`)
    } else {
      const res = await subtitleAPI.upload(form.videoId, currentFile.value)
      if (res?.subtitle?.video_id && res.subtitle.video_id.toUpperCase() !== form.videoId.toUpperCase()) {
        ElMessage.success(`上传成功，已分配为：${res.subtitle.video_id}`)
      } else {
        ElMessage.success('字幕文件上传成功')
      }
    }

    emit('success')
    uploadSuccess.value = true
    
  } catch (error) {
    if (error?.response?.status === 409) {
      const exists = error.response.data?.exists_video_id
      ElMessage.warning(`内容重复，已存在：${exists || '已存在字幕'}`)
    } else {
      console.error('操作失败:', error)
      ElMessage.error('操作失败')
    }
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
  uploadSuccess.value = false
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
    'vtt': 'WebVTT 字幕文件',
    'ass': 'Advanced SubStation Alpha 字幕文件',
    'ssa': 'SubStation Alpha 字幕文件'
  }
  return types[ext] || '未知格式'
}

const extractVideoId = (fileName) => {
  const base = (fileName || '').replace(/\.[^/.]+$/, '')
  
  // 特殊格式处理
  // 1. (1pondo)(061016_314)コスプレイヤーをお貸しします 川越ゆい -> PONDO-061016_314
  let m = base.match(/\(1pondo\)\((\d{6}_\d{3})\)/i)
  if (m) return `PONDO-${m[1]}`
  
  // 2. 1Pondo-030615_039 秋野千尋 -> PONDO-030615_039
  m = base.match(/1Pondo-(\d{6}_\d{3})/i)
  if (m) return `PONDO-${m[1]}`
  
  // 3. 022720_979-1pon -> PON-022720_979
  m = base.match(/(\d{6}_\d{3})-1pon/i)
  if (m) return `PON-${m[1]}`
  
  // 4. 040816_276-1pon-1080p -> PON-040816_276
  m = base.match(/(\d{6}_\d{3})-1pon/i)
  if (m) return `PON-${m[1]}`
  
  // 5. 050420_01-10mu-1080p -> MU-050420_01
  m = base.match(/(\d{6}_\d{2})-10mu/i)
  if (m) return `MU-${m[1]}`
  
  // 6. 051620_01-10mu -> MU-051620_01
  m = base.match(/(\d{6}_\d{2})-10mu/i)
  if (m) return `MU-${m[1]}`
  
  // 7. 080616-225-carib-1080p -> CARIB-080616_225
  m = base.match(/(\d{6})-(\d{3})-carib/i)
  if (m) return `CARIB-${m[1]}_${m[2]}`
  
  // 8. 081520_344-paco-1080p -> PACO-081520_344
  m = base.match(/(\d{6}_\d{3})-paco/i)
  if (m) return `PACO-${m[1]}`
  
  // 9. 112615_431-caribpr-high -> CARIBPR-112615_431
  m = base.match(/(\d{6}_\d{3})-caribpr/i)
  if (m) return `CARIBPR-${m[1]}`
  
  // 10. n0310 -> N0310
  m = base.match(/^n(\d{4})$/i)
  if (m) return `N${m[1]}`
  
  // 11. N0417 -> N0417 (已经是正确格式)
  m = base.match(/^N(\d{4})$/i)
  if (m) return `N${m[1]}`
  
  // 12. Tokyo-Hot-n1004 -> N1004
  m = base.match(/Tokyo-Hot-n(\d{4})/i)
  if (m) return `N${m[1]}`
  
  // 13. Tokyo-Hot_k1179餌食牝_美咲結衣 -> K1179
  m = base.match(/Tokyo-Hot[_-]k(\d{4})/i)
  if (m) return `K${m[1]}`
  
  // 14. 010210-259 -> 010210-259 (保持原格式)
  m = base.match(/^(\d{6}-\d{3})/)
  if (m) return m[1]
  
  // 15. 012415_01 -> 012415-01 (下划线转连字符)
  m = base.match(/^(\d{6})_(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}`
  
  // 16. 080416_353 -> 080416-353 (下划线转连字符，3位数字)
  m = base.match(/^(\d{6})_(\d{3})$/)
  if (m) return `${m[1]}-${m[2]}`
  
  // 17. 050717_524 - chs -> 050717-524 (带语言后缀)
  m = base.match(/^(\d{6})_(\d{2,3})\s*-?\s*(chs|cht)$/i)
  if (m) return `${m[1]}-${m[2]}`
  
  // 18. 050717_524cht -> 050717-524 (直接连接语言后缀)
  m = base.match(/^(\d{6})_(\d{2,3})(chs|cht)$/i)
  if (m) return `${m[1]}-${m[2]}`
  
  // 19. 072415_928-carib-CHS -> CARIB-072415_928 (carib格式带语言后缀)
  m = base.match(/^(\d{6})_(\d{3})-carib-(chs|cht)$/i)
  if (m) return `CARIB-${m[1]}_${m[2]}`
  
  // 20. 080416_353 今夏來海灘超嗨亂交！ 真琴涼 希咲彩 蒼井櫻 -> 080416-353 (带中文描述)
  m = base.match(/^(\d{6})_(\d{2,3})\s+[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/)
  if (m) return `${m[1]}-${m[2]}`
  
  // 21. 100516_398  -> 100516-398 (带空格)
  m = base.match(/^(\d{6})_(\d{2,3})\s*$/)
  if (m) return `${m[1]}-${m[2]}`
  
  // 22. 1pondo – 061014_824 – Nami Itoshino -> PONDO-061014_824 (带破折号和描述)
  m = base.match(/1pondo\s*[–-]\s*(\d{6}_\d{3})/i)
  if (m) return `PONDO-${m[1]}`
  
  // 23. 1Pondo_081418_728 -> PONDO-081418_728 (下划线连接)
  m = base.match(/^1Pondo_(\d{6}_\d{3})/i)
  if (m) return `PONDO-${m[1]}`
  
  // 原有逻辑保持不变
  // 优先：已有连字符，如 JUL-721
  m = base.match(/([a-z]+)-(\d{2,5})/i)
  if (m) return `${m[1]}-${m[2]}`.toUpperCase()
  
  // 其次：无连字符的字母+数字，如 NAKA008 -> NAKA-008
  m = base.match(/([a-z]+)(\d{2,5})/i)
  if (m) return `${m[1]}-${m[2]}`.toUpperCase()
  
  // 新增：字母+空格+数字，如 ABP 744 -> ABP-744
  m = base.match(/([a-z]+)\s+(\d{2,5})/i)
  if (m) return `${m[1]}-${m[2]}`.toUpperCase()
  
  return null
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