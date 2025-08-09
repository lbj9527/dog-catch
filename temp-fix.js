// 临时修复脚本 - 强制修复虚拟滚动渲染问题
// 在浏览器控制台中运行此脚本

console.log('🔧 开始临时修复虚拟滚动问题...');

if (window.dogCatchSidebar) {
  console.log('✅ 找到侧边栏实例');
  
  // 强制设置 loading = false
  window.dogCatchSidebar.isLoading = false;
  
  // 检查虚拟滚动状态
  console.log('虚拟滚动实例存在:', !!window.dogCatchSidebar.virtualScroll);
  console.log('VirtualScroll类存在:', !!window.VirtualScroll);
  console.log('资源数量:', window.dogCatchSidebar.resources?.length || 0);
  
  // 获取资源列表容器
  const container = document.querySelector('.dog-catch-resource-list');
  if (container) {
    console.log('✅ 找到资源列表容器');
    
    // 如果虚拟滚动不存在，使用降级渲染
    if (!window.dogCatchSidebar.virtualScroll || !window.VirtualScroll) {
      console.log('⚠️ 虚拟滚动不可用，使用降级渲染');
      
      // 清空容器
      container.innerHTML = '';
      
      // 直接渲染资源卡片
      if (window.dogCatchSidebar.resources && window.dogCatchSidebar.resources.length > 0) {
        window.dogCatchSidebar.resources.forEach((resource, index) => {
          const card = window.dogCatchSidebar.createResourceCard(resource, index);
          container.appendChild(card);
        });
        console.log(`✅ 成功渲染 ${window.dogCatchSidebar.resources.length} 个资源`);
      } else {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">暂无检测到资源</div>';
        console.log('ℹ️ 没有资源可显示');
      }
    } else {
      console.log('✅ 虚拟滚动可用，重新设置数据');
      window.dogCatchSidebar.virtualScroll.setData(window.dogCatchSidebar.resources || []);
    }
  } else {
    console.log('❌ 未找到资源列表容器');
  }
} else {
  console.log('❌ 未找到侧边栏实例');
}

console.log('🔧 临时修复完成');
