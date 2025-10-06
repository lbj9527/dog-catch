#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MGSTAGE系列文件重命名脚本
功能：递归重命名MGSTAGE系列目录下的所有文件，移除文件名中的数字前缀
例如：230ORETD-839.ass -> ORETD-839.ass

作者：AI Assistant
创建时间：2024
"""

import os
import re
import logging
from pathlib import Path
from typing import List, Tuple, Optional

# 配置
TARGET_DIR = r"E:\missav\JAV 外挂字幕包\字幕包\知名厂商\MGSTAGE系列"
LOG_FILE = "rename_mgstage_files.log"

# 如果您的目录路径不同，请修改上面的 TARGET_DIR 变量
# 例如：TARGET_DIR = r"C:\您的实际路径\MGSTAGE系列"

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


class MGSTAGEFileRenamer:
    """MGSTAGE系列文件重命名器"""
    
    def __init__(self, target_directory: str):
        """
        初始化重命名器
        
        Args:
            target_directory: 目标目录路径
        """
        self.target_dir = Path(target_directory)
        # 匹配模式：数字开头 + 字母/数字/符号组合的文件名
        # 例如：230ORETD-839.ass, 107SYBI-001.srt
        self.rename_pattern = re.compile(r'^(\d+)([A-Z][A-Z0-9\-]+\..+)$', re.IGNORECASE)
        
    def validate_directory(self) -> bool:
        """
        验证目标目录是否存在且可访问
        
        Returns:
            bool: 目录是否有效
        """
        if not self.target_dir.exists():
            logger.error(f"目标目录不存在: {self.target_dir}")
            return False
            
        if not self.target_dir.is_dir():
            logger.error(f"目标路径不是目录: {self.target_dir}")
            return False
            
        try:
            # 测试读取权限
            list(self.target_dir.iterdir())
            return True
        except PermissionError:
            logger.error(f"没有访问目录的权限: {self.target_dir}")
            return False
        except Exception as e:
            logger.error(f"访问目录时发生错误: {e}")
            return False
    
    def scan_files_recursive(self) -> List[Path]:
        """
        递归扫描目标目录下的所有文件
        
        Returns:
            List[Path]: 文件列表
        """
        try:
            files = []
            for root, dirs, filenames in os.walk(self.target_dir):
                for filename in filenames:
                    file_path = Path(root) / filename
                    files.append(file_path)
            
            logger.info(f"递归扫描发现 {len(files)} 个文件")
            return files
        except Exception as e:
            logger.error(f"递归扫描文件时发生错误: {e}")
            return []
    
    def extract_new_filename(self, filename: str) -> Optional[str]:
        """
        从文件名提取新名称
        
        Args:
            filename: 原文件名
            
        Returns:
            Optional[str]: 新文件名，如果不匹配模式则返回None
        """
        match = self.rename_pattern.match(filename)
        if match:
            return match.group(2)  # 返回去掉数字前缀的部分
        return None
    
    def generate_unique_filename(self, base_name: str, target_dir: Path, existing_names: set) -> str:
        """
        生成唯一的文件名，避免冲突
        
        Args:
            base_name: 基础文件名
            target_dir: 目标目录
            existing_names: 已存在的文件名集合
            
        Returns:
            str: 唯一的文件名
        """
        if base_name not in existing_names:
            return base_name
        
        # 分离文件名和扩展名
        name_parts = base_name.rsplit('.', 1)
        if len(name_parts) == 2:
            name, ext = name_parts
        else:
            name, ext = base_name, ""
        
        counter = 2
        while True:
            if ext:
                new_name = f"{name}-{counter}.{ext}"
            else:
                new_name = f"{name}-{counter}"
            
            if new_name not in existing_names:
                return new_name
            counter += 1
    
    def plan_renames(self) -> List[Tuple[Path, str]]:
        """
        规划重命名操作
        
        Returns:
            List[Tuple[Path, str]]: (原文件路径, 新文件名) 的列表
        """
        files = self.scan_files_recursive()
        rename_plans = []
        
        # 按目录分组处理，避免同一目录内的文件名冲突
        dir_files = {}
        for file_path in files:
            parent_dir = file_path.parent
            if parent_dir not in dir_files:
                dir_files[parent_dir] = []
            dir_files[parent_dir].append(file_path)
        
        for parent_dir, dir_file_list in dir_files.items():
            # 收集该目录下现有的所有文件名
            existing_names = set()
            for file_path in dir_file_list:
                existing_names.add(file_path.name)
            
            # 处理该目录下的文件重命名
            for file_path in dir_file_list:
                new_filename = self.extract_new_filename(file_path.name)
                if new_filename:
                    # 生成唯一文件名
                    unique_filename = self.generate_unique_filename(
                        new_filename, parent_dir, existing_names
                    )
                    rename_plans.append((file_path, unique_filename))
                    existing_names.add(unique_filename)
                    logger.info(f"计划重命名: {file_path.name} -> {unique_filename}")
                else:
                    logger.debug(f"跳过不匹配的文件: {file_path.name}")
        
        return rename_plans
    
    def preview_renames(self) -> List[Tuple[Path, str]]:
        """
        预览重命名操作
        
        Returns:
            List[Tuple[Path, str]]: 重命名计划列表
        """
        logger.info("=" * 60)
        logger.info("MGSTAGE系列文件重命名预览")
        logger.info("=" * 60)
        
        rename_plans = self.plan_renames()
        
        if not rename_plans:
            logger.info("没有找到需要重命名的文件")
            return []
        
        logger.info(f"将执行 {len(rename_plans)} 个文件重命名操作:")
        
        # 按目录分组显示
        dir_groups = {}
        for file_path, new_name in rename_plans:
            parent_dir = file_path.parent
            if parent_dir not in dir_groups:
                dir_groups[parent_dir] = []
            dir_groups[parent_dir].append((file_path.name, new_name))
        
        for parent_dir, file_renames in dir_groups.items():
            logger.info(f"\n目录: {parent_dir}")
            for i, (old_name, new_name) in enumerate(file_renames, 1):
                logger.info(f"  {i:2d}. {old_name} -> {new_name}")
        
        return rename_plans
    
    def execute_renames(self, rename_plans: List[Tuple[Path, str]], dry_run: bool = True) -> bool:
        """
        执行重命名操作
        
        Args:
            rename_plans: 重命名计划列表
            dry_run: 是否为干运行模式
            
        Returns:
            bool: 是否成功
        """
        if not rename_plans:
            logger.info("没有需要执行的重命名操作")
            return True
        
        success_count = 0
        error_count = 0
        
        logger.info("=" * 60)
        if dry_run:
            logger.info("干运行模式 - 不会实际重命名文件")
        else:
            logger.info("开始执行文件重命名操作")
        logger.info("=" * 60)
        
        for old_path, new_filename in rename_plans:
            new_path = old_path.parent / new_filename
            
            try:
                if dry_run:
                    logger.info(f"[干运行] {old_path.name} -> {new_filename}")
                    success_count += 1
                else:
                    old_path.rename(new_path)
                    logger.info(f"[成功] {old_path.name} -> {new_filename}")
                    success_count += 1
                    
            except FileExistsError:
                logger.error(f"[失败] 目标文件已存在: {new_filename}")
                error_count += 1
            except PermissionError:
                logger.error(f"[失败] 权限不足，无法重命名: {old_path.name}")
                error_count += 1
            except Exception as e:
                logger.error(f"[失败] 重命名 {old_path.name} 时发生错误: {e}")
                error_count += 1
        
        logger.info("=" * 60)
        logger.info(f"操作完成: 成功 {success_count} 个, 失败 {error_count} 个")
        logger.info("=" * 60)
        
        return error_count == 0


def main():
    """主函数"""
    print("MGSTAGE系列文件重命名工具")
    print("功能：递归重命名所有文件，移除数字前缀")
    print("例如：230ORETD-839.ass -> ORETD-839.ass")
    print("=" * 60)
    
    # 创建重命名器实例
    renamer = MGSTAGEFileRenamer(TARGET_DIR)
    
    # 验证目录
    if not renamer.validate_directory():
        print("目录验证失败，程序退出")
        return
    
    # 预览重命名操作
    rename_plans = renamer.preview_renames()
    
    if not rename_plans:
        print("没有找到需要重命名的文件")
        return
    
    # 用户确认
    print("\n请选择操作:")
    print("1. 执行重命名")
    print("2. 仅预览，不执行")
    print("3. 退出")
    
    while True:
        choice = input("\n请输入选择 (1/2/3): ").strip()
        
        if choice == '1':
            # 执行重命名
            print("\n⚠️  警告：此操作将递归重命名所有匹配的文件！")
            print("确认执行重命名操作吗？此操作不可撤销！")
            confirm = input("输入 'YES' 确认执行: ").strip()
            
            if confirm == 'YES':
                success = renamer.execute_renames(rename_plans, dry_run=False)
                if success:
                    print("\n✅ 所有文件重命名操作已成功完成！")
                else:
                    print("\n❌ 部分文件重命名操作失败，请查看日志了解详情")
            else:
                print("操作已取消")
            break
            
        elif choice == '2':
            # 仅预览
            renamer.execute_renames(rename_plans, dry_run=True)
            break
            
        elif choice == '3':
            print("程序退出")
            break
            
        else:
            print("无效选择，请重新输入")


if __name__ == "__main__":
    main()