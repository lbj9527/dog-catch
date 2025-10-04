// ChatService: 统一的聊天服务入口，根据配置选择 Mock 或真实后端
(function () {
  const getParam = (key) => new URLSearchParams(location.search).get(key);
  const mockParam = getParam('mock');
  const USE_MOCK = mockParam !== null
    ? (mockParam !== 'false')
    : (window.PLAYER_CONFIG && window.PLAYER_CONFIG.USE_MOCK === true);

  const API_BASE_URL = getParam('api') || (window.PLAYER_CONFIG && window.PLAYER_CONFIG.API_BASE_URL) || '';
  const base = API_BASE_URL.replace(/\/$/, '');

  const RealChatService = {
    async listUsers(page = 1, limit = 10) {
      // 真实服务占位：当前阶段不调用后端，保持空列表
      // 如需接入后端，可替换为：fetch(`${base}/api/users/list?page=${page}&limit=${limit}`)
      return { users: [], pagination: { hasMore: false } };
    },
    async searchUsers(query = '', limit = 10) {
      return { users: [] };
    },
    async fetchFriendRequests() {
      return [];
    },
    async fetchFriendRequestsCount() {
      return { unreadCount: 0 };
    },
    async processFriendRequest(requestId, action) {
      return { success: true, message: '操作完成', requestId, action };
    },
    async addFriend(userId) {
      return { success: true, message: '请求已发送(占位)', userId };
    }
  };

  window.ChatService = USE_MOCK ? window.MockChatService : RealChatService;
})();