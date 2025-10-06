#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MGSTAGE系列文件组织脚本
功能：将MGSTAGE系列目录下的文件按照骑兵字幕目录的组织形式复制到对应位置
规则：
1. 完全匹配：如果目标目录下存在同名文件夹，直接复制文件到同名文件夹
2. 首字母匹配：如果不存在同名文件夹，根据首字母在对应的字母开头文件夹下创建新文件夹

作者：AI Assistant
创建时间：2024
"""

import os
import shutil
import logging
from pathlib import Path
from typing import List, Tuple, Dict, Optional

# 配置
SOURCE_DIR = r"E:\missav\JAV 外挂字幕包\字幕包\知名厂商\MGSTAGE系列"
TARGET_BASE_DIR = r"E:\missav\JAV 外挂字幕包\字幕包\骑兵字幕"
LOG_FILE = "organize_mgstage_files.log"

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


class MGSTAGEFileOrganizer:
    """MGSTAGE系列文件组织器"""
    
    def __init__(self, source_dir: str, target_base_dir: str):
        """
        初始化文件组织器
        
        Args:
            source_dir: 源目录路径（MGSTAGE系列）
            target_base_dir: 目标基础目录路径（骑兵字幕）
        """
        self.source_dir = Path(source_dir)
        self.target_base_dir = Path(target_base_dir)
        
        # 字母开头文件夹映射
        self.letter_folders = {
            'A': 'A开头', 'B': 'B开头', 'C': 'C开头', 'D': 'D开头', 'E': 'E开头',
            'F': 'F开头', 'G': 'G开头', 'H': 'H开头', 'I': 'I开头', 'J': 'J开头',
            'K': 'K开头', 'L': 'L开头', 'M': 'M开头', 'N': 'N开头', 'O': 'O开头',
            'P': 'P开头', 'Q': 'Q开头', 'R': 'R开头', 'S': 'S开头', 'T': 'T开头',
            'U': 'U开头', 'V': 'V开头', 'W': 'W开头', 'X': 'X开头', 'Y': 'Y开头',
            'Z': 'Z开头'
        }
        
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
    
    def scan_source_folders(self) -> List[Path]:
        """
        扫描源目录下的所有一级子文件夹
        
        Returns:
            List[Path]: 源文件夹列表
        """
        try:
            folders = [
                item for item in self.source_dir.iterdir() 
                if item.is_dir()
            ]
            logger.info(f"源目录发现 {len(folders)} 个文件夹")
            return folders
        except Exception as e:
            logger.error(f"扫描源目录时发生错误: {e}")
            return []
    
    def scan_target_structure(self) -> Dict[str, Dict[str, Path]]:
        """
        扫描目标目录结构，建立字母开头文件夹和其子文件夹的映射
        
        Returns:
            Dict[str, Dict[str, Path]]: {字母开头文件夹: {子文件夹名: 路径}}
        """
        target_structure = {}
        
        try:
            for letter_folder_name in self.letter_folders.values():
                letter_folder_path = self.target_base_dir / letter_folder_name
                target_structure[letter_folder_name] = {}
                
                if letter_folder_path.exists() and letter_folder_path.is_dir():
                    for subfolder in letter_folder_path.iterdir():
                        if subfolder.is_dir():
                            target_structure[letter_folder_name][subfolder.name] = subfolder
                    
                    logger.debug(f"扫描 {letter_folder_name}: 发现 {len(target_structure[letter_folder_name])} 个子文件夹")
                else:
                    logger.warning(f"字母开头文件夹不存在: {letter_folder_path}")
            
            total_subfolders = sum(len(subfolders) for subfolders in target_structure.values())
            logger.info(f"目标目录结构扫描完成，共发现 {total_subfolders} 个子文件夹")
            return target_structure
            
        except Exception as e:
            logger.error(f"扫描目标目录结构时发生错误: {e}")
            return {}
    
    def find_target_folder(self, source_folder_name: str, target_structure: Dict[str, Dict[str, Path]]) -> Tuple[Optional[Path], bool]:
        """
        查找目标文件夹位置
        
        Args:
            source_folder_name: 源文件夹名
            target_structure: 目标目录结构
            
        Returns:
            Tuple[Optional[Path], bool]: (目标路径, 是否需要创建新文件夹)
        """
        # 1. 首先尝试完全匹配
        for letter_folder_name, subfolders in target_structure.items():
            if source_folder_name in subfolders:
                logger.info(f"找到完全匹配: {source_folder_name} -> {subfolders[source_folder_name]}")
                return subfolders[source_folder_name], False
        
        # 2. 如果没有完全匹配，根据首字母确定位置
        first_letter = source_folder_name[0].upper()
        if first_letter in self.letter_folders:
            letter_folder_name = self.letter_folders[first_letter]
            letter_folder_path = self.target_base_dir / letter_folder_name
            
            # 确保字母开头文件夹存在
            if not letter_folder_path.exists():
                logger.warning(f"字母开头文件夹不存在，将创建: {letter_folder_path}")
                letter_folder_path.mkdir(parents=True, exist_ok=True)
            
            target_folder_path = letter_folder_path / source_folder_name
            logger.info(f"首字母匹配: {source_folder_name} -> {target_folder_path} (需要创建)")
            return target_folder_path, True
        else:
            logger.warning(f"无法确定文件夹 {source_folder_name} 的目标位置（首字母不是字母）")
            return None, False
    
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
    
    def copy_files_from_folder(self, source_folder: Path, target_folder: Path, dry_run: bool = True) -> Tuple[int, int]:
        """
        复制文件夹中的所有文件到目标文件夹
        
        Args:
            source_folder: 源文件夹
            target_folder: 目标文件夹
            dry_run: 是否为干运行模式
            
        Returns:
            Tuple[int, int]: (成功数量, 失败数量)
        """
        success_count = 0
        error_count = 0
        
        try:
            # 确保目标文件夹存在
            if not dry_run:
                target_folder.mkdir(parents=True, exist_ok=True)
            
            # 递归复制所有文件
            for root, dirs, files in os.walk(source_folder):
                root_path = Path(root)
                relative_path = root_path.relative_to(source_folder)
                
                for filename in files:
                    source_file = root_path / filename
                    target_subdir = target_folder / relative_path
                    
                    # 生成唯一文件名
                    unique_filename = self.get_unique_filename(target_subdir, filename)
                    target_file = target_subdir / unique_filename
                    
                    try:
                        if dry_run:
                            logger.info(f"[干运行] 复制: {source_file} -> {target_file}")
                            success_count += 1
                        else:
                            # 确保目标子目录存在
                            target_subdir.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(source_file, target_file)
                            logger.info(f"[成功] 复制: {source_file.name} -> {target_file}")
                            success_count += 1
                            
                    except Exception as e:
                        logger.error(f"[失败] 复制文件 {source_file} 时发生错误: {e}")
                        error_count += 1
                        
        except Exception as e:
            logger.error(f"处理文件夹 {source_folder} 时发生错误: {e}")
            error_count += 1
            
        return success_count, error_count
    
    def plan_organization(self) -> List[Tuple[Path, Path, bool]]:
        """
        规划文件组织操作
        
        Returns:
            List[Tuple[Path, Path, bool]]: (源文件夹, 目标文件夹, 是否需要创建) 的列表
        """
        source_folders = self.scan_source_folders()
        target_structure = self.scan_target_structure()
        organization_plans = []
        
        for source_folder in source_folders:
            target_folder, need_create = self.find_target_folder(source_folder.name, target_structure)
            
            if target_folder:
                organization_plans.append((source_folder, target_folder, need_create))
            else:
                logger.warning(f"跳过无法确定目标位置的文件夹: {source_folder.name}")
        
        return organization_plans
    
    def preview_organization(self) -> List[Tuple[Path, Path, bool]]:
        """
        预览文件组织操作
        
        Returns:
            List[Tuple[Path, Path, bool]]: 组织计划列表
        """
        logger.info("=" * 70)
        logger.info("MGSTAGE系列文件组织预览")
        logger.info("=" * 70)
        
        organization_plans = self.plan_organization()
        
        if not organization_plans:
            logger.info("没有找到需要组织的文件夹")
            return []
        
        logger.info(f"将执行 {len(organization_plans)} 个文件夹的组织操作:")
        
        for i, (source_folder, target_folder, need_create) in enumerate(organization_plans, 1):
            status = "创建新文件夹" if need_create else "使用现有文件夹"
            logger.info(f"{i:2d}. {source_folder.name} -> {target_folder} ({status})")
        
        return organization_plans
    
    def execute_organization(self, organization_plans: List[Tuple[Path, Path, bool]], dry_run: bool = True) -> bool:
        """
        执行文件组织操作
        
        Args:
            organization_plans: 组织计划列表
            dry_run: 是否为干运行模式
            
        Returns:
            bool: 是否成功
        """
        if not organization_plans:
            logger.info("没有需要执行的组织操作")
            return True
        
        total_success = 0
        total_error = 0
        
        logger.info("=" * 70)
        if dry_run:
            logger.info("干运行模式 - 不会实际复制文件")
        else:
            logger.info("开始执行文件组织操作")
        logger.info("=" * 70)
        
        for source_folder, target_folder, need_create in organization_plans:
            logger.info(f"\n处理文件夹: {source_folder.name}")
            
            if need_create and not dry_run:
                logger.info(f"创建目标文件夹: {target_folder}")
            
            success_count, error_count = self.copy_files_from_folder(
                source_folder, target_folder, dry_run
            )
            
            total_success += success_count
            total_error += error_count
            
            logger.info(f"文件夹 {source_folder.name} 处理完成: 成功 {success_count} 个, 失败 {error_count} 个")
        
        logger.info("=" * 70)
        logger.info(f"总计操作完成: 成功 {total_success} 个文件, 失败 {total_error} 个文件")
        logger.info("=" * 70)
        
        return total_error == 0


def main():
    """主函数"""
    print("MGSTAGE系列文件组织工具")
    print("功能：按照骑兵字幕目录结构组织MGSTAGE系列文件")
    print("=" * 70)
    
    # 创建文件组织器实例
    organizer = MGSTAGEFileOrganizer(SOURCE_DIR, TARGET_BASE_DIR)
    
    # 验证目录
    if not organizer.validate_directories():
        print("目录验证失败，程序退出")
        return
    
    # 预览组织操作
    organization_plans = organizer.preview_organization()
    
    if not organization_plans:
        print("没有找到需要组织的文件夹")
        return
    
    # 用户确认
    print("\n请选择操作:")
    print("1. 执行文件组织")
    print("2. 仅预览，不执行")
    print("3. 退出")
    
    while True:
        choice = input("\n请输入选择 (1/2/3): ").strip()
        
        if choice == '1':
            # 执行组织
            print("\n⚠️  警告：此操作将复制大量文件到目标目录！")
            print("确认执行文件组织操作吗？")
            confirm = input("输入 'YES' 确认执行: ").strip()
            
            if confirm == 'YES':
                success = organizer.execute_organization(organization_plans, dry_run=False)
                if success:
                    print("\n✅ 所有文件组织操作已成功完成！")
                else:
                    print("\n❌ 部分文件组织操作失败，请查看日志了解详情")
            else:
                print("操作已取消")
            break
            
        elif choice == '2':
            # 仅预览
            organizer.execute_organization(organization_plans, dry_run=True)
            break
            
        elif choice == '3':
            print("程序退出")
            break
            
        else:
            print("无效选择，请重新输入")


if __name__ == "__main__":
    main()