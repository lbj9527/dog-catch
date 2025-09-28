#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库工具模块 - 替代CSV模式，直接从数据库读取视频数据
提供与csv_utils.py相同的接口，确保向后兼容性
"""

import sqlite3
import re
from typing import List, Optional, Dict, Any
from pathlib import Path
from database_manager import DatabaseManager


class DatabaseUtils:
    """数据库工具类，提供视频数据查询功能"""
    
    def __init__(self, db_path: Optional[str] = None):
        """
        初始化数据库工具
        
        Args:
            db_path: 数据库路径，如果为None则使用默认路径
        """
        if db_path is None:
            # 使用默认数据库路径
            db_path = Path(__file__).parent / "database" / "actresses.db"
            print(f"🗄️ 使用默认数据库路径: {db_path}")
        
        self.db_path = str(db_path)
        self.db_manager = DatabaseManager(self.db_path)
    
    def get_video_codes_from_db(
        self, 
        video_type: Optional[str] = "无码破解",
        actress_name: Optional[str] = None,
        limit: Optional[int] = None,
        has_subtitle: Optional[bool] = None
    ) -> List[str]:
        """
        从数据库获取视频编号列表
        
        Args:
            video_type: 视频类型筛选，默认"无码破解"，None表示不筛选
            actress_name: 演员名称筛选，None表示不筛选
            limit: 限制返回数量，None表示不限制
            has_subtitle: 是否已有字幕，None表示不筛选
            
        Returns:
            List[str]: 视频编号列表
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # 构建查询条件
            conditions = []
            params = []
            
            # 视频类型筛选
            if video_type is not None:
                conditions.append("video_type = ?")
                params.append(video_type.strip())
            
            # 演员名称筛选
            if actress_name is not None:
                conditions.append("actress_name LIKE ?")
                params.append(f"%{actress_name.strip()}%")
            
            # 字幕状态筛选
            if has_subtitle is not None:
                if has_subtitle:
                    conditions.append("subtitle_downloaded = 1")
                else:
                    conditions.append("(subtitle_downloaded = 0 OR subtitle_downloaded IS NULL)")
            
            # 构建SQL查询
            base_query = "SELECT DISTINCT video_id FROM videos"
            if conditions:
                base_query += " WHERE " + " AND ".join(conditions)
            
            base_query += " ORDER BY video_id"
            
            if limit is not None and limit > 0:
                base_query += f" LIMIT {limit}"
            
            print(f"🔍 数据库查询: {base_query}")
            print(f"📋 查询参数: {params}")
            
            cursor.execute(base_query, params)
            results = cursor.fetchall()
            
            # 提取视频编号
            video_codes = [row[0] for row in results if row[0]]
            
            print(f"📊 查询结果: 共找到 {len(video_codes)} 个视频编号")
            if len(video_codes) > 0:
                print(f"🎬 示例编号: {video_codes[:5]}{'...' if len(video_codes) > 5 else ''}")
            
            conn.close()
            return video_codes
            
        except sqlite3.Error as e:
            print(f"❌ 数据库查询失败: {e}")
            return []
        except Exception as e:
            print(f"❌ 获取视频编号失败: {e}")
            return []
    
    def get_videos_by_criteria(
        self,
        video_type: Optional[str] = None,
        actress_name: Optional[str] = None,
        limit: Optional[int] = None,
        has_subtitle: Optional[bool] = None
    ) -> List[Dict[str, Any]]:
        """
        根据条件获取完整的视频信息
        
        Args:
            video_type: 视频类型筛选
            actress_name: 演员名称筛选
            limit: 限制返回数量
            has_subtitle: 是否已有字幕
            
        Returns:
            List[Dict]: 视频信息列表
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row  # 使结果可以按列名访问
            cursor = conn.cursor()
            
            # 构建查询条件
            conditions = []
            params = []
            
            if video_type is not None:
                conditions.append("video_type = ?")
                params.append(video_type.strip())
            
            if actress_name is not None:
                conditions.append("actress_name LIKE ?")
                params.append(f"%{actress_name.strip()}%")
            
            if has_subtitle is not None:
                if has_subtitle:
                    conditions.append("subtitle_downloaded = 1")
                else:
                    conditions.append("(subtitle_downloaded = 0 OR subtitle_downloaded IS NULL)")
            
            # 构建SQL查询
            base_query = """
                SELECT video_id, video_title, video_url, actress_name, video_type,
                       release_date, cover_url, description, actresses, actors, 
                       genres, series, maker, director, subtitle_downloaded
                FROM videos
            """
            
            if conditions:
                base_query += " WHERE " + " AND ".join(conditions)
            
            base_query += " ORDER BY video_id"
            
            if limit is not None and limit > 0:
                base_query += f" LIMIT {limit}"
            
            cursor.execute(base_query, params)
            results = cursor.fetchall()
            
            # 转换为字典列表
            videos = []
            for row in results:
                video_dict = dict(row)
                videos.append(video_dict)
            
            print(f"📊 查询结果: 共找到 {len(videos)} 个视频记录")
            
            conn.close()
            return videos
            
        except sqlite3.Error as e:
            print(f"❌ 数据库查询失败: {e}")
            return []
        except Exception as e:
            print(f"❌ 获取视频信息失败: {e}")
            return []
    
    def get_actresses_list(self) -> List[str]:
        """
        获取所有演员名称列表
        
        Returns:
            List[str]: 演员名称列表
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("SELECT DISTINCT actress_name FROM videos WHERE actress_name IS NOT NULL ORDER BY actress_name")
            results = cursor.fetchall()
            
            actresses = [row[0] for row in results if row[0]]
            
            print(f"👩‍🎭 找到 {len(actresses)} 个演员")
            
            conn.close()
            return actresses
            
        except sqlite3.Error as e:
            print(f"❌ 获取演员列表失败: {e}")
            return []
    
    def get_video_types(self) -> List[str]:
        """
        获取所有视频类型列表
        
        Returns:
            List[str]: 视频类型列表
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("SELECT DISTINCT video_type FROM videos WHERE video_type IS NOT NULL ORDER BY video_type")
            results = cursor.fetchall()
            
            types = [row[0] for row in results if row[0]]
            
            print(f"🎭 找到 {len(types)} 种视频类型: {types}")
            
            conn.close()
            return types
            
        except sqlite3.Error as e:
            print(f"❌ 获取视频类型失败: {e}")
            return []


# 兼容性函数 - 保持与csv_utils.py相同的接口
def get_video_codes_from_csv(
    csv_path: str = None,  # 保持参数兼容性，但实际不使用
    video_type: Optional[str] = "无码破解",
    title_col: str = "video_title"  # 保持参数兼容性
) -> List[str]:
    """
    兼容性函数：从数据库获取视频编号（替代CSV模式）
    
    Args:
        csv_path: CSV路径（保持兼容性，实际不使用）
        video_type: 视频类型筛选
        title_col: 标题列名（保持兼容性，实际不使用）
        
    Returns:
        List[str]: 视频编号列表
    """
    print("🔄 使用数据库模式替代CSV模式")
    db_utils = DatabaseUtils()
    return db_utils.get_video_codes_from_db(video_type=video_type)


def get_video_codes_from_db(
    video_type: Optional[str] = "无码破解",
    actress_name: Optional[str] = None,
    limit: Optional[int] = None,
    has_subtitle: Optional[bool] = None
) -> List[str]:
    """
    从数据库获取视频编号的便捷函数
    
    Args:
        video_type: 视频类型筛选
        actress_name: 演员名称筛选
        limit: 限制返回数量
        has_subtitle: 是否已有字幕
        
    Returns:
        List[str]: 视频编号列表
    """
    db_utils = DatabaseUtils()
    return db_utils.get_video_codes_from_db(
        video_type=video_type,
        actress_name=actress_name,
        limit=limit,
        has_subtitle=has_subtitle
    )


if __name__ == "__main__":
    # 测试代码
    print("🧪 测试数据库工具模块")
    
    try:
        db_utils = DatabaseUtils()
        
        # 测试获取视频编号
        print("\n1. 测试获取无码破解视频编号（限制10个）:")
        codes = db_utils.get_video_codes_from_db(video_type="无码破解", limit=10)
        print(f"结果: {codes}")
        
        # 测试获取演员列表
        print("\n2. 测试获取演员列表:")
        actresses = db_utils.get_actresses_list()
        print(f"前10个演员: {actresses[:10]}")
        
        # 测试获取视频类型
        print("\n3. 测试获取视频类型:")
        types = db_utils.get_video_types()
        print(f"视频类型: {types}")
        
        # 测试兼容性函数
        print("\n4. 测试兼容性函数:")
        compat_codes = get_video_codes_from_csv(video_type="无码破解")
        print(f"兼容性函数结果: {compat_codes[:5]}")
        
    except Exception as e:
        print(f"❌ 测试失败: {e}")