#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
下载文件移动脚本
功能：将downloads目录下的字幕文件（包括压缩文件）移动到骑兵字幕目录
规则：
1. 优先移动字幕文件，如不存在则解压ZIP文件
2. 支持密码解压（从同名txt文件读取密码）
3. 提取文件名前缀并移动到对应的首字母分类文件夹
4. 支持特殊前缀提取规则

作者：AI Assistant
创建时间：2024
"""

import os
import shutil
import logging
import re
from pathlib import Path
from typing import List, Tuple, Dict, Optional, Set

# 配置
SOURCE_DIR = r"E:\pythonProject\chrome-extension\dog-catch\subtitlescript\output\downloads"
TARGET_BASE_DIR = r"E:\missav\JAV 外挂字幕包\字幕包-新增\骑兵字幕"
LOG_FILE = "move_downloads_to_cavalry.log"

# 如果您的目录路径不同，请修改上面的路径变量

# 支持的字幕文件格式
SUBTITLE_EXTENSIONS = {'.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx', '.sup'}

# 支持的压缩文件格式
ARCHIVE_EXTENSIONS = {'.zip', '.rar', '.7z'}

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


class SubtitleFileMover:
    """字幕文件移动器"""
    
    def __init__(self, source_dir: str, target_base_dir: str):
        """
        初始化文件移动器
        
        Args:
            source_dir: 源目录路径
            target_base_dir: 目标基础目录路径
        """
        self.source_dir = Path(source_dir)
        self.target_base_dir = Path(target_base_dir)
        self.created_folders = set()  # 缓存已创建的文件夹，避免重复创建
        
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
            # 轻量级权限检查：尝试访问目录属性而不遍历内容
            import os
            
            # 检查源目录读取权限
            if not os.access(self.source_dir, os.R_OK):
                logger.error(f"没有源目录的读取权限: {self.source_dir}")
                return False
                
            # 检查目标目录读写权限
            if not os.access(self.target_base_dir, os.R_OK | os.W_OK):
                logger.error(f"没有目标目录的读写权限: {self.target_base_dir}")
                return False
                
            # 额外检查：尝试在目标目录创建临时文件来验证写入权限
            import tempfile
            try:
                with tempfile.NamedTemporaryFile(dir=self.target_base_dir, delete=True):
                    pass
            except (PermissionError, OSError) as e:
                logger.error(f"目标目录写入权限验证失败: {e}")
                return False
                
            return True
        except PermissionError as e:
            logger.error(f"没有访问目录的权限: {e}")
            return False
        except Exception as e:
            logger.error(f"访问目录时发生错误: {e}")
            return False
    
    def extract_filename_prefix(self, filename: str) -> Optional[str]:
        """
        从文件名中提取前缀（可复用函数）
        
        Args:
            filename: 文件名
            
        Returns:
            Optional[str]: 提取的前缀，如果不符合规则则返回None
        """
        # 移除文件扩展名
        name_without_ext = filename
        for ext in SUBTITLE_EXTENSIONS | ARCHIVE_EXTENSIONS:
            if filename.lower().endswith(ext):
                name_without_ext = filename[:-len(ext)]
                break
        
        # 特殊规则处理
        special_patterns = [
            (r'^1Pondo-', 'Pondo'),           # 1Pondo-010423_001 -> Pondo
            (r'^10mu-', 'mu'),               # 10mu-010523_01 -> mu
            (r'^Paco-', 'Paco'),             # Paco-083022_697 -> Paco
            (r'^Carib-', 'Carib'),           # Carib-090622-001 -> Carib
        ]
        
        for pattern, prefix in special_patterns:
            if re.match(pattern, name_without_ext, re.IGNORECASE):
                logger.debug(f"特殊规则匹配: {filename} -> {prefix}")
                return prefix
        
        # 通用前缀提取规则
        # 匹配如 ADN-712、SDMU-869 等格式
        general_pattern = re.compile(r'^([A-Z]+)(?:-\d+|_\d+)', re.IGNORECASE)
        match = general_pattern.match(name_without_ext)
        
        if match:
            prefix = match.group(1).upper()
            logger.debug(f"通用规则匹配: {filename} -> {prefix}")
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
                    # 只处理字幕文件和压缩文件
                    if any(filename.lower().endswith(ext) for ext in SUBTITLE_EXTENSIONS | ARCHIVE_EXTENSIONS):
                        files.append(file_path)
                    
            logger.info(f"源目录发现 {len(files)} 个相关文件")
            return files
            
        except Exception as e:
            logger.error(f"扫描源目录时发生错误: {e}")
            return []
    
    def find_password_file(self, archive_path: Path) -> Optional[str]:
        """
        查找压缩文件对应的密码文件
        
        Args:
            archive_path: 压缩文件路径
            
        Returns:
            Optional[str]: 密码，如果没有密码文件则返回None
        """
        # 首先尝试同名txt文件
        password_file = archive_path.with_suffix('.txt')
        
        if password_file.exists():
            try:
                with open(password_file, 'r', encoding='utf-8') as f:
                    password = f.read().strip()
                    logger.debug(f"找到同名密码文件: {password_file}")
                    return password
            except Exception as e:
                logger.warning(f"读取密码文件失败: {password_file}, 错误: {e}")
        
        # 如果没有同名txt文件，搜索同目录下所有txt文件
        archive_dir = archive_path.parent
        txt_files = list(archive_dir.glob('*.txt'))
        
        if txt_files:
            logger.debug(f"在目录 {archive_dir} 中找到 {len(txt_files)} 个txt文件")
            
            # 按文件名长度排序，优先尝试较短的文件名（通常是密码文件）
            txt_files.sort(key=lambda x: len(x.name))
            
            for txt_file in txt_files:
                try:
                    with open(txt_file, 'r', encoding='utf-8') as f:
                        content = f.read().strip()
                        # 简单验证：密码文件通常较短且不包含换行
                        if content and len(content) < 100 and '\n' not in content:
                            logger.debug(f"找到潜在密码文件: {txt_file}")
                            return content
                except Exception as e:
                    logger.debug(f"读取txt文件失败: {txt_file}, 错误: {e}")
                    continue
        
        return None
    
    def extract_archive(self, archive_path: Path, extract_to: Path) -> List[Path]:
        """
        使用7-Zip解压压缩文件（支持ZIP和RAR格式）
        
        Args:
            archive_path: 压缩文件路径
            extract_to: 解压目标目录
            
        Returns:
            List[Path]: 解压出的字幕文件列表
        """
        extracted_subtitles = []
        
        # 支持ZIP和RAR格式
        if archive_path.suffix.lower() in ['.zip', '.rar']:
            return self._extract_with_7zip(archive_path, extract_to)
        else:
            logger.warning(f"暂不支持的压缩格式: {archive_path.suffix}")
            return extracted_subtitles
    
    def _extract_with_7zip(self, archive_path: Path, extract_to: Path) -> List[Path]:
        """
        使用7-Zip解压压缩文件
        """
        extracted_subtitles = []
        
        # 检查7-Zip是否可用
        seven_zip_path = self._find_7zip()
        if not seven_zip_path:
            logger.error("未找到7-Zip，无法解压文件。请确保已安装7-Zip")
            return extracted_subtitles
        
        try:
            # 确保解压目录存在
            extract_to.mkdir(parents=True, exist_ok=True)
            
            # 查找密码
            password = self.find_password_file(archive_path)
            
            # 构建7-Zip命令
            cmd = [str(seven_zip_path), 'e', str(archive_path), f'-o{extract_to}', '-y']
            if password:
                cmd.append(f'-p{password}')
            
            # 添加进度提示
            print(f"正在解压: {archive_path.name}...")
            
            # 执行7-Zip命令 - 添加超时机制
            import subprocess
            import locale
            system_encoding = locale.getpreferredencoding()
            
            # 设置30秒超时，避免程序无限等待
            result = subprocess.run(
                cmd, 
                capture_output=True, 
                text=True, 
                encoding=system_encoding,
                timeout=30  # 30秒超时
            )
            
            if result.returncode == 0:
                # 检查解压出的文件
                for file_path in extract_to.iterdir():
                    if file_path.is_file() and any(file_path.name.lower().endswith(ext) for ext in SUBTITLE_EXTENSIONS):
                        extracted_subtitles.append(file_path)
                        logger.info(f"7-Zip解压成功: {file_path.name}")
                        
                if extracted_subtitles:
                    print(f"解压完成: {archive_path.name} ({len(extracted_subtitles)} 个字幕文件)")
                else:
                    print(f"解压完成: {archive_path.name} (未找到字幕文件)")
            else:
                if "Wrong password" in result.stderr or "password" in result.stderr.lower():
                    logger.error(f"解压失败，密码错误: {archive_path}")
                    print(f"解压失败: {archive_path.name} (密码错误)")
                else:
                    logger.error(f"7-Zip解压失败: {result.stderr}")
                    print(f"解压失败: {archive_path.name}")
                
        except subprocess.TimeoutExpired:
            logger.error(f"7-Zip解压超时: {archive_path}")
            print(f"解压超时: {archive_path.name} (超过30秒)")
        except Exception as e:
            logger.error(f"使用7-Zip解压时发生错误: {e}")
            print(f"解压出错: {archive_path.name} - {e}")
        
        return extracted_subtitles
    
    def _find_7zip(self) -> Optional[Path]:
        """
        查找7-Zip可执行文件
        """
        # 常见的7-Zip安装路径
        possible_paths = [
            Path("C:/Program Files/7-Zip/7z.exe"),
            Path("C:/Program Files (x86)/7-Zip/7z.exe"),
        ]
        
        for path in possible_paths:
            if path.exists():
                return path
        
        # 尝试从PATH中查找
        import shutil
        seven_zip = shutil.which('7z')
        if seven_zip:
            return Path(seven_zip)
        
        return None
    
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
        
        # 创建前缀文件夹
        prefix_folder_path = letter_folder_path / prefix_upper
        
        # 检查是否已经创建过这个文件夹
        if prefix_folder_path in self.created_folders:
            return prefix_folder_path
        
        # 创建首字母分类文件夹（如果不存在）
        try:
            letter_folder_path.mkdir(parents=True, exist_ok=True)
            logger.debug(f"确保首字母分类文件夹存在: {letter_folder_path}")
        except Exception as e:
            logger.error(f"创建首字母分类文件夹失败: {letter_folder_path}, 错误: {e}")
            return None
        
        # 创建前缀文件夹（只有在不存在时才创建）
        try:
            if not prefix_folder_path.exists():
                prefix_folder_path.mkdir(parents=True, exist_ok=True)
                logger.info(f"确保前缀文件夹存在: {prefix_folder_path}")
            
            # 添加到缓存
            self.created_folders.add(prefix_folder_path)
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
    
    def process_file(self, file_path: Path) -> List[Tuple[Path, Path, str]]:
        """
        处理单个文件（字幕文件或压缩文件）
        
        Args:
            file_path: 文件路径
            
        Returns:
            List[Tuple[Path, Path, str]]: (源文件路径, 目标文件路径, 前缀) 的列表
        """
        move_plans = []
        filename = file_path.name
        
        # 提取前缀
        prefix = self.extract_filename_prefix(filename)
        if prefix is None:
            logger.debug(f"跳过文件（无法提取前缀）: {filename}")
            return move_plans
        
        # 创建目标文件夹
        target_folder = self.create_target_folder(prefix)
        if target_folder is None:
            logger.warning(f"跳过文件（无法创建目标文件夹）: {filename} (前缀: {prefix})")
            return move_plans
        
        # 检查是否为字幕文件
        if any(filename.lower().endswith(ext) for ext in SUBTITLE_EXTENSIONS):
            # 直接移动字幕文件
            unique_filename = self.get_unique_filename(target_folder, filename)
            target_file_path = target_folder / unique_filename
            move_plans.append((file_path, target_file_path, prefix))
            
        elif any(filename.lower().endswith(ext) for ext in ARCHIVE_EXTENSIONS):
            # 处理压缩文件
            # 检查是否已存在对应的字幕文件
            base_name = file_path.stem.strip()
            subtitle_exists = False
            
            for ext in SUBTITLE_EXTENSIONS:
                potential_subtitle = file_path.parent / f"{base_name}{ext}"
                if potential_subtitle.exists():
                    subtitle_exists = True
                    break
            
            if not subtitle_exists:
                # 解压压缩文件
                temp_extract_dir = file_path.parent / f"temp_extract_{base_name}"
                try:
                    extracted_files = self.extract_archive(file_path, temp_extract_dir)
                    
                    for extracted_file in extracted_files:
                        # 为每个解压出的字幕文件创建移动计划
                        extracted_filename = extracted_file.name
                        unique_filename = self.get_unique_filename(target_folder, extracted_filename)
                        target_file_path = target_folder / unique_filename
                        move_plans.append((extracted_file, target_file_path, prefix))
                    
                    if not extracted_files:
                        logger.warning(f"压缩文件中未找到字幕文件: {filename}")
                        
                except Exception as e:
                    logger.error(f"处理压缩文件失败: {filename}, 错误: {e}")
            else:
                logger.debug(f"跳过压缩文件（已存在对应字幕文件）: {filename}")
        
        return move_plans
    
    def plan_moves(self) -> List[Tuple[Path, Path, str]]:
        """
        规划文件移动操作
        
        Returns:
            List[Tuple[Path, Path, str]]: (源文件路径, 目标文件路径, 前缀) 的列表
        """
        source_files = self.scan_source_files()
        all_move_plans = []
        
        for file_path in source_files:
            file_plans = self.process_file(file_path)
            all_move_plans.extend(file_plans)
        
        return all_move_plans
    
    def preview_moves(self) -> List[Tuple[Path, Path, str]]:
        """
        预览文件移动操作
        
        Returns:
            List[Tuple[Path, Path, str]]: 移动计划列表
        """
        logger.info("=" * 70)
        logger.info("下载文件移动预览")
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
                try:
                    relative_source = source_path.relative_to(self.source_dir)
                except ValueError:
                    # 如果是临时解压的文件，显示原始文件名
                    relative_source = source_path.name
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
        
        # 清理临时解压目录
        if not dry_run:
            self.cleanup_temp_directories()
        
        logger.info("=" * 70)
        logger.info(f"移动操作完成: 成功 {success_count} 个, 失败 {error_count} 个")
        logger.info("=" * 70)
        
        return error_count == 0
    
    def cleanup_temp_directories(self):
        """清理临时解压目录"""
        try:
            for root, dirs, files in os.walk(self.source_dir):
                for dirname in dirs:
                    if dirname.startswith('temp_extract_'):
                        temp_dir = Path(root) / dirname
                        try:
                            shutil.rmtree(temp_dir)
                            logger.debug(f"清理临时目录: {temp_dir}")
                        except Exception as e:
                            logger.warning(f"清理临时目录失败: {temp_dir}, 错误: {e}")
        except Exception as e:
            logger.warning(f"清理临时目录时发生错误: {e}")


def main():
    """主函数"""
    print("下载文件移动工具")
    print("功能：将downloads目录下的字幕文件移动到骑兵字幕对应文件夹")
    print("支持：字幕文件直接移动，压缩文件自动解压")
    print("=" * 70)
    
    # 在开始处清理临时解压文件夹
    print("正在清理临时解压文件夹...")
    try:
        temp_folders_cleaned = 0
        for root, dirs, files in os.walk(SOURCE_DIR):
            for dirname in dirs:
                if dirname.startswith('temp_extract_'):
                    temp_dir = Path(root) / dirname.strip()
                    try:
                        shutil.rmtree(temp_dir)
                        temp_folders_cleaned += 1
                        logger.info(f"清理临时目录: {temp_dir}")
                    except Exception as e:
                        logger.warning(f"清理临时目录失败: {temp_dir}, 错误: {e}")
        print(f"已清理 {temp_folders_cleaned} 个临时解压文件夹")
    except Exception as e:
        logger.warning(f"清理临时目录时发生错误: {e}")
        print("清理临时文件夹时发生错误，请查看日志")
    
    # 创建文件移动器实例
    mover = SubtitleFileMover(SOURCE_DIR, TARGET_BASE_DIR)
    
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
        try:
            # 清空输入缓冲区
            import sys
            if hasattr(sys.stdin, 'flush'):
                sys.stdin.flush()
            
            choice = input("\n请输入选择 (1/2/3): ")
            
            # 强化输入清理
            choice = choice.strip().replace('\r', '').replace('\n', '')
            
            # 调试信息
            print(f"[调试] 接收到的输入: '{choice}' (长度: {len(choice)})")
            
            if choice in ['1', '１']:  # 支持全角数字
                # 执行移动
                print("\n⚠️  警告：此操作将移动文件到目标目录！")
                print("确认执行文件移动操作吗？")
                try:
                    confirm = input("输入 'YES' 确认执行: ").strip()
                except (KeyboardInterrupt, EOFError):
                    print("\n操作被取消")
                    return
                    
                if confirm.upper() == 'YES':
                    success = mover.execute_moves(move_plans, dry_run=False)
                    if success:
                        print("\n✅ 所有文件移动操作已成功完成！")
                    else:
                        print("\n❌ 部分文件移动操作失败，请查看日志了解详情")
                else:
                    print("操作已取消")
                break
                
            elif choice in ['2', '２']:  # 支持全角数字
                # 仅预览
                mover.execute_moves(move_plans, dry_run=True)
                break
                
            elif choice in ['3', '３']:  # 支持全角数字
                print("程序退出")
                break
                
            else:
                print(f"无效选择 '{choice}'，请输入 1、2 或 3")
                
        except (KeyboardInterrupt, EOFError):
            print("\n程序被中断，退出")
            return
        except Exception as e:
            logger.error(f"用户输入处理错误: {e}")
            print(f"输入处理出错: {e}")
            print("请重新输入")


if __name__ == "__main__":
    main()