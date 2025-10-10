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
				<el-table-column prop="membership" label="会员状态" width="120">
					<template #default="scope">
						<el-tag :type="getMembershipTagType(scope.row.membership)" size="small">
							{{ getMembershipText(scope.row.membership) }}
						</el-tag>
					</template>
				</el-table-column>
				<el-table-column prop="paid_until" label="到期时间" width="120">
					<template #default="scope">
						<span v-if="scope.row.membership === 'paid' && scope.row.paid_until" 
							  :class="getExpiryClass(scope.row.paid_until)">
							{{ formatDate(scope.row.paid_until, 'date') }}
						</span>
						<span v-else class="text-muted">--</span>
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
				<el-table-column label="操作" width="180" align="center" fixed="right">
					<template #default="scope">
						<el-button type="primary" size="small" @click="editMembership(scope.row)">
							👑
							会员
						</el-button>
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

const editMembership = async (row) => {
	const currentMembership = row.membership || 'free'
	const currentPaidUntil = row.paid_until || ''
	
	try {
		const { value } = await ElMessageBox.prompt(
			`当前用户：${row.username}\n当前状态：${getMembershipText(currentMembership)}\n\n请选择新的会员状态：`,
			'编辑会员状态',
			{
				confirmButtonText: '确定',
				cancelButtonText: '取消',
				inputType: 'textarea',
				inputValue: currentMembership === 'paid' ? 
					`membership=paid\npaid_until=${currentPaidUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}` :
					'membership=free',
				inputPlaceholder: '格式：membership=paid 或 membership=free\n如果是付费会员，可添加：paid_until=2024-12-31'
			}
		)
		
		// 解析输入
		const lines = value.split('\n').map(line => line.trim()).filter(line => line)
		const data = {}
		
		for (const line of lines) {
			const [key, val] = line.split('=').map(s => s.trim())
			if (key === 'membership' && ['free', 'paid'].includes(val)) {
				data.membership = val
			} else if (key === 'paid_until' && val) {
				data.paid_until = val
			}
		}
		
		if (!data.membership) {
			throw new Error('请指定有效的会员状态 (free 或 paid)')
		}
		
		await userAdminAPI.updateMembership(row.id, data)
		ElMessage.success('会员状态更新成功')
		await loadData()
		
	} catch (e) {
		if (e !== 'cancel') {
			console.error(e)
			ElMessage.error(e.message || '更新会员状态失败')
		}
	}
}

const onSizeChange = (size) => {
	pagination.limit = size
	pagination.page = 1
	loadData()
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
</style>