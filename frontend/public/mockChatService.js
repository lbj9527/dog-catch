// MockChatService: 提供统一的聊天相关模拟数据
(function () {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 生成模拟用户列表
  const allUsers = Array.from({ length: 40 }).map((_, i) => {
    const id = `mock_user_${String(i + 1).padStart(3, '0')}`;
    const username = [
      '小明', '小红', '阿强', '大壮', '前端侠', '后端客', '测试喵', 'UI仔',
      '产品菌', '数据猿', 'JS大王', 'Python骑士', 'Java骑士', 'Go少年', 'Rust萌新',
      '猫猫', '狗狗', '程序员A', '程序员B', 'CoderX'
    ][i % 20] + (i + 1);
    const email = `user${i + 1}@example.com`;
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
    return { id, username, email, avatar };
  });

  // 好友申请初始数据
  const state = {
    friendRequests: [
      {
        id: 'req_001',
        userId: 'mock_user_003',
        username: '小明3',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=%E5%B0%8F%E6%98%8E3',
        message: '我们一起学习前端开发吧！',
        timestamp: Date.now() - 2 * 60 * 60 * 1000,
        status: 'pending'
      },
      {
        id: 'req_002',
        userId: 'mock_user_005',
        username: '前端侠5',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=%E5%89%8D%E7%AB%AF%E4%BE%A05',
        message: '看到你的字幕作品很棒，想和你交流学习',
        timestamp: Date.now() - 5 * 60 * 60 * 1000,
        status: 'pending'
      },
      {
        id: 'req_003',
        userId: 'mock_user_007',
        username: '测试喵7',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=%E6%B5%8B%E8%AF%95%E5%96%B57',
        message: '希望能成为朋友，一起进步！',
        timestamp: Date.now() - 24 * 60 * 60 * 1000,
        status: 'pending'
      }
    ],
    unreadCount: 3
  };

  const MockChatService = {
    async listUsers(page = 1, limit = 10) {
      await delay(300);
      const start = (page - 1) * limit;
      const end = start + limit;
      const slice = allUsers.slice(start, end);
      return {
        users: slice,
        pagination: { hasMore: end < allUsers.length }
      };
    },

    async searchUsers(query = '', limit = 10) {
      await delay(250);
      const q = String(query).toLowerCase();
      const filtered = allUsers.filter(u =>
        u.username.toLowerCase().includes(q) ||
        (u.email && u.email.toLowerCase().includes(q))
      ).slice(0, limit);
      return { users: filtered };
    },

    async fetchFriendRequests() {
      await delay(400);
      return state.friendRequests.map(r => ({ ...r }));
    },

    async fetchFriendRequestsCount() {
      await delay(150);
      const unread = state.friendRequests.filter(r => r.status === 'pending').length;
      state.unreadCount = unread;
      return { unreadCount: unread };
    },

    async processFriendRequest(requestId, action) {
      await delay(500);
      const idx = state.friendRequests.findIndex(r => r.id === requestId);
      if (idx !== -1) {
        state.friendRequests[idx].status = action === 'accept' ? 'accepted' : 'rejected';
      }
      const unread = state.friendRequests.filter(r => r.status === 'pending').length;
      state.unreadCount = unread;
      return {
        success: true,
        message: action === 'accept' ? '已接受好友申请' : '已拒绝好友申请',
        requestId,
        action
      };
    },

    async addFriend(userId) {
      await delay(300);
      return { success: true, message: '好友请求已发送', userId };
    }
  };

  window.MockChatService = MockChatService;
})();