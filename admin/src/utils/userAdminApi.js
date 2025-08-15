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
	}
}

export default userAdminAPI 