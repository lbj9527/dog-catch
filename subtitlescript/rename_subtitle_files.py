#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
字幕文件重命名脚本
将原始文件名按照解析规则转换为规范化的视频ID格式

使用方法:
python rename_subtitle_files.py <目录路径> [--dry-run]

参数:
- 目录路径: 要处理的目录，会递归处理所有子目录
- --dry-run: 仅显示重命名预览，不实际执行重命名操作
"""

import os
import re
import sys
import argparse
from pathlib import Path


def extract_video_id(filename):
    """
    从文件名中提取并规范化视频ID
    基于前端BatchUploadDialog.vue中的extractVideoId函数逻辑
    """
    # 去除扩展名
    base = re.sub(r'\.[^/.]+$', '', filename)
    
    # 特殊格式处理 - 按照前端逻辑顺序
    
    # 1. (1pondo)(061016_314)コスプレイヤーをお貸しします 川越ゆい -> PONDO-061016_314
    m = re.search(r'\(1pondo\)\((\d{6}_\d{3})\)', base, re.IGNORECASE)
    if m:
        return f"PONDO-{m.group(1)}"
    
    # 2. 1Pondo-030615_039 秋野千尋 -> PONDO-030615_039
    m = re.search(r'1Pondo-(\d{6}_\d{3})', base, re.IGNORECASE)
    if m:
        return f"PONDO-{m.group(1)}"
    
    # 3. 022720_979-1pon -> PON-022720_979
    m = re.search(r'(\d{6}_\d{3})-1pon', base, re.IGNORECASE)
    if m:
        return f"PON-{m.group(1)}"
    
    # 4. 040816_276-1pon-1080p -> PON-040816_276 (与规则3相同，保留以确保完整性)
    # 已在规则3中处理
    
    # 5. 050420_01-10mu-1080p -> MU-050420_01
    m = re.search(r'(\d{6}_\d{2})-10mu', base, re.IGNORECASE)
    if m:
        return f"MU-{m.group(1)}"
    
    # 6. 051620_01-10mu -> MU-051620_01 (与规则5相同，保留以确保完整性)
    # 已在规则5中处理
    
    # 7. 080616-225-carib-1080p -> CARIB-080616_225
    m = re.search(r'(\d{6})-(\d{3})-carib', base, re.IGNORECASE)
    if m:
        return f"CARIB-{m.group(1)}_{m.group(2)}"
    
    # 8. 081520_344-paco-1080p -> PACO-081520_344
    m = re.search(r'(\d{6}_\d{3})-paco', base, re.IGNORECASE)
    if m:
        return f"PACO-{m.group(1)}"
    
    # 9. 112615_431-caribpr-high -> CARIBPR-112615_431
    m = re.search(r'(\d{6}_\d{3})-caribpr', base, re.IGNORECASE)
    if m:
        return f"CARIBPR-{m.group(1)}"
    
    # 10. n0310 -> N0310
    m = re.match(r'^n(\d{4})$', base, re.IGNORECASE)
    if m:
        return f"N{m.group(1)}"
    
    # 11. N0417 -> N0417 (已经是正确格式)
    m = re.match(r'^N(\d{4})$', base, re.IGNORECASE)
    if m:
        return f"N{m.group(1)}"
    
    # 12. Tokyo-Hot-n1004 -> N1004
    m = re.search(r'Tokyo-Hot-n(\d{4})', base, re.IGNORECASE)
    if m:
        return f"N{m.group(1)}"
    
    # 13. Tokyo-Hot_k1179餌食牝_美咲結衣 -> K1179
    m = re.search(r'Tokyo-Hot[_-]k(\d{4})', base, re.IGNORECASE)
    if m:
        return f"K{m.group(1)}"
    
    # 14. 010210-259 -> 010210-259 (保持原格式)
    m = re.match(r'^(\d{6}-\d{3})', base)
    if m:
        return m.group(1)
    
    # 15. 012415_01 -> 012415-01 (下划线转连字符)
    m = re.match(r'^(\d{6})_(\d{2})$', base)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    
    # 16. 080416_353 -> 080416-353 (下划线转连字符，3位数字)
    m = re.match(r'^(\d{6})_(\d{3})$', base)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    
    # 17. 050717_524 - chs -> 050717-524 (带语言后缀)
    m = re.match(r'^(\d{6})_(\d{2,3})\s*-?\s*(chs|cht)$', base, re.IGNORECASE)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    
    # 18. 050717_524cht -> 050717-524 (直接连接语言后缀)
    m = re.match(r'^(\d{6})_(\d{2,3})(chs|cht)$', base, re.IGNORECASE)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    
    # 19. 072415_928-carib-CHS -> CARIB-072415_928 (carib格式带语言后缀)
    m = re.match(r'^(\d{6})_(\d{3})-carib-(chs|cht)$', base, re.IGNORECASE)
    if m:
        return f"CARIB-{m.group(1)}_{m.group(2)}"
    
    # 20. 080416_353 今夏來海灘超嗨亂交！ 真琴涼 希咲彩 蒼井櫻 -> 080416-353 (带中文描述)
    m = re.match(r'^(\d{6})_(\d{2,3})\s+[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+', base)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    
    # 21. 100516_398  -> 100516-398 (带空格)
    m = re.match(r'^(\d{6})_(\d{2,3})\s*$', base)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    
    # 22. 1pondo – 061014_824 – Nami Itoshino -> PONDO-061014_824 (带破折号和描述)
    m = re.search(r'1pondo\s*[–-]\s*(\d{6}_\d{3})', base, re.IGNORECASE)
    if m:
        return f"PONDO-{m.group(1)}"
    
    # 23. 1Pondo_081418_728 -> PONDO-081418_728 (下划线连接)
    m = re.match(r'^1Pondo_(\d{6}_\d{3})', base, re.IGNORECASE)
    if m:
        return f"PONDO-{m.group(1)}"
    
    # 新增规则：处理Carib格式
    # 24. Carib-070417-455 朝桐光 -> CARIB-070417_455
    m = re.search(r'Carib-(\d{6})-(\d{3})', base, re.IGNORECASE)
    if m:
        return f"CARIB-{m.group(1)}_{m.group(2)}"
    
    # 25. Caribbean 120614-753 -> CARIB-120614_753
    m = re.search(r'Caribbean\s+(\d{6})-(\d{3})', base, re.IGNORECASE)
    if m:
        return f"CARIB-{m.group(1)}_{m.group(2)}"
    
    # 新增：FC2PPV 特殊处理
    # A. FC2PPV-880231_1 -> FC2-PPV-880231(1)
    m = re.search(r'fc2\s*ppv[-_](\d+)_(\d{1,3})$', base, re.IGNORECASE)
    if m:
        return f"FC2-PPV-{m.group(1)}({m.group(2)})"
    
    # B. fc2-ppv-2712268 / FC2PPV-2712268 -> FC2-PPV-2712268
    m = re.search(r'fc2[-_]?ppv[-_](\d+)$', base, re.IGNORECASE)
    if m:
        return f"FC2-PPV-{m.group(1)}"
    
    # 26. 处理下划线格式，如 NIMA_027 -> NIMA-027
    m = re.search(r'([a-z]+)_(\d{2,5})', base, re.IGNORECASE)
    if m:
        return f"{m.group(1)}-{m.group(2)}".upper()
    
    # 27. MKD特例处理：MKD-S238 來海灘超嗨 -> MKD-S238
    m = re.search(r'(MKD-S\d+)', base, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    
    # 通用格式处理 (改进：保留可选的单字母后缀以减少碰撞)
    
    # 28. 优先：已有连字符，如 JUL-721，支持紧随其后的单字母后缀，如 BBI-142A
    m = re.search(r'([a-z]+)-(\d{2,5})([a-z])?', base, re.IGNORECASE)
    if m:
        prefix, num, suf = m.group(1), m.group(2), m.group(3)
        # 若未匹配到紧随其后的后缀，尝试从文件名末尾或括号前提取单字母后缀（排除 CHS/CHT）
        if not suf:
            base_upper = base.upper()
            if not (base_upper.endswith('CHS') or base_upper.endswith('CHT')):
                end_suf = re.search(r'([A-Z])$', base_upper)
                if end_suf:
                    suf = end_suf.group(1)
                else:
                    # 兼容如 "BBI-142 桜木凛A(副本)" 的后缀形式，提取括号前的单字母
                    bracket_suf = re.search(r'([A-Z])(?=[\(（])', base_upper)
                    if bracket_suf:
                        suf = bracket_suf.group(1)
        # 新增：将数字段统一补齐为三位（如 NUKA-30 -> NUKA-030，NUKA-3 -> NUKA-003）
        num_padded = num.zfill(3) if num.isdigit() and len(num) < 3 else num
        return f"{prefix}-{num_padded}{suf or ''}".upper()
    
    # 29. 其次：无连字符的字母+数字，如 NAKA008 -> NAKA-008，支持紧随其后的单字母后缀，如 NAKA008B
    m = re.search(r'([a-z]+)(\d{2,5})([a-z])?', base, re.IGNORECASE)
    if m:
        letters, num, suf = m.group(1), m.group(2), m.group(3) or ''
        # 新增：将数字段统一补齐为三位
        num_padded = num.zfill(3) if num.isdigit() and len(num) < 3 else num
        return f"{letters}-{num_padded}{suf}".upper()
    
    # 30. 字母+空格+数字，如 ABP 744 -> ABP-744，支持紧随其后的单字母后缀，如 ABP 744B
    m = re.search(r'([a-z]+)\s+(\d{2,5})([a-z])?', base, re.IGNORECASE)
    if m:
        letters, num, suf = m.group(1), m.group(2), m.group(3) or ''
        # 新增：将数字段统一补齐为三位
        num_padded = num.zfill(3) if num.isdigit() and len(num) < 3 else num
        return f"{letters}-{num_padded}{suf}".upper()
    
    return None


def is_subtitle_file(filename):
    """检查是否为字幕文件"""
    subtitle_extensions = {'.srt', '.vtt', '.ass', '.ssa'}
    return Path(filename).suffix.lower() in subtitle_extensions


def rename_files_in_directory(directory, dry_run=False):
    """
    递归处理目录中的所有字幕文件
    
    Args:
        directory: 要处理的目录路径
        dry_run: 是否为预览模式（不实际重命名）
    
    Returns:
        tuple: (成功数量, 失败数量, 跳过数量)
    """
    directory = Path(directory)
    if not directory.exists():
        print(f"错误: 目录不存在: {directory}")
        return 0, 0, 0
    
    success_count = 0
    failed_count = 0
    skipped_count = 0
    
    print(f"{'[预览模式] ' if dry_run else ''}开始处理目录: {directory}")
    print("-" * 80)
    
    # 新增：按目录维护本批次将要生成的目标文件名集合，确保 dry-run 与真实执行一致的去重效果
    dir_used_names = {}
    
    # 递归遍历所有文件
    for file_path in directory.rglob('*'):
        if not file_path.is_file():
            continue
            
        if not is_subtitle_file(file_path.name):
            continue
        
        # 提取视频ID
        video_id = extract_video_id(file_path.name)
        
        if video_id is None:
            print(f"跳过 (无法解析): {file_path.relative_to(directory)}")
            skipped_count += 1
            continue
        
        # 准备当前目录的已占用名称集合（包含磁盘已有文件 + 本批次将要生成的文件名）
        parent_dir = file_path.parent
        if parent_dir not in dir_used_names:
            try:
                existing_names = {p.name for p in parent_dir.iterdir() if p.is_file()}
            except Exception:
                existing_names = set()
            dir_used_names[parent_dir] = set(existing_names)
        used_set = dir_used_names[parent_dir]
        
        # 构建新文件名（保留原文件名末尾的(数字)复制后缀，如 (2)）
        base_no_ext = re.sub(r'\.[^/.]+$', '', file_path.name)
        copy_suffix_match = re.search(r'\((\d{1,3})\)$', base_no_ext)
        copy_suffix = f"({copy_suffix_match.group(1)})" if copy_suffix_match else ""
        new_filename = f"{video_id}{copy_suffix}{file_path.suffix}"
        new_file_path = file_path.parent / new_filename
        
        # 检查是否需要重命名
        if file_path.name == new_filename:
            print(f"跳过 (已是正确格式): {file_path.relative_to(directory)}")
            skipped_count += 1
            # 已存在于 existing_names 中，无需再加入 used_set
            continue
        
        # 检查目标文件是否已存在，或本批次已占用；若冲突则添加序号
        if (new_file_path.exists() and new_file_path != file_path) or (new_filename in used_set):
            counter = 2
            base_name = f"{video_id}{copy_suffix}"
            extension = file_path.suffix
            found_unique = False
            
            while counter <= 999:
                numbered_filename = f"{base_name}({counter}){extension}"
                numbered_file_path = file_path.parent / numbered_filename
                
                if (not numbered_file_path.exists()) and (numbered_filename not in used_set):
                    new_filename = numbered_filename
                    new_file_path = numbered_file_path
                    found_unique = True
                    break
                
                counter += 1
            
            # 如果无法生成唯一文件名，跳过此文件
            if not found_unique:
                print(f"失败 (无法生成唯一文件名): {file_path.relative_to(directory)} -> {video_id}(N){extension}")
                failed_count += 1
                continue
        
        # 记录占用，确保 dry-run 与真实执行都进行批次内去重
        used_set.add(new_filename)
        
        print(f"{'预览' if dry_run else '重命名'}: {file_path.relative_to(directory)} -> {new_filename}")
        
        if not dry_run:
            try:
                file_path.rename(new_file_path)
                success_count += 1
            except Exception as e:
                print(f"失败 (重命名错误): {file_path.relative_to(directory)} -> {new_filename}")
                print(f"  错误信息: {e}")
                failed_count += 1
        else:
            success_count += 1
    
    print("-" * 80)
    print(f"处理完成: 成功 {success_count}, 失败 {failed_count}, 跳过 {skipped_count}")
    
    return success_count, failed_count, skipped_count


def main():
    parser = argparse.ArgumentParser(
        description='字幕文件重命名脚本 - 将文件名规范化为标准视频ID格式',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例用法:
  python rename_subtitle_files.py /path/to/subtitles
  python rename_subtitle_files.py /path/to/subtitles --dry-run
  
支持的文件格式: .srt, .vtt, .ass, .ssa

解析规则示例:
  121616-326-carib-1080p.srt -> CARIB-121616_326.srt
  1Pondo-030615_039.srt -> PONDO-030615_039.srt
  JUL-721.srt -> JUL-721.srt (保持不变)
  NAKA008.srt -> NAKA-008.srt
        """
    )
    
    parser.add_argument('directory', help='要处理的目录路径')
    parser.add_argument('--dry-run', action='store_true', 
                       help='预览模式，只显示重命名计划而不实际执行')
    
    args = parser.parse_args()
    
    # 验证目录
    directory = Path(args.directory)
    if not directory.exists():
        print(f"错误: 目录不存在: {directory}")
        sys.exit(1)
    
    if not directory.is_dir():
        print(f"错误: 路径不是目录: {directory}")
        sys.exit(1)
    
    # 执行重命名
    success, failed, skipped = rename_files_in_directory(directory, args.dry_run)
    
    if args.dry_run:
        print(f"\n预览完成。如需实际执行，请去掉 --dry-run 参数重新运行。")
    else:
        print(f"\n重命名操作完成。")
    
    # 根据结果设置退出码
    if failed > 0:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == '__main__':
    main()