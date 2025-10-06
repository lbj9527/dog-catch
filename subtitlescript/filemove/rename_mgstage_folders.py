#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MGSTAGE文件夹重命名脚本
功能：将MGSTAGE目录下的文件夹从"数字+字母"格式重命名为"字母"格式
例如：107SYBI -> SYBI

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
LOG_FILE = "rename_mgstage_folders.log"

# 如果您的目录路径不同，请修改上面的 TARGET_DIR 变量
# 例如：TARGET_DIR = r"C:\您的实际路径\MGSTAGE"

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


class MGSTAGEFolderRenamer:
    """MGSTAGE文件夹重命名器"""
    
    def __init__(self, target_directory: str):
        """
        初始化重命名器
        
        Args:
            target_directory: 目标目录路径
        """
        self.target_dir = Path(target_directory)
        self.rename_pattern = re.compile(r'^(\d+)([A-Z]+)$')
        
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
    
    def scan_folders(self) -> List[Path]:
        """
        扫描目标目录下的一级子目录
        
        Returns:
            List[Path]: 子目录列表
        """
        try:
            folders = [
                item for item in self.target_dir.iterdir() 
                if item.is_dir()
            ]
            logger.info(f"发现 {len(folders)} 个子目录")
            return folders
        except Exception as e:
            logger.error(f"扫描目录时发生错误: {e}")
            return []
    
    def extract_new_name(self, folder_name: str) -> Optional[str]:
        """
        从文件夹名提取新名称
        
        Args:
            folder_name: 原文件夹名
            
        Returns:
            Optional[str]: 新名称，如果不匹配模式则返回None
        """
        match = self.rename_pattern.match(folder_name)
        if match:
            return match.group(2)  # 返回字母部分
        return None
    
    def generate_unique_name(self, base_name: str, existing_names: set) -> str:
        """
        生成唯一的文件夹名称，避免冲突
        
        Args:
            base_name: 基础名称
            existing_names: 已存在的名称集合
            
        Returns:
            str: 唯一的名称
        """
        if base_name not in existing_names:
            return base_name
        
        counter = 2
        while f"{base_name}-{counter}" in existing_names:
            counter += 1
        
        return f"{base_name}-{counter}"
    
    def plan_renames(self) -> List[Tuple[Path, str]]:
        """
        规划重命名操作
        
        Returns:
            List[Tuple[Path, str]]: (原路径, 新名称) 的列表
        """
        folders = self.scan_folders()
        rename_plans = []
        existing_names = set()
        
        # 首先收集所有现有的文件夹名
        for folder in folders:
            existing_names.add(folder.name)
        
        for folder in folders:
            new_name = self.extract_new_name(folder.name)
            if new_name:
                # 生成唯一名称
                unique_name = self.generate_unique_name(new_name, existing_names)
                rename_plans.append((folder, unique_name))
                existing_names.add(unique_name)
                logger.info(f"计划重命名: {folder.name} -> {unique_name}")
            else:
                logger.debug(f"跳过不匹配的文件夹: {folder.name}")
        
        return rename_plans
    
    def preview_renames(self) -> List[Tuple[Path, str]]:
        """
        预览重命名操作
        
        Returns:
            List[Tuple[Path, str]]: 重命名计划列表
        """
        logger.info("=" * 50)
        logger.info("重命名预览")
        logger.info("=" * 50)
        
        rename_plans = self.plan_renames()
        
        if not rename_plans:
            logger.info("没有找到需要重命名的文件夹")
            return []
        
        logger.info(f"将执行 {len(rename_plans)} 个重命名操作:")
        for i, (old_path, new_name) in enumerate(rename_plans, 1):
            logger.info(f"{i:2d}. {old_path.name} -> {new_name}")
        
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
        
        logger.info("=" * 50)
        if dry_run:
            logger.info("干运行模式 - 不会实际重命名文件夹")
        else:
            logger.info("开始执行重命名操作")
        logger.info("=" * 50)
        
        for old_path, new_name in rename_plans:
            new_path = old_path.parent / new_name
            
            try:
                if dry_run:
                    logger.info(f"[干运行] {old_path.name} -> {new_name}")
                    success_count += 1
                else:
                    old_path.rename(new_path)
                    logger.info(f"[成功] {old_path.name} -> {new_name}")
                    success_count += 1
                    
            except FileExistsError:
                logger.error(f"[失败] 目标文件夹已存在: {new_name}")
                error_count += 1
            except PermissionError:
                logger.error(f"[失败] 权限不足，无法重命名: {old_path.name}")
                error_count += 1
            except Exception as e:
                logger.error(f"[失败] 重命名 {old_path.name} 时发生错误: {e}")
                error_count += 1
        
        logger.info("=" * 50)
        logger.info(f"操作完成: 成功 {success_count} 个, 失败 {error_count} 个")
        logger.info("=" * 50)
        
        return error_count == 0


def main():
    """主函数"""
    print("MGSTAGE文件夹重命名工具")
    print("=" * 50)
    
    # 创建重命名器实例
    renamer = MGSTAGEFolderRenamer(TARGET_DIR)
    
    # 验证目录
    if not renamer.validate_directory():
        print("目录验证失败，程序退出")
        return
    
    # 预览重命名操作
    rename_plans = renamer.preview_renames()
    
    if not rename_plans:
        print("没有找到需要重命名的文件夹")
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
            print("\n确认执行重命名操作吗？此操作不可撤销！")
            confirm = input("输入 'YES' 确认执行: ").strip()
            
            if confirm == 'YES':
                success = renamer.execute_renames(rename_plans, dry_run=False)
                if success:
                    print("\n所有重命名操作已成功完成！")
                else:
                    print("\n部分重命名操作失败，请查看日志了解详情")
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