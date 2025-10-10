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
	}
}

export default userAdminAPI