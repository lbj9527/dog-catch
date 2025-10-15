import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import Dashboard from '../views/Dashboard.vue'
// 移除旧版组件引用
// import UsageMonitoring from '../views/UsageMonitoring.vue'
import UsageMonitoringPlus from '../views/UsageMonitoringPlus.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: Login,
    meta: { requiresAuth: false }
  },
  {
    path: '/',
    name: 'Dashboard',
    component: Dashboard,
    meta: { requiresAuth: true }
  },
  {
    path: '/dashboard',
    redirect: '/'
  },
  {
    path: '/usage-monitoring',
    name: 'UsageMonitoring',
    // 指向增强版组件
    component: UsageMonitoringPlus,
    meta: { requiresAuth: true }
  },
  {
    path: '/usage-monitoring-plus',
    name: 'UsageMonitoringPlus',
    component: UsageMonitoringPlus,
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('admin_token')
  
  if (to.meta.requiresAuth && !token) {
    next('/login')
  } else if (to.path === '/login' && token) {
    next('/')
  } else {
    next()
  }
})

export default router