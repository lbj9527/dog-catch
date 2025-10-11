<template>
	<div class="user-mgmt-container">
		<div class="header">
			<div class="header-left">
				<h2>用户管理</h2>
				<p>查看与管理播放器用户</p>
			</div>
		</div>

		<div class="toolbar">
			<div class="toolbar-left">
				<el-input v-model="searchQuery" placeholder="搜索用户名或邮箱..." prefix-icon="Search" style="width: 300px" @keyup.enter="loadData" clearable />
				<el-button @click="loadData">
					<el-icon><Search /></el-icon>
					搜索
				</el-button>
			</div>
		</div>

		<div class="stats-cards">
			<el-card class="stat-card">
				<div class="stat-content">
					<div class="stat-number">{{ stats.total }}</div>
					<div class="stat-label">用户总数</div>
				</div>
				<div class="stat-icon">
					<el-icon><User /></el-icon>
				</div>
			</el-card>
		</div>

		<el-card class="table-card">
			<el-table :data="tableData" v-loading="loading" height="420" stripe>
				<el-table-column prop="username" label="用户名" width="150" />
				<el-table-column prop="email" label="邮箱" width="180" />
				<el-table-column prop="gender" label="性别" width="80">
					<template #default="scope">
						{{ scope.row.gender || '未设置' }}
					</template>
				</el-table-column>
				<el-table-column prop="membership" label="会员状态" width="140">
					<template #default="scope">
						<el-switch
							:model-value="scope.row.membership === 'paid'"
							@change="(val) => handleMembershipSwitch(scope.row, val)"
							active-text="付费"
							inactive-text="免费"
							size="small"
						/>
					</template>
				</el-table-column>
				<el-table-column prop="paid_until" label="到期时间" width="160">
					<template #default="scope">
						<el-popover
							:visible="expiryPopoverVisible[scope.row.id]"
							placement="bottom"
							:width="280"
							trigger="manual"
						>
							<template #reference>
								<span 
									v-if="scope.row.membership === 'paid' && scope.row.paid_until" 
									:class="getExpiryClass(scope.row.paid_until)"
									class="expiry-clickable"
									@click="openExpiryPopover(scope.row)"
								>
									{{ formatDate(scope.row.paid_until, 'date') }}
								</span>
								<span 
									v-else-if="scope.row.membership === 'paid'"
									class="text-muted expiry-clickable"
									@click="openExpiryPopover(scope.row)"
								>
									点击设置到期时间
								</span>
								<span v-else class="text-muted">--</span>
							</template>
							<div class="expiry-popover">
								<h4>设置到期时间</h4>
								<el-date-picker
									v-model="tempExpiryDate[scope.row.id]"
									type="datetime"
									placeholder="选择到期时间"
									format="YYYY-MM-DD HH:mm"
									value-format="YYYY-MM-DD HH:mm:ss"
									style="width: 100%; margin: 10px 0;"
								/>
								<div class="popover-actions">
									<el-button size="small" @click="cancelExpiryChange(scope.row.id)">取消</el-button>
									<el-button size="small" type="danger" @click="clearExpiry(scope.row.id)">清除到期</el-button>
									<el-button size="small" type="primary" @click="saveExpiryChange(scope.row)">保存</el-button>
								</div>
							</div>
						</el-popover>
					</template>
				</el-table-column>
				<el-table-column prop="bio" label="个人简介" width="150" show-overflow-tooltip>
					<template #default="scope">
						{{ scope.row.bio || '暂无简介' }}
					</template>
				</el-table-column>
				<el-table-column prop="created_at" label="注册时间" width="140">
					<template #default="scope">{{ formatDate(scope.row.created_at, 'date') }}</template>
				</el-table-column>
				<el-table-column prop="last_login_at" label="最近登录" width="140">
					<template #default="scope">{{ scope.row.last_login_at ? formatDate(scope.row.last_login_at, 'date') : '从未登录' }}</template>
				</el-table-column>
				<el-table-column label="操作" width="100" align="center" fixed="right">
					<template #default="scope">
						<el-button type="danger" size="small" @click="deleteUser(scope.row)">
							<el-icon><Delete /></el-icon>
							删除
						</el-button>
					</template>
				</el-table-column>
			</el-table>

			<div class="pagination-wrapper">
				<el-pagination
					:current-page="pagination.page"
					:page-size="pagination.limit"
					:page-sizes="[20, 50, 100]"
					:total="pagination.total"
					layout="total, sizes, prev, pager, next, jumper"
					@size-change="onSizeChange"
					@current-change="onPageChange"
				/>
			</div>
		</el-card>
	</div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Delete, User } from '@element-plus/icons-vue'
import { userAdminAPI } from '../utils/userAdminApi'

const loading = ref(false)
const searchQuery = ref('')
const tableData = ref([])
const stats = reactive({ total: 0 })
const pagination = reactive({ page: 1, limit: 50, total: 0 })

// 会员管理相关响应式数据
const expiryPopoverVisible = ref({})
const tempExpiryDate = ref({})

const loadStats = async () => {
	try {
		const res = await userAdminAPI.getStats()
		stats.total = res.total || 0
	} catch {}
}

const loadData = async () => {
	loading.value = true
	try {
		const res = await userAdminAPI.getList({ page: pagination.page, limit: pagination.limit, search: searchQuery.value })
		tableData.value = res.data || []
		pagination.total = res.pagination?.total || 0
	} catch (e) {
		console.error(e)
		ElMessage.error('加载用户失败')
	} finally {
		loading.value = false
	}
}

