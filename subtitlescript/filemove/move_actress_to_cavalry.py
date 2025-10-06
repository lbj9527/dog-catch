#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
女优分类文件移动脚本
功能：将女优分类目录下的文件按照文件名前缀匹配移动到骑兵字幕目录
规则：
1. 提取文件名前缀（如SDMU、HND等）
2. 在骑兵字幕目录下查找匹配的文件夹
3. 移动文件到对应的文件夹

作者：AI Assistant
创建时间：2024
"""

import os
import shutil
import logging
import re
from pathlib import Path
from typing import List, Tuple, Dict, Optional

# 配置
SOURCE_DIR = r"E:\missav\JAV 外挂字幕包\字幕包\步兵字幕\其他"
TARGET_BASE_DIR = r"E:\missav\JAV 外挂字幕包\字幕包\骑兵字幕"
LOG_FILE = "move_actress_to_cavalry.log"

# 如果您的目录路径不同，请修改上面的路径变量

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)


class ActressFileMover:
    """女优分类文件移动器"""
    
    def __init__(self, source_dir: str, target_base_dir: str):
        """
        初始化文件移动器
        
        Args:
            source_dir: 源目录路径（女优分类）
            target_base_dir: 目标基础目录路径（骑兵字幕）
        """
        self.source_dir = Path(source_dir)
        self.target_base_dir = Path(target_base_dir)
        
        # 文件名前缀提取正则表达式
        # 匹配如 SDMU-869、HND-437 等格式，但排除特定格式
        self.prefix_pattern = re.compile(r'^([A-Z]+)(?:-\d+|_\d+)', re.IGNORECASE)
        
        # 排除的文件名模式
        self.exclude_patterns = [
            re.compile(r'^\d{6}-\d{3}-carib', re.IGNORECASE),  # 062416-192-carib-1080p.srt
            re.compile(r'^\(Heyzo\)', re.IGNORECASE),          # (Heyzo)(1473)...
            re.compile(r'^\d+pon_', re.IGNORECASE),            # 1pon_052315_085_1080p.srt
        ]
        
    def validate_directories(self) -> bool:
        """
        验证源目录和目标目录是否存在且可访问
        
        Returns:
            bool: 目录是否有效
        """
        if not self.source_dir.exists():
            logger.error(f"源目录不存在: {self.source_dir}")
            return False
            
        if not self.source_dir.is_dir():
            logger.error(f"源路径不是目录: {self.source_dir}")
            return False
            
        if not self.target_base_dir.exists():
            logger.error(f"目标基础目录不存在: {self.target_base_dir}")
            return False
            
        if not self.target_base_dir.is_dir():
            logger.error(f"目标基础路径不是目录: {self.target_base_dir}")
            return False
            
        try:
            # 测试读取权限
            list(self.source_dir.iterdir())
            list(self.target_base_dir.iterdir())
            return True
        except PermissionError as e:
            logger.error(f"没有访问目录的权限: {e}")
            return False
        except Exception as e:
            logger.error(f"访问目录时发生错误: {e}")
            return False
    
    def extract_filename_prefix(self, filename: str) -> Optional[str]:
        """
        从文件名中提取前缀
        
        Args:
            filename: 文件名
            
        Returns:
            Optional[str]: 提取的前缀，如果不符合规则则返回None
        """
        # 检查是否匹配排除模式
        for exclude_pattern in self.exclude_patterns:
            if exclude_pattern.match(filename):
                logger.debug(f"文件名 {filename} 匹配排除模式，跳过")
                return None
        
        # 提取前缀
        match = self.prefix_pattern.match(filename)
        if match:
            prefix = match.group(1).upper()
            logger.debug(f"从文件名 {filename} 提取前缀: {prefix}")
            return prefix
        
        logger.debug(f"文件名 {filename} 不符合前缀提取规则")
        return None
    
    def scan_source_files(self) -> List[Path]:
        """
        递归扫描源目录下的所有文件
        
        Returns:
            List[Path]: 源文件列表
        """
        files = []
        
        try:
            for root, dirs, filenames in os.walk(self.source_dir):
                root_path = Path(root)
                
                for filename in filenames:
                    file_path = root_path / filename
                    files.append(file_path)
                    
            logger.info(f"源目录发现 {len(files)} 个文件")
            return files
            
        except Exception as e:
            logger.error(f"扫描源目录时发生错误: {e}")
            return []
    
    def scan_target_folders(self) -> Dict[str, Path]:
        """
        扫描目标目录下的所有文件夹，建立前缀到路径的映射
        
        Returns:
            Dict[str, Path]: {前缀: 文件夹路径}
        """
        target_folders = {}
        
        try:
            for root, dirs, files in os.walk(self.target_base_dir):
                root_path = Path(root)
                
                for dirname in dirs:
                    folder_path = root_path / dirname
                    # 使用文件夹名作为键（转换为大写以便匹配）
                    folder_key = dirname.upper()
                    target_folders[folder_key] = folder_path
                    
            logger.info(f"目标目录发现 {len(target_folders)} 个文件夹")
            return target_folders
            
        except Exception as e:
            logger.error(f"扫描目标目录时发生错误: {e}")
            return {}
    
    def find_target_folder(self, prefix: str, target_folders: Dict[str, Path]) -> Optional[Path]:
        """
        查找匹配的目标文件夹，如果不存在则创建
        
        Args:
            prefix: 文件名前缀
            target_folders: 目标文件夹映射
            
        Returns:
            Optional[Path]: 匹配的文件夹路径
        """
        prefix_upper = prefix.upper()
        
        if prefix_upper in target_folders:
            logger.debug(f"找到匹配的文件夹: {prefix} -> {target_folders[prefix_upper]}")
            return target_folders[prefix_upper]
        
        # 如果没有找到匹配的文件夹，尝试创建新文件夹
        logger.debug(f"未找到匹配的文件夹: {prefix}，尝试创建新文件夹")
        return self.create_target_folder(prefix)
    
    def create_target_folder(self, prefix: str) -> Optional[Path]:
        """
        根据前缀创建目标文件夹
        
        Args:
            prefix: 文件名前缀
            
        Returns:
            Optional[Path]: 创建的文件夹路径
        """
        prefix_upper = prefix.upper()
        
        # 确定首字母分类文件夹
        first_letter = prefix_upper[0]
        letter_folder_name = f"{first_letter}开头"
        letter_folder_path = self.target_base_dir / letter_folder_name
        
        # 创建首字母分类文件夹（如果不存在）
        try:
            letter_folder_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"确保首字母分类文件夹存在: {letter_folder_path}")
        except Exception as e:
            logger.error(f"创建首字母分类文件夹失败: {letter_folder_path}, 错误: {e}")
            return None
        
        # 创建前缀文件夹
        prefix_folder_path = letter_folder_path / prefix_upper
        try:
            prefix_folder_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"创建新的前缀文件夹: {prefix_folder_path}")
            return prefix_folder_path
        except Exception as e:
            logger.error(f"创建前缀文件夹失败: {prefix_folder_path}, 错误: {e}")
            return None
    
    def get_unique_filename(self, target_dir: Path, filename: str) -> str:
        """
        生成唯一的文件名，避免冲突
        
        Args:
            target_dir: 目标目录
            filename: 原文件名
            
        Returns:
            str: 唯一的文件名
        """
        target_file = target_dir / filename
        if not target_file.exists():
            return filename
        
        # 分离文件名和扩展名
        name_parts = filename.rsplit('.', 1)
        if len(name_parts) == 2:
            name, ext = name_parts
        else:
            name, ext = filename, ""
        
        counter = 2
        while True:
            if ext:
                new_filename = f"{name}-{counter}.{ext}"
            else:
                new_filename = f"{name}-{counter}"
            
            new_target_file = target_dir / new_filename
            if not new_target_file.exists():
                return new_filename
            counter += 1
    
    def plan_moves(self) -> List[Tuple[Path, Path, str]]:
        """
        规划文件移动操作
        
        Returns:
            List[Tuple[Path, Path, str]]: (源文件路径, 目标文件路径, 前缀) 的列表
        """
        source_files = self.scan_source_files()
        target_folders = self.scan_target_folders()
        move_plans = []
        
        for file_path in source_files:
            filename = file_path.name
            prefix = self.extract_filename_prefix(filename)
            
            if prefix is None:
                logger.debug(f"跳过文件（无法提取前缀）: {filename}")
                continue
            
            target_folder = self.find_target_folder(prefix, target_folders)
            
            if target_folder is None:
                logger.warning(f"跳过文件（无法创建目标文件夹）: {filename} (前缀: {prefix})")
                continue
            
            # 生成唯一文件名
            unique_filename = self.get_unique_filename(target_folder, filename)
            target_file_path = target_folder / unique_filename
            
            move_plans.append((file_path, target_file_path, prefix))
        
        return move_plans
    
    def preview_moves(self) -> List[Tuple[Path, Path, str]]:
        """
        预览文件移动操作
        
        Returns:
            List[Tuple[Path, Path, str]]: 移动计划列表
        """
        logger.info("=" * 70)
        logger.info("女优分类文件移动预览")
        logger.info("=" * 70)
        
        move_plans = self.plan_moves()
        
        if not move_plans:
            logger.info("没有找到需要移动的文件")
            return []
        
        logger.info(f"将执行 {len(move_plans)} 个文件的移动操作:")
        
        # 按前缀分组显示
        prefix_groups = {}
        for source_path, target_path, prefix in move_plans:
            if prefix not in prefix_groups:
                prefix_groups[prefix] = []
            prefix_groups[prefix].append((source_path, target_path))
        
        for prefix, files in prefix_groups.items():
            logger.info(f"\n前缀 {prefix} ({len(files)} 个文件):")
            for i, (source_path, target_path) in enumerate(files, 1):
                relative_source = source_path.relative_to(self.source_dir)
                relative_target = target_path.relative_to(self.target_base_dir)
                logger.info(f"  {i:2d}. {relative_source} -> {relative_target}")
        
        return move_plans
    
    def execute_moves(self, move_plans: List[Tuple[Path, Path, str]], dry_run: bool = True) -> bool:
        """
        执行文件移动操作
        
        Args:
            move_plans: 移动计划列表
            dry_run: 是否为干运行模式
            
        Returns:
            bool: 是否成功
        """
        if not move_plans:
            logger.info("没有需要执行的移动操作")
            return True
        
        success_count = 0
        error_count = 0
        
        logger.info("=" * 70)
        if dry_run:
            logger.info("干运行模式 - 不会实际移动文件")
        else:
            logger.info("开始执行文件移动操作")
        logger.info("=" * 70)
        
        for source_path, target_path, prefix in move_plans:
            try:
                if dry_run:
                    logger.info(f"[干运行] 移动: {source_path.name} -> {target_path} (前缀: {prefix})")
                    success_count += 1
                else:
                    # 确保目标目录存在
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(source_path), str(target_path))
                    logger.info(f"[成功] 移动: {source_path.name} -> {target_path} (前缀: {prefix})")
                    success_count += 1
                    
            except FileExistsError:
                logger.error(f"[失败] 目标文件已存在: {target_path}")
                error_count += 1
            except PermissionError:
                logger.error(f"[失败] 没有权限移动文件: {source_path}")
                error_count += 1
            except Exception as e:
                logger.error(f"[失败] 移动文件 {source_path.name} 时发生错误: {e}")
                error_count += 1
        
        logger.info("=" * 70)
        logger.info(f"移动操作完成: 成功 {success_count} 个, 失败 {error_count} 个")
        logger.info("=" * 70)
        
        return error_count == 0


def main():
    """主函数"""
    print("女优分类文件移动工具")
    print("功能：按照文件名前缀将文件移动到骑兵字幕对应文件夹")
    print("=" * 70)
    
    # 创建文件移动器实例
    mover = ActressFileMover(SOURCE_DIR, TARGET_BASE_DIR)
    
    # 验证目录
    if not mover.validate_directories():
        print("目录验证失败，程序退出")
        return
    
    # 预览移动操作
    move_plans = mover.preview_moves()
    
    if not move_plans:
        print("没有找到需要移动的文件")
        return
    
    # 用户确认
    print("\n请选择操作:")
    print("1. 执行文件移动")
    print("2. 仅预览，不执行")
    print("3. 退出")
    
    while True:
        choice = input("\n请输入选择 (1/2/3): ").strip()
        
        if choice == '1':
            # 执行移动
            print("\n⚠️  警告：此操作将移动文件到目标目录！")
            print("确认执行文件移动操作吗？")
            confirm = input("输入 'YES' 确认执行: ").strip()
            
            if confirm == 'YES':
                success = mover.execute_moves(move_plans, dry_run=False)
                if success:
                    print("\n✅ 所有文件移动操作已成功完成！")
                else:
                    print("\n❌ 部分文件移动操作失败，请查看日志了解详情")
            else:
                print("操作已取消")
            break
            
        elif choice == '2':
            # 仅预览
            mover.execute_moves(move_plans, dry_run=True)
            break
            
        elif choice == '3':
            print("程序退出")
            break
            
        else:
            print("无效选择，请重新输入")


if __name__ == "__main__":
    main()