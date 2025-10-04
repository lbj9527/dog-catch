// RealChatService: 真实后端占位实现（REST 风格），保持与 Mock 一致的数据结构
(function () {
  const toJSON = async (resp) => {
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data && (data.message || data.error) ? (data.message || data.error) : `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    return data;
  };

  const getBaseUrl = () => {
    try {
      const cfg = window.PLAYER_CONFIG || {};
      return cfg.API_BASE_URL || '';
    } catch (_) {
      return '';
    }
  };

  const buildHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    // 可拓展：从 localStorage/sessionStorage 获取鉴权令牌
    const token = window.USER_TOKEN || null;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const RealChatService = {
    async listUsers(page = 1, limit = 10) {
      const base = getBaseUrl();
      const url = `${base}/api/users/list?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`;
      const resp = await fetch(url, { headers: buildHeaders() });
      const data = await toJSON(resp);
      const users = Array.isArray(data.users) ? data.users : [];
      const hasMore = !!(data.pagination && data.pagination.hasMore);
      return { users, pagination: { hasMore } };
    },

    async searchUsers(query = '', limit = 10) {
      const base = getBaseUrl();
      const url = `${base}/api/users/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`;
      const resp = await fetch(url, { headers: buildHeaders() });
      const data = await toJSON(resp);
      const users = Array.isArray(data.users) ? data.users : [];
      return { users };
    },

    async fetchFriendRequests() {
      const base = getBaseUrl();
      const url = `${base}/api/friends/requests`;
      const resp = await fetch(url, { headers: buildHeaders() });
      const data = await toJSON(resp);
      const requests = Array.isArray(data) ? data : (Array.isArray(data.requests) ? data.requests : []);
      return requests;
    },

    async fetchFriendRequestsCount() {
      const base = getBaseUrl();
      const url = `${base}/api/friends/requests/count`;
      const resp = await fetch(url, { headers: buildHeaders() });
      const data = await toJSON(resp);
      const unreadCount = typeof data.unreadCount === 'number' ? data.unreadCount : 0;
      return { unreadCount };
    },

    async processFriendRequest(requestId, action) {
      const base = getBaseUrl();
      const url = `${base}/api/friends/requests/${encodeURIComponent(requestId)}/${encodeURIComponent(action)}`;
      const resp = await fetch(url, { method: 'POST', headers: buildHeaders() });
      const data = await toJSON(resp);
      return {
        success: data.success !== false,
        message: data.message || (action === 'accept' ? '已接受好友申请' : '已拒绝好友申请'),
        requestId,
        action
      };
    },

    async addFriend(userId) {
      const base = getBaseUrl();
      const url = `${base}/api/friends/add`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ userId })
      });
      const data = await toJSON(resp);
      return { success: data.success !== false, message: data.message || '好友请求已发送', userId };
    }
  };

  window.RealChatService = RealChatService;
})();