const deleteUser = async (row) => {
	try {
		await ElMessageBox.confirm(`确定要删除用户 "${row.username}" 吗？`, '确认删除', { type: 'warning' })
		await userAdminAPI.deleteUser(row.id)
		ElMessage.success('删除成功')
		await loadData()
		await loadStats()
	} catch (e) {
		if (e !== 'cancel') {
			console.error(e)
			ElMessage.error('删除失败')
		}
	}
}

// 会员管理相关方法
const getMembershipText = (membership) => {
	return membership === 'paid' ? '付费会员' : '免费用户'
}

const getMembershipTagType = (membership) => {
	return membership === 'paid' ? 'warning' : 'info'
}

const getExpiryClass = (paidUntil) => {
	if (!paidUntil) return ''
	const expiry = new Date(paidUntil)
	const now = new Date()
	const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24))
	
	if (diffDays < 0) return 'text-danger' // 已过期
	if (diffDays <= 7) return 'text-warning' // 7天内到期
	return 'text-success' // 正常
}

// 新的会员切换处理方法
const handleMembershipSwitch = async (row, newValue) => {
	const membership = newValue ? 'paid' : 'free'
	
	try {
		const data = { membership }
		// 如果切换为免费用户，清除到期时间
		if (!newValue) {
			data.paid_until = null
		}
		
		await userAdminAPI.updateMembership(row.id, data)
		ElMessage.success('会员状态更新成功')
		await loadData()
	} catch (e) {
		console.error(e)
		ElMessage.error(e.message || '更新会员状态失败')
	}
}

// 到期时间弹窗相关方法
const openExpiryPopover = (row) => {
	expiryPopoverVisible.value[row.id] = true
	// 如果已有到期时间，使用现有时间，否则预置+30天
	if (row.paid_until) {
		tempExpiryDate.value[row.id] = row.paid_until
	} else {
		const defaultExpiry = new Date()
		defaultExpiry.setDate(defaultExpiry.getDate() + 30)
		tempExpiryDate.value[row.id] = defaultExpiry.toISOString().slice(0, 19).replace('T', ' ')
	}
}

const cancelExpiryChange = (userId) => {
	expiryPopoverVisible.value[userId] = false
	delete tempExpiryDate.value[userId]
}

const clearExpiry = (userId) => {
	tempExpiryDate.value[userId] = null
}

const saveExpiryChange = async (row) => {
	const expiryDate = tempExpiryDate.value[row.id]
	
	// 如果清除到期时间
	if (!expiryDate) {
		try {
			await userAdminAPI.updateMembership(row.id, { 
				membership: 'paid',
				paid_until: null 
			})
			ElMessage.success('已清除到期时间')
			await loadData()
			expiryPopoverVisible.value[row.id] = false
			delete tempExpiryDate.value[row.id]
		} catch (e) {
			console.error(e)
			ElMessage.error(e.message || '更新失败')
		}
		return
	}
	
	// 验证日期不能是过去时间
	const selectedDate = new Date(expiryDate)
	const now = new Date()
	if (selectedDate <= now) {
		ElMessage.warning('到期时间不能是过去时间')
		return
	}
	
	try {
		await userAdminAPI.updateMembership(row.id, { 
			membership: 'paid',
			paid_until: expiryDate 
		})
		ElMessage.success('到期时间更新成功')
		await loadData()
		expiryPopoverVisible.value[row.id] = false
		delete tempExpiryDate.value[row.id]
	} catch (e) {
		console.error(e)
		ElMessage.error(e.message || '更新到期时间失败')
	}
}

const onPageChange = (page) => {
	pagination.page = page
	loadData()
}

const formatDate = (val, type = 'datetime') => {
	if (!val) return '-'
	const date = new Date(val)
	if (type === 'date') {
		return date.toLocaleDateString('zh-CN')
	}
	return date.toLocaleString('zh-CN')
}

onMounted(async () => {
	await loadStats()
	await loadData()
})
</script>

<style scoped>
.user-mgmt-container { padding: 20px; background: #f5f5f5; min-height: 100vh; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,.1); }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,.1); }
.toolbar-left { display: flex; gap: 10px; }
.stats-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
.stat-card :deep(.el-card__body) { padding: 20px; display: flex; justify-content: space-between; align-items: center; }
.stat-number { font-size: 32px; font-weight: bold; color: #409EFF; margin-bottom: 5px; }
.stat-label { color: #666; font-size: 14px; }
.stat-icon { font-size: 40px; color: #409EFF; opacity: 0.3; }
.table-card { box-shadow: 0 2px 4px rgba(0,0,0,.1); }
.pagination-wrapper { display: flex; justify-content: center; margin-top: 20px; }

/* 会员状态相关样式 */
.text-success { color: #67c23a; }
.text-warning { color: #e6a23c; }
.text-danger { color: #f56c6c; }
.text-muted { color: #909399; }

/* 到期时间点击样式 */
.expiry-clickable {
	cursor: pointer;
	text-decoration: underline;
	text-decoration-style: dotted;
}

.expiry-clickable:hover {
	color: #409EFF;
}

/* 弹窗样式 */
.expiry-popover h4 {
	margin: 0 0 10px 0;
	font-size: 14px;
	color: #303133;
}

.popover-actions {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	margin-top: 15px;
}
</style>