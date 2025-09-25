"""
数据库管理模块
完全替代CSV文件和progress.json文件，使用SQLite数据库存储所有数据
"""

import sqlite3
import json
import os
import re
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from pathlib import Path


class DatabaseManager:
    """数据库管理器，处理所有数据存储和进度管理"""
    
    def __init__(self, db_path: str = "./database/actresses.db"):
        self.db_path = db_path
        self.ensure_database_dir()
        self.init_database()
    
    def ensure_database_dir(self):
        """确保数据库目录存在"""
        db_dir = os.path.dirname(self.db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
    
    def init_database(self):
        """初始化数据库表结构"""
        with sqlite3.connect(self.db_path) as conn:
            # 创建进度管理表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS crawl_progress (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    start_time TEXT NOT NULL,
                    last_update TEXT NOT NULL,
                    total_actresses INTEGER DEFAULT 0,
                    completed_actresses INTEGER DEFAULT 0,
                    current_actress TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # 创建演员状态表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS actress_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    actress_name TEXT UNIQUE NOT NULL,
                    url TEXT NOT NULL,
                    status TEXT NOT NULL,
                    start_time TEXT,
                    end_time TEXT,
                    total_pages INTEGER DEFAULT 0,
                    completed_pages INTEGER DEFAULT 0,
                    total_videos INTEGER DEFAULT 0,
                    last_page INTEGER DEFAULT 0,
                    last_position_in_page INTEGER DEFAULT 0,
                    errors TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # 创建演员列表表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS actress_list (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    last_page INTEGER DEFAULT 0,
                    total_count INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # 创建演员URL表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS actress_urls (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    actress_name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    page_discovered INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.commit()
    
    def sanitize_table_name(self, actress_name: str) -> str:
        """将演员名转换为安全的表名"""
        safe_name = re.sub(r'[^\w\u4e00-\u9fff]', '_', actress_name)
        return f"actress_{safe_name}"
    
    # ==================== 进度管理方法 ====================
    
    def init_crawl_session(self) -> int:
        """初始化抓取会话，返回会话ID"""
        now = datetime.now().isoformat()
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                INSERT INTO crawl_progress (start_time, last_update)
                VALUES (?, ?)
            """, (now, now))
            conn.commit()
            return cursor.lastrowid
    
    def update_crawl_progress(self, total_actresses: int = None, 
                            completed_actresses: int = None, 
                            current_actress: str = None):
        """更新抓取进度"""
        now = datetime.now().isoformat()
        
        with sqlite3.connect(self.db_path) as conn:
            # 获取最新的进度记录
            cursor = conn.execute("SELECT id FROM crawl_progress ORDER BY id DESC LIMIT 1")
            row = cursor.fetchone()
            
            if not row:
                # 如果没有进度记录，创建一个
                self.init_crawl_session()
                cursor = conn.execute("SELECT id FROM crawl_progress ORDER BY id DESC LIMIT 1")
                row = cursor.fetchone()
            
            progress_id = row[0]
            
            # 构建更新语句
            updates = ["last_update = ?"]
            params = [now]
            
            if total_actresses is not None:
                updates.append("total_actresses = ?")
                params.append(total_actresses)
            
            if completed_actresses is not None:
                updates.append("completed_actresses = ?")
                params.append(completed_actresses)
            
            if current_actress is not None:
                updates.append("current_actress = ?")
                params.append(current_actress)
            
            params.append(progress_id)
            
            conn.execute(f"""
                UPDATE crawl_progress 
                SET {', '.join(updates)}
                WHERE id = ?
            """, params)
            conn.commit()
    
    def get_crawl_progress(self) -> Dict[str, Any]:
        """获取当前抓取进度"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                SELECT start_time, last_update, total_actresses, 
                       completed_actresses, current_actress
                FROM crawl_progress 
                ORDER BY id DESC LIMIT 1
            """)
            row = cursor.fetchone()
            
            if not row:
                return {
                    "start_time": None,
                    "last_update": None,
                    "total_actresses": 0,
                    "completed_actresses": 0,
                    "current_actress": None
                }
            
            return {
                "start_time": row[0],
                "last_update": row[1],
                "total_actresses": row[2] or 0,
                "completed_actresses": row[3] or 0,
                "current_actress": row[4]
            }
    
    # ==================== 演员状态管理方法 ====================
    
    def start_actress(self, actress_name: str, actress_url: str):
        """开始处理演员"""
        now = datetime.now().isoformat()
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT OR REPLACE INTO actress_status 
                (actress_name, url, status, start_time, total_pages, 
                 completed_pages, total_videos, last_page, errors, updated_at)
                VALUES (?, ?, 'processing', ?, 0, 0, 0, 0, '[]', ?)
            """, (actress_name, actress_url, now, now))
            conn.commit()
        
        # 更新当前处理的演员
        self.update_crawl_progress(current_actress=actress_name)
    
    def update_actress_pages(self, actress_name: str, total_pages: int):
        """更新演员总页数"""
        now = datetime.now().isoformat()
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                UPDATE actress_status 
                SET total_pages = ?, updated_at = ?
                WHERE actress_name = ?
            """, (total_pages, now, actress_name))
            conn.commit()
    
    def complete_page(self, actress_name: str, page_no: int, position_in_page: int = None):
        """标记页面完成，支持作品级别的进度记录"""
        now = datetime.now().isoformat()
        
        with sqlite3.connect(self.db_path) as conn:
            # 从数据库表中获取实际的视频总数
            table_name = self.sanitize_table_name(actress_name)
            try:
                cursor = conn.execute(f"SELECT COUNT(*) FROM {table_name}")
                total_videos = cursor.fetchone()[0]
            except sqlite3.OperationalError:
                total_videos = 0
            
            # 获取当前状态
            cursor = conn.execute("""
                SELECT completed_pages 
                FROM actress_status 
                WHERE actress_name = ?
            """, (actress_name,))
            row = cursor.fetchone()
            
            if row:
                new_completed_pages = max(row[0], page_no)
                
                conn.execute("""
                    UPDATE actress_status 
                    SET completed_pages = ?, total_videos = ?, 
                        last_page = ?, last_position_in_page = ?, updated_at = ?
                    WHERE actress_name = ?
                """, (new_completed_pages, total_videos, page_no, position_in_page or 0, now, actress_name))
            else:
                # 如果不存在记录，创建新记录
                conn.execute("""
                    INSERT INTO actress_status 
                    (actress_name, url, status, completed_pages, total_videos, 
                     last_page, last_position_in_page, start_time, updated_at)
                    VALUES (?, ?, 'processing', ?, ?, ?, ?, ?, ?)
                """, (actress_name, '', page_no, total_videos, page_no, position_in_page or 0, now, now))
            
            conn.commit()
    
    def complete_actress(self, actress_name: str):
        """完成演员处理"""
        now = datetime.now().isoformat()
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                UPDATE actress_status 
                SET status = 'completed', end_time = ?, updated_at = ?
                WHERE actress_name = ?
            """, (now, now, actress_name))
            conn.commit()
        
        # 更新完成的演员数量
        completed_count = self.get_completed_actresses_count()
        self.update_crawl_progress(completed_actresses=completed_count)
    
    def add_actress_error(self, actress_name: str, error_msg: str):
        """添加演员处理错误"""
        now = datetime.now().isoformat()
        
        with sqlite3.connect(self.db_path) as conn:
            # 获取当前错误列表
            cursor = conn.execute("""
                SELECT errors FROM actress_status WHERE actress_name = ?
            """, (actress_name,))
            row = cursor.fetchone()
            
            if row:
                try:
                    errors = json.loads(row[0] or '[]')
                except:
                    errors = []
                
                errors.append({
                    "message": error_msg,
                    "timestamp": now
                })
                
                conn.execute("""
                    UPDATE actress_status 
                    SET errors = ?, updated_at = ?
                    WHERE actress_name = ?
                """, (json.dumps(errors), now, actress_name))
                conn.commit()
    
    def is_actress_completed(self, actress_name: str) -> bool:
        """检查演员是否已完成"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                SELECT status FROM actress_status WHERE actress_name = ?
            """, (actress_name,))
            row = cursor.fetchone()
            return row and row[0] == 'completed'
    
    def get_actress_resume_info(self, actress_name: str) -> Tuple[int, int]:
        """获取演员的恢复信息（页级别）"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                SELECT last_page, total_videos FROM actress_status 
                WHERE actress_name = ?
            """, (actress_name,))
            row = cursor.fetchone()
            
            if row:
                return row[0] + 1, row[1]  # 从下一页开始
            return 1, 0
    
    def get_actress_last_video_info(self, actress_name: str) -> Tuple[int, int, int]:
        """获取演员最后保存的作品信息（作品级别）
        返回: (last_page, last_position_in_page, total_videos)
        """
        table_name = self.sanitize_table_name(actress_name)
        
        try:
            with sqlite3.connect(self.db_path) as conn:
                # 从actress_status表获取最后的页面和位置信息
                cursor = conn.execute("""
                    SELECT last_page, last_position_in_page 
                    FROM actress_status 
                    WHERE actress_name = ?
                """, (actress_name,))
                status_row = cursor.fetchone()
                
                if status_row and status_row[0] is not None:
                    last_page = status_row[0]
                    last_position = status_row[1] or 0
                    
                    # 获取总作品数
                    cursor = conn.execute(f"SELECT COUNT(*) FROM {table_name}")
                    total_videos = cursor.fetchone()[0]
                    
                    # 作品级断点续传：直接返回当前记录的位置
                    # last_position表示已处理的作品数量，下次应该从last_position开始（0-based索引）
                    return last_page, last_position, total_videos
                else:
                    return 1, 0, 0
        except sqlite3.OperationalError:
            # 表不存在，说明还没有保存过作品
            return 1, 0, 0
    
    def get_completed_actresses_count(self) -> int:
        """获取已完成的演员数量"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                SELECT COUNT(*) FROM actress_status WHERE status = 'completed'
            """)
            return cursor.fetchone()[0]
    
    # ==================== 演员列表管理方法 ====================
    
    def update_actress_list_progress(self, last_page: int, total_count: int):
        """更新演员列表抓取进度"""
        now = datetime.now().isoformat()
        
        with sqlite3.connect(self.db_path) as conn:
            # 删除旧记录，插入新记录
            conn.execute("DELETE FROM actress_list")
            conn.execute("""
                INSERT INTO actress_list (last_page, total_count, updated_at)
                VALUES (?, ?, ?)
            """, (last_page, total_count, now))
            conn.commit()
    
    def get_actress_list_progress(self) -> Tuple[int, int]:
        """获取演员列表抓取进度"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                SELECT last_page, total_count FROM actress_list 
                ORDER BY id DESC LIMIT 1
            """)
            row = cursor.fetchone()
            return (row[0], row[1]) if row else (0, 0)
    
    def save_actress_urls(self, actress_urls: List[str], page_no: int = 1):
        """保存演员URL列表"""
        with sqlite3.connect(self.db_path) as conn:
            for url in actress_urls:
                # 从URL提取演员名
                actress_name = self._extract_actress_name_from_url(url)
                
                conn.execute("""
                    INSERT OR IGNORE INTO actress_urls 
                    (actress_name, url, page_discovered)
                    VALUES (?, ?, ?)
                """, (actress_name, url, page_no))
            conn.commit()
    
    def get_all_actress_urls(self) -> List[str]:
        """获取所有演员URL"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("SELECT url FROM actress_urls ORDER BY id")
            return [row[0] for row in cursor.fetchall()]
    
    def _extract_actress_name_from_url(self, url: str) -> str:
        """从URL提取演员名"""
        from urllib.parse import urlparse, unquote
        try:
            path = urlparse(url).path or ""
            if path.endswith("/"):
                path = path[:-1]
            last = path.rsplit("/", 1)[-1] if path else ""
            name = unquote(last).strip()
            return name or "unknown"
        except Exception:
            return "unknown"
    
    # ==================== 演员视频数据管理方法 ====================
    
    def create_actress_table(self, actress_name: str):
        """为演员创建数据表"""
        table_name = self.sanitize_table_name(actress_name)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    video_title TEXT NOT NULL,
                    video_url TEXT,
                    video_type TEXT,
                    video_id TEXT,
                    id_pattern_type TEXT,
                    page_no INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
    
    def insert_videos(self, actress_name: str, videos: List[Dict[str, Any]]):
        """批量插入视频数据"""
        if not videos:
            return
        
        table_name = self.sanitize_table_name(actress_name)
        self.create_actress_table(actress_name)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.executemany(f"""
                INSERT INTO {table_name} 
                (video_title, video_url, video_type, video_id, id_pattern_type, page_no)
                VALUES (?, ?, ?, ?, ?, ?)
            """, [
                (v['video_title'], v['video_url'], v['video_type'], 
                 v['video_id'], v['id_pattern_type'], v['page_no'])
                for v in videos
            ])
            conn.commit()
    
    def get_actress_video_count(self, actress_name: str) -> int:
        """获取演员的视频总数"""
        table_name = self.sanitize_table_name(actress_name)
        
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute(f"SELECT COUNT(*) FROM {table_name}")
                return cursor.fetchone()[0]
        except sqlite3.OperationalError:
            return 0
    
    def get_actress_videos(self, actress_name: str, 
                          video_type: str = None) -> List[Dict[str, Any]]:
        """获取演员的视频列表"""
        table_name = self.sanitize_table_name(actress_name)
        
        try:
            with sqlite3.connect(self.db_path) as conn:
                if video_type:
                    cursor = conn.execute(f"""
                        SELECT video_title, video_url, video_type, 
                               video_id, id_pattern_type, page_no
                        FROM {table_name} 
                        WHERE video_type = ?
                        ORDER BY page_no, id
                    """, (video_type,))
                else:
                    cursor = conn.execute(f"""
                        SELECT video_title, video_url, video_type, 
                               video_id, id_pattern_type, page_no
                        FROM {table_name} 
                        ORDER BY page_no, id
                    """)
                
                columns = ['video_title', 'video_url', 'video_type', 
                          'video_id', 'id_pattern_type', 'page_no']
                return [dict(zip(columns, row)) for row in cursor.fetchall()]
        except sqlite3.OperationalError:
            return []
    
    # ==================== 统计和查询方法 ====================
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取抓取统计信息"""
        with sqlite3.connect(self.db_path) as conn:
            # 获取总体进度
            progress = self.get_crawl_progress()
            
            # 获取演员状态统计
            cursor = conn.execute("""
                SELECT status, COUNT(*) FROM actress_status GROUP BY status
            """)
            status_counts = dict(cursor.fetchall())
            
            # 获取总视频数
            cursor = conn.execute("""
                SELECT SUM(total_videos) FROM actress_status
            """)
            total_videos = cursor.fetchone()[0] or 0
            
            return {
                "progress": progress,
                "actress_status_counts": status_counts,
                "total_videos": total_videos
            }
    
    def print_progress(self):
        """打印当前进度"""
        stats = self.get_statistics()
        progress = stats["progress"]
        status_counts = stats["actress_status_counts"]
        
        print("\n" + "="*50)
        print("抓取进度统计")
        print("="*50)
        print(f"开始时间: {progress['start_time']}")
        print(f"最后更新: {progress['last_update']}")
        print(f"总演员数: {progress['total_actresses']}")
        print(f"已完成: {progress['completed_actresses']}")
        print(f"当前处理: {progress['current_actress'] or '无'}")
        print(f"总视频数: {stats['total_videos']}")
        
        if status_counts:
            print("\n演员状态分布:")
            for status, count in status_counts.items():
                print(f"  {status}: {count}")
        
        print("="*50)