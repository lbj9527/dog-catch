#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
女优分类文件重命名脚本
功能：递归扫描女优分类目录，将以@开头的文件名重命名为去掉@符号的文件名
规则：@IPX-133岬ななみ.srt -> IPX-133岬ななみ.srt

作者：AI Assistant
创建时间：2024
"""

import os
import logging
from pathlib import Path
from typing import List, Tuple, Optional

# 配置
TARGET_DIR = r"E:\missav\JAV 外挂字幕包\字幕包\女优分类"
LOG_FILE = "rename_actress_files.log"

# 如果您的目录路径不同，请修改上面的TARGET_DIR变量

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


class ActressFileRenamer:
    """女优分类文件重命名器"""
    
    def __init__(self, target_dir: str):
        """
        初始化文件重命名器
        
        Args:
            target_dir: 目标目录路径
        """
        self.target_dir = Path(target_dir)
        
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
        except PermissionError as e:
            logger.error(f"没有访问目录的权限: {e}")
            return False
        except Exception as e:
            logger.error(f"访问目录时发生错误: {e}")
            return False
    
    def scan_files_recursively(self) -> List[Path]:
        """
        递归扫描目录下所有以@开头的文件
        
        Returns:
            List[Path]: 需要重命名的文件列表
        """
        files_to_rename = []
        
        try:
            for root, dirs, files in os.walk(self.target_dir):
                root_path = Path(root)
                
                for filename in files:
                    if filename.startswith('@'):
                        file_path = root_path / filename
                        files_to_rename.append(file_path)
                        
            logger.info(f"发现 {len(files_to_rename)} 个需要重命名的文件")
            return files_to_rename
            
        except Exception as e:
            logger.error(f"扫描文件时发生错误: {e}")
            return []
    
    def generate_new_filename(self, original_path: Path) -> str:
        """
        生成新的文件名（去掉@符号）
        
        Args:
            original_path: 原文件路径
            
        Returns:
            str: 新文件名
        """
        original_name = original_path.name
        if original_name.startswith('@'):
            return original_name[1:]  # 去掉第一个字符@
        return original_name
    
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
    
    def plan_renames(self) -> List[Tuple[Path, Path]]:
        """
        规划重命名操作
        
        Returns:
            List[Tuple[Path, Path]]: (原文件路径, 新文件路径) 的列表
        """
        files_to_rename = self.scan_files_recursively()
        rename_plans = []
        
        for file_path in files_to_rename:
            new_filename = self.generate_new_filename(file_path)
            
            # 检查是否需要处理文件名冲突
            unique_filename = self.get_unique_filename(file_path.parent, new_filename)
            new_file_path = file_path.parent / unique_filename
            
            rename_plans.append((file_path, new_file_path))
        
        return rename_plans
    
    def preview_renames(self) -> List[Tuple[Path, Path]]:
        """
        预览重命名操作
        
        Returns:
            List[Tuple[Path, Path]]: 重命名计划列表
        """
        logger.info("=" * 70)
        logger.info("女优分类文件重命名预览")
        logger.info("=" * 70)
        
        rename_plans = self.plan_renames()
        
        if not rename_plans:
            logger.info("没有找到需要重命名的文件（以@开头的文件）")
            return []
        
        logger.info(f"将执行 {len(rename_plans)} 个文件的重命名操作:")
        
        for i, (old_path, new_path) in enumerate(rename_plans, 1):
            relative_old = old_path.relative_to(self.target_dir)
            relative_new = new_path.relative_to(self.target_dir)
            logger.info(f"{i:3d}. {relative_old} -> {relative_new}")
        
        return rename_plans
    
    def execute_renames(self, rename_plans: List[Tuple[Path, Path]], dry_run: bool = True) -> bool:
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
        
        logger.info("=" * 70)
        if dry_run:
            logger.info("干运行模式 - 不会实际重命名文件")
        else:
            logger.info("开始执行文件重命名操作")
        logger.info("=" * 70)
        
        for old_path, new_path in rename_plans:
            try:
                if dry_run:
                    logger.info(f"[干运行] 重命名: {old_path.name} -> {new_path.name}")
                    success_count += 1
                else:
                    old_path.rename(new_path)
                    logger.info(f"[成功] 重命名: {old_path.name} -> {new_path.name}")
                    success_count += 1
                    
            except FileExistsError:
                logger.error(f"[失败] 目标文件已存在: {new_path}")
                error_count += 1
            except PermissionError:
                logger.error(f"[失败] 没有权限重命名文件: {old_path}")
                error_count += 1
            except Exception as e:
                logger.error(f"[失败] 重命名文件 {old_path.name} 时发生错误: {e}")
                error_count += 1
        
        logger.info("=" * 70)
        logger.info(f"重命名操作完成: 成功 {success_count} 个, 失败 {error_count} 个")
        logger.info("=" * 70)
        
        return error_count == 0


def main():
    """主函数"""
    print("女优分类文件重命名工具")
    print("功能：递归重命名以@开头的文件，去掉@符号")
    print("=" * 70)
    
    # 创建重命名器实例
    renamer = ActressFileRenamer(TARGET_DIR)
    
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
            print("\n⚠️  警告：此操作将重命名文件！")
            print("确认执行重命名操作吗？")
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