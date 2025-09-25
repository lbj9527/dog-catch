#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
数据库查询和导出工具
提供数据库查询、统计和导出功能，替代原有的CSV文件功能
"""

import argparse
import json
import os
import sqlite3
from typing import List, Dict, Any, Optional
from database_manager import DatabaseManager


class DatabaseQuery:
    """数据库查询类"""
    
    def __init__(self, db_path: str = "./database/actresses.db"):
        self.db_manager = DatabaseManager(db_path)
    
    def list_actresses(self) -> List[Dict[str, Any]]:
        """列出所有演员"""
        return self.db_manager.get_all_actresses()
    
    def get_actress_videos(self, actress_name: str) -> List[Dict[str, Any]]:
        """获取指定演员的所有视频"""
        return self.db_manager.get_actress_videos(actress_name)
    
    def get_actress_stats(self, actress_name: str) -> Dict[str, Any]:
        """获取演员统计信息"""
        videos = self.get_actress_videos(actress_name)
        if not videos:
            return {"actress_name": actress_name, "video_count": 0}
        
        return {
            "actress_name": actress_name,
            "video_count": len(videos),
            "video_types": list(set(v.get("video_type", "") for v in videos if v.get("video_type"))),
            "id_patterns": list(set(v.get("id_pattern_type", "") for v in videos if v.get("id_pattern_type"))),
            "page_range": {
                "min": min(v.get("page_no", 0) for v in videos if v.get("page_no")),
                "max": max(v.get("page_no", 0) for v in videos if v.get("page_no"))
            }
        }
    
    def search_videos(self, keyword: str = "", video_type: str = "", actress_name: str = "") -> List[Dict[str, Any]]:
        """搜索视频"""
        results = []
        
        if actress_name:
            # 搜索指定演员的视频
            videos = self.get_actress_videos(actress_name)
        else:
            # 搜索所有演员的视频
            actresses = self.list_actresses()
            videos = []
            for actress in actresses:
                actress_videos = self.get_actress_videos(actress["actress_name"])
                for video in actress_videos:
                    video["actress_name"] = actress["actress_name"]
                videos.extend(actress_videos)
        
        # 应用过滤条件
        for video in videos:
            if keyword and keyword.lower() not in video.get("video_title", "").lower():
                continue
            if video_type and video.get("video_type", "") != video_type:
                continue
            results.append(video)
        
        return results
    
    def export_to_csv(self, actress_name: str, output_path: str):
        """导出演员数据到CSV文件（兼容性功能）"""
        import csv
        
        videos = self.get_actress_videos(actress_name)
        if not videos:
            print(f"演员 {actress_name} 没有视频数据")
            return
        
        # 确保输出目录存在
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        
        headers = [
            "video_title",
            "video_url", 
            "video_type",
            "video_id",
            "id_pattern_type",
            "page_no",
        ]
        
        with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            for video in videos:
                writer.writerow({
                    "video_title": video.get("video_title", ""),
                    "video_url": video.get("video_url", ""),
                    "video_type": video.get("video_type", ""),
                    "video_id": video.get("video_id", ""),
                    "id_pattern_type": video.get("id_pattern_type", ""),
                    "page_no": video.get("page_no", ""),
                })
        
        print(f"演员 {actress_name} 的数据已导出到: {output_path}")
    
    def export_all_to_csv(self, output_dir: str = "./output"):
        """导出所有演员数据到CSV文件"""
        actresses = self.list_actresses()
        
        for actress in actresses:
            actress_name = actress["actress_name"]
            output_path = os.path.join(output_dir, f"actor_{actress_name}.csv")
            self.export_to_csv(actress_name, output_path)
    
    def get_crawl_progress(self) -> Dict[str, Any]:
        """获取抓取进度"""
        return self.db_manager.get_crawl_progress()
    
    def print_progress_summary(self):
        """打印进度摘要"""
        progress = self.get_crawl_progress()
        actresses = self.db_manager.get_all_actress_status()
        
        print("=== 抓取进度摘要 ===")
        print(f"开始时间: {progress.get('start_time', 'N/A')}")
        print(f"最后更新: {progress.get('last_update', 'N/A')}")
        print(f"总演员数: {progress.get('total_actresses', 0)}")
        print(f"已完成: {progress.get('completed_actresses', 0)}")
        print(f"当前演员: {progress.get('current_actress', 'N/A')}")
        
        print("\n=== 演员状态 ===")
        completed = [a for a in actresses if a["status"] == "completed"]
        in_progress = [a for a in actresses if a["status"] == "in_progress"]
        error = [a for a in actresses if a["status"] == "error"]
        
        print(f"已完成: {len(completed)}")
        print(f"进行中: {len(in_progress)}")
        print(f"错误: {len(error)}")
        
        if error:
            print("\n错误演员:")
            for actress in error[:5]:  # 只显示前5个
                print(f"  - {actress['actress_name']}: {actress.get('error_message', 'Unknown error')}")
    
    def print_actress_summary(self, actress_name: str):
        """打印演员摘要"""
        stats = self.get_actress_stats(actress_name)
        status = self.db_manager.get_actress_status(actress_name)
        
        print(f"=== 演员 {actress_name} 摘要 ===")
        print(f"视频数量: {stats['video_count']}")
        print(f"状态: {status.get('status', 'unknown')}")
        
        if status.get('status') == 'completed':
            print(f"完成时间: {status.get('end_time', 'N/A')}")
        elif status.get('status') == 'in_progress':
            print(f"当前页数: {status.get('current_page', 0)}/{status.get('total_pages', 0)}")
            print(f"总视频数: {status.get('total_videos', 0)}")
        elif status.get('status') == 'error':
            print(f"错误信息: {status.get('error_message', 'N/A')}")
        
        if stats['video_count'] > 0:
            print(f"视频类型: {', '.join(stats['video_types'])}")
            print(f"ID模式: {', '.join(stats['id_patterns'])}")
            print(f"页面范围: {stats['page_range']['min']}-{stats['page_range']['max']}")


def main():
    parser = argparse.ArgumentParser(description="数据库查询和导出工具")
    parser.add_argument("--db", default="./database/actresses.db", help="数据库路径")
    
    subparsers = parser.add_subparsers(dest="command", help="可用命令")
    
    # 列出演员
    list_parser = subparsers.add_parser("list", help="列出所有演员")
    
    # 查看演员详情
    info_parser = subparsers.add_parser("info", help="查看演员详情")
    info_parser.add_argument("actress", help="演员名")
    
    # 搜索视频
    search_parser = subparsers.add_parser("search", help="搜索视频")
    search_parser.add_argument("--keyword", help="关键词")
    search_parser.add_argument("--type", help="视频类型")
    search_parser.add_argument("--actress", help="演员名")
    
    # 导出CSV
    export_parser = subparsers.add_parser("export", help="导出到CSV")
    export_parser.add_argument("actress", help="演员名")
    export_parser.add_argument("--output", help="输出文件路径")
    
    # 导出所有CSV
    export_all_parser = subparsers.add_parser("export-all", help="导出所有演员到CSV")
    export_all_parser.add_argument("--output-dir", default="./output", help="输出目录")
    
    # 查看进度
    progress_parser = subparsers.add_parser("progress", help="查看抓取进度")
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    query = DatabaseQuery(args.db)
    
    if args.command == "list":
        actresses = query.list_actresses()
        print(f"共有 {len(actresses)} 个演员:")
        for actress in actresses:
            print(f"  - {actress['actress_name']}")
    
    elif args.command == "info":
        query.print_actress_summary(args.actress)
    
    elif args.command == "search":
        results = query.search_videos(
            keyword=args.keyword or "",
            video_type=args.type or "",
            actress_name=args.actress or ""
        )
        print(f"找到 {len(results)} 个视频:")
        for video in results[:10]:  # 只显示前10个
            print(f"  - {video.get('video_title', 'N/A')} ({video.get('actress_name', 'N/A')})")
    
    elif args.command == "export":
        output_path = args.output or f"./output/actor_{args.actress}.csv"
        query.export_to_csv(args.actress, output_path)
    
    elif args.command == "export-all":
        query.export_all_to_csv(args.output_dir)
    
    elif args.command == "progress":
        query.print_progress_summary()


if __name__ == "__main__":
    main()