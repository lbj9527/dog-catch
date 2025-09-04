// 生产环境配置
window.PLAYER_CONFIG = {
  // 生产环境API地址
  API_BASE_URL: 'https://api.sub-dog.top',
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