<template>
  <el-dialog
    v-model="visible"
    title="字幕预览"
    width="700px"
    :before-close="handleClose"
  >
    <div v-if="subtitleData" class="preview-container">
      <div class="preview-header">
        <div class="file-info">
          <h4>{{ subtitleData.filename }}</h4>
          <p>视频编号: <el-tag>{{ subtitleData.video_id }}</el-tag></p>
        </div>
        <div class="preview-actions">
          <el-button size="small" @click="copyContent">
            <el-icon><CopyDocument /></el-icon>
            复制内容
          </el-button>
          <el-button size="small" @click="downloadFile">
            <el-icon><Download /></el-icon>
            下载文件
          </el-button>
        </div>
      </div>
      
      <el-divider />
      
      <div class="content-container">
        <div class="content-tabs">
          <el-radio-group v-model="viewMode" size="small">
            <el-radio-button label="formatted">格式化显示</el-radio-button>
            <el-radio-button label="raw">原始内容</el-radio-button>
          </el-radio-group>
        </div>
        
        <!-- 格式化显示 -->
        <div v-if="viewMode === 'formatted'" class="formatted-view">
          <div v-if="parsedSubtitles.length > 0" class="subtitle-list">
            <div
              v-for="(subtitle, index) in parsedSubtitles"
              :key="index"
              class="subtitle-item"
            >
              <div class="subtitle-index">{{ subtitle.index }}</div>
              <div class="subtitle-content">
                <div class="subtitle-time">{{ subtitle.startTime }} --> {{ subtitle.endTime }}</div>
                <div class="subtitle-text">
                  <p v-for="(line, lineIndex) in subtitle.text" :key="lineIndex">
                    {{ line }}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="no-content">
            <el-empty description="无法解析字幕内容" />
          </div>
        </div>
        
        <!-- 原始内容 -->
        <div v-else class="raw-view">
          <el-input
            v-model="subtitleData.content"
            type="textarea"
            :rows="20"
            readonly
            placeholder="字幕内容"
            class="content-textarea"
          />
        </div>
      </div>
    </div>
    
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Download } from '@element-plus/icons-vue'

// Props
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  subtitleData: {
    type: Object,
    default: null
  }
})

// Emits
const emit = defineEmits(['update:modelValue'])

// 响应式数据
const viewMode = ref('formatted')
const parsedSubtitles = ref([])

// 计算属性
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// 监听器
watch(() => props.subtitleData, (newData) => {
  if (newData && newData.content) {
    parseSubtitleContent(newData.content)
  }
}, { immediate: true })

// 方法
const parseSubtitleContent = (content) => {
  try {
    if (content.startsWith('WEBVTT')) {
      // 解析 WebVTT 格式
      parsedSubtitles.value = parseWebVTT(content)
    } else {
      // 解析 SRT 格式
      parsedSubtitles.value = parseSRT(content)
    }
  } catch (error) {
    console.error('解析字幕失败:', error)
    parsedSubtitles.value = []
  }
}

const parseSRT = (content) => {
  const subtitles = []
  const blocks = content.trim().split(/\n\s*\n/)
  
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length >= 3) {
      const index = lines[0].trim()
      const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/)
      
      if (timeMatch) {
        const startTime = timeMatch[1].replace(',', '.')
        const endTime = timeMatch[2].replace(',', '.')
        const text = lines.slice(2).filter(line => line.trim())
        
        subtitles.push({
          index: parseInt(index) || subtitles.length + 1,
          startTime,
          endTime,
          text
        })
      }
    }
  }
  
  return subtitles
}

const parseWebVTT = (content) => {
  const subtitles = []
  const lines = content.split('\n')
  let currentSubtitle = null
  let index = 1
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    
    // 跳过 WEBVTT 头和空行
    if (line === 'WEBVTT' || line === '') continue
    
    // 时间轴行
    const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/)
    if (timeMatch) {
      if (currentSubtitle) {
        subtitles.push(currentSubtitle)
      }
      
      currentSubtitle = {
        index: index++,
        startTime: timeMatch[1],
        endTime: timeMatch[2],
        text: []
      }
    } else if (currentSubtitle && line) {
      // 字幕文本行
      currentSubtitle.text.push(line)
    }
  }
  
  // 添加最后一个字幕
  if (currentSubtitle) {
    subtitles.push(currentSubtitle)
  }
  
  return subtitles
}

const copyContent = async () => {
  if (!props.subtitleData?.content) return
  
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(props.subtitleData.content)
    } else {
      // 兼容旧浏览器
      const textarea = document.createElement('textarea')
      textarea.value = props.subtitleData.content
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    
    ElMessage.success('内容已复制到剪贴板')
  } catch (error) {
    ElMessage.error('复制失败')
  }
}

const downloadFile = () => {
  if (!props.subtitleData) return
  
  const blob = new Blob([props.subtitleData.content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = props.subtitleData.filename || `${props.subtitleData.video_id}.srt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  
  ElMessage.success('文件下载已开始')
}

const handleClose = () => {
  visible.value = false
  viewMode.value = 'formatted'
  parsedSubtitles.value = []
}
</script>

<style scoped>
.preview-container {
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.file-info h4 {
  margin: 0 0 8px 0;
  color: #333;
  font-size: 16px;
}

.file-info p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.preview-actions {
  display: flex;
  gap: 8px;
}

.content-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.content-tabs {
  margin-bottom: 15px;
}

.formatted-view {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.subtitle-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background: #fafafa;
}

.subtitle-item {
  display: flex;
  padding: 15px;
  border-bottom: 1px solid #e4e7ed;
}

.subtitle-item:last-child {
  border-bottom: none;
}

.subtitle-index {
  width: 50px;
  flex-shrink: 0;
  font-weight: bold;
  color: #409EFF;
  text-align: center;
}

.subtitle-content {
  flex: 1;
  margin-left: 15px;
}

.subtitle-time {
  font-family: monospace;
  font-size: 12px;
  color: #999;
  margin-bottom: 8px;
  background: #f0f0f0;
  padding: 4px 8px;
  border-radius: 3px;
  display: inline-block;
}

.subtitle-text p {
  margin: 2px 0;
  color: #333;
  line-height: 1.5;
}

.raw-view {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.content-textarea {
  flex: 1;
}

.content-textarea :deep(.el-textarea__inner) {
  font-family: monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
}

.no-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-footer {
  text-align: right;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .preview-header {
    flex-direction: column;
    align-items: stretch;
    gap: 15px;
  }
  
  .preview-actions {
    justify-content: center;
  }
  
  .subtitle-item {
    flex-direction: column;
    padding: 10px;
  }
  
  .subtitle-index {
    width: auto;
    text-align: left;
    margin-bottom: 5px;
  }
  
  .subtitle-content {
    margin-left: 0;
  }
}
</style> 