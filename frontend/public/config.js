// 本地开发环境配置
window.PLAYER_CONFIG = {
  // 本地开发默认为本地后端；线上可通过替换该文件或 URL 参数 ?api= 覆盖
  API_BASE_URL: 'http://localhost:8000',
  // 是否启用聊天相关的 Mock 数据，亦可通过 URL 参数 ?mock=true/false 控制
  USE_MOCK: true,
  SUBTITLE_NEED_LOGIN: true,
  ALLOW_PLAY_WITHOUT_LOGIN: true,
  CAPTCHA_ENABLED: false,  // 禁用图形验证码
  CAPTCHA_SITE_KEY: '492e9548-748a-44ca-8c32-28961402fe44',
  I18N: {
    resend: '获取验证码',
    sentWithCountdown: (s) => `已发送(${s}s)`,
    resendAfter: '重新发送',
    // 点赞相关文案
    like: {
      button: '点赞',
      liked: '已点赞',
      likeSuccess: '点赞成功',
      unlikeSuccess: '取消点赞',
      loginRequired: '请先登录',
      selectVideoFirst: '请先选择视频',
      operationFailed: '操作失败，请稍后重试',
      networkError: '网络错误，请稍后重试',
      loginExpired: '登录已过期，请重新登录'
    }
  }
};