"""
批量下载编排模块
负责协调CSV数据处理和下载流程，实现批量下载功能
"""

import time
from typing import List, Optional, Callable
from csv_utils import get_video_codes_from_csv


class BatchDownloader:
    """批量下载器类"""
    
    def __init__(self, 
                 search_function: Callable[[str], None],
                 delay_between_downloads: float = 2.0):
        """
        初始化批量下载器
        
        Args:
            search_function: 搜索下载函数，接受keyword参数
            delay_between_downloads: 下载间隔时间（秒）
        """
        self.search_function = search_function
        self.delay_between_downloads = delay_between_downloads
        self.download_stats = {
            'total': 0,
            'success': 0,
            'failed': 0,
            'skipped': 0
        }
    
    def download_from_csv(self, 
                         csv_path: str, 
                         video_type: str = "无码破解",
                         title_col: str = "video_title",
                         max_downloads: Optional[int] = None,
                         skip_existing: bool = True) -> dict:
        """
        从CSV文件批量下载视频
        
        Args:
            csv_path: CSV文件路径
            video_type: 视频类型筛选条件
            title_col: 标题列名
            max_downloads: 最大下载数量限制
            skip_existing: 是否跳过已存在的文件
            
        Returns:
            dict: 下载统计信息
        """
        print(f"🚀 开始批量下载任务")
        print(f"📁 CSV文件: {csv_path}")
        print(f"🎯 视频类型: {video_type}")
        print(f"📊 最大下载数: {max_downloads or '无限制'}")
        print(f"⏱️ 下载间隔: {self.delay_between_downloads}秒")
        print("=" * 60)
        
        try:
            # 1. 从CSV提取视频编号
            video_codes = get_video_codes_from_csv(csv_path, video_type, title_col)
            
            if not video_codes:
                print("❌ 未找到任何视频编号，批量下载终止")
                return self.download_stats
            
            # 2. 应用下载数量限制
            if max_downloads and max_downloads > 0:
                video_codes = video_codes[:max_downloads]
                print(f"📋 应用下载限制，实际处理: {len(video_codes)} 个编号")
            
            self.download_stats['total'] = len(video_codes)
            
            # 3. 批量下载循环
            for i, code in enumerate(video_codes, 1):
                print(f"\n🔄 [{i}/{len(video_codes)}] 处理视频编号: {code}")
                
                try:
                    # 执行搜索下载
                    print(f"🔍 开始搜索和下载: {code}")
                    self.search_function(code)
                    
                    self.download_stats['success'] += 1
                    print(f"✅ [{i}/{len(video_codes)}] 完成: {code}")
                    
                except Exception as e:
                    self.download_stats['failed'] += 1
                    print(f"❌ [{i}/{len(video_codes)}] 失败: {code} - {str(e)}")
                
                # 下载间隔（最后一个不需要等待）
                if i < len(video_codes):
                    print(f"⏳ 等待 {self.delay_between_downloads} 秒后继续...")
                    time.sleep(self.delay_between_downloads)
            
            # 4. 输出最终统计
            self._print_final_stats()
            return self.download_stats
            
        except Exception as e:
            print(f"❌ 批量下载过程中发生错误: {e}")
            self._print_final_stats()
            return self.download_stats
    
    def download_from_codes(self, 
                           video_codes: List[str],
                           max_downloads: Optional[int] = None) -> dict:
        """
        从视频编号列表批量下载
        
        Args:
            video_codes: 视频编号列表
            max_downloads: 最大下载数量限制
            
        Returns:
            dict: 下载统计信息
        """
        print(f"🚀 开始批量下载任务（编号列表模式）")
        print(f"📋 视频编号数量: {len(video_codes)}")
        print(f"📊 最大下载数: {max_downloads or '无限制'}")
        print("=" * 60)
        
        if not video_codes:
            print("❌ 视频编号列表为空，批量下载终止")
            return self.download_stats
        
        # 应用下载数量限制
        if max_downloads and max_downloads > 0:
            video_codes = video_codes[:max_downloads]
            print(f"📋 应用下载限制，实际处理: {len(video_codes)} 个编号")
        
        self.download_stats['total'] = len(video_codes)
        
        # 批量下载循环
        for i, code in enumerate(video_codes, 1):
            print(f"\n🔄 [{i}/{len(video_codes)}] 处理视频编号: {code}")
            
            try:
                # 执行搜索下载
                print(f"🔍 开始搜索和下载: {code}")
                self.search_function(code)
                
                self.download_stats['success'] += 1
                print(f"✅ [{i}/{len(video_codes)}] 完成: {code}")
                
            except Exception as e:
                self.download_stats['failed'] += 1
                print(f"❌ [{i}/{len(video_codes)}] 失败: {code} - {str(e)}")
            
            # 下载间隔（最后一个不需要等待）
            if i < len(video_codes):
                print(f"⏳ 等待 {self.delay_between_downloads} 秒后继续...")
                time.sleep(self.delay_between_downloads)
        
        # 输出最终统计
        self._print_final_stats()
        return self.download_stats
    
    def _print_final_stats(self):
        """打印最终统计信息"""
        print("\n" + "=" * 60)
        print("📊 批量下载完成统计:")
        print(f"   📋 总计: {self.download_stats['total']}")
        print(f"   ✅ 成功: {self.download_stats['success']}")
        print(f"   ❌ 失败: {self.download_stats['failed']}")
        print(f"   ⏭️ 跳过: {self.download_stats['skipped']}")
        
        if self.download_stats['total'] > 0:
            success_rate = (self.download_stats['success'] / self.download_stats['total']) * 100
            print(f"   📈 成功率: {success_rate:.1f}%")
        
        print("=" * 60)
    
    def reset_stats(self):
        """重置下载统计"""
        self.download_stats = {
            'total': 0,
            'success': 0,
            'failed': 0,
            'skipped': 0
        }


def create_batch_downloader(search_function: Callable[[str], None], 
                           delay: float = 2.0) -> BatchDownloader:
    """
    创建批量下载器实例的工厂函数
    
    Args:
        search_function: 搜索下载函数
        delay: 下载间隔时间
        
    Returns:
        BatchDownloader: 批量下载器实例
    """
    return BatchDownloader(search_function, delay)


if __name__ == "__main__":
    # 测试代码
    def mock_search_function(keyword: str):
        """模拟搜索函数"""
        print(f"模拟搜索: {keyword}")
        time.sleep(0.5)  # 模拟下载时间
    
    # 测试批量下载器
    downloader = create_batch_downloader(mock_search_function, delay=1.0)
    
    # 测试编号列表模式
    test_codes = ["SSIS-001", "SSIS-002", "SSIS-003"]
    stats = downloader.download_from_codes(test_codes, max_downloads=2)
    print(f"测试结果: {stats}")