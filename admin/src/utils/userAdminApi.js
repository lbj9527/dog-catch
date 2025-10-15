import api from './api'

export const userAdminAPI = {
	getStats() {
		return api.get('/api/admin/users/stats')
	},
	getList(params = {}) {
		return api.get('/api/admin/users', { params })
	},
	deleteUser(userId) {
		return api.delete(`/api/admin/users/${userId}`)
	},
	// 会员管理相关API
	updateMembership(userId, membershipData) {
		return api.patch(`/api/admin/users/${userId}/membership`, membershipData)
	},
	// 新增：封禁/解封用户
	banUser(userId, reason = '') {
		return api.post(`/api/admin/users/${userId}/ban`, { reason })
	},
	unbanUser(userId) {
		return api.post(`/api/admin/users/${userId}/unban`)
	}
}

export default userAdminAPI