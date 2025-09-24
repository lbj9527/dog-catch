"""
CSV数据处理工具模块
用于读取演员CSV文件，筛选特定类型视频，并提取视频编号
"""

import re
import pandas as pd
from typing import List, Optional
from collections import OrderedDict


def load_actor_csv(csv_path: str) -> pd.DataFrame:
    """
    加载演员CSV文件
    
    Args:
        csv_path: CSV文件路径
        
    Returns:
        pandas.DataFrame: 加载的数据框
        
    Raises:
        FileNotFoundError: 文件不存在
        ValueError: 缺少必需列
    """
    try:
        # 尝试不同编码读取CSV
        for encoding in ['utf-8', 'utf-8-sig', 'gbk']:
            try:
                df = pd.read_csv(csv_path, encoding=encoding)
                print(f"✅ 成功读取CSV文件: {csv_path} (编码: {encoding})")
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError(f"无法使用常见编码读取CSV文件: {csv_path}")
        
        # 校验必需列
        required_columns = ['video_type', 'video_title']
        missing_columns = [col for col in required_columns if col not in df.columns]
        
        if missing_columns:
            raise ValueError(f"CSV文件缺少必需列: {missing_columns}，现有列: {list(df.columns)}")
        
        print(f"📊 CSV数据概览: 共 {len(df)} 行，列: {list(df.columns)}")
        return df
        
    except FileNotFoundError:
        raise FileNotFoundError(f"CSV文件不存在: {csv_path}")
    except Exception as e:
        raise ValueError(f"读取CSV文件失败: {e}")


def filter_by_type(df: pd.DataFrame, video_type: Optional[str] = "无码破解") -> pd.DataFrame:
    """
    根据视频类型筛选数据
    
    Args:
        df: 包含视频数据的DataFrame
        video_type: 要筛选的视频类型，默认"无码破解"，如果为None则返回所有数据
        
    Returns:
        pandas.DataFrame: 筛选后的数据框
    """
    if 'video_type' not in df.columns:
        raise ValueError("数据框中缺少 'video_type' 列")
    
    # 如果video_type为None，返回所有数据
    if video_type is None:
        print("🔍 筛选条件: 无筛选，返回所有数据")
        print(f"📋 筛选结果: {len(df)} 行 (原始: {len(df)} 行)")
        return df
    
    # 标准化处理：去除空格，统一大小写比较
    df_filtered = df[df['video_type'].astype(str).str.strip() == video_type.strip()]
    
    print(f"🔍 筛选条件: video_type == '{video_type}'")
    print(f"📋 筛选结果: {len(df_filtered)} 行 (原始: {len(df)} 行)")
    
    if len(df_filtered) == 0:
        print(f"⚠️ 未找到匹配的记录，现有video_type值: {df['video_type'].unique().tolist()}")
    
    return df_filtered


def extract_codes(df: pd.DataFrame, title_col: str = "video_title") -> List[str]:
    """
    从视频标题中提取视频编号
    
    Args:
        df: 输入数据框
        title_col: 标题列名，默认"video_title"
        
    Returns:
        List[str]: 提取的视频编号列表（已去重并保序）
    """
    if title_col not in df.columns:
        raise ValueError(f"数据框中缺少 '{title_col}' 列")
    
    # 视频编号正则模式：2-5个大写字母 + 连字符 + 2-4个数字
    pattern = r"\b[A-Z]{2,5}-\d{2,4}\b"
    
    codes = []
    failed_titles = []
    
    for idx, title in df[title_col].items():
        if pd.isna(title):
            continue
            
        # 标准化标题：去除全角字符，转换为半角
        normalized_title = str(title).replace('（', '(').replace('）', ')').replace('　', ' ')
        
        # 提取编号
        matches = re.findall(pattern, normalized_title, re.IGNORECASE)
        
        if matches:
            # 转换为大写并添加到列表
            for match in matches:
                codes.append(match.upper())
        else:
            failed_titles.append(title)
    
    # 去重并保持顺序
    unique_codes = list(OrderedDict.fromkeys(codes))
    
    print(f"🎯 编号提取结果:")
    print(f"   - 成功提取: {len(unique_codes)} 个唯一编号")
    print(f"   - 提取失败: {len(failed_titles)} 个标题")
    print(f"   - 提取的编号: {unique_codes}")
    
    if failed_titles:
        print(f"⚠️ 未能提取编号的标题示例: {failed_titles[:3]}")
    
    return unique_codes


def get_video_codes_from_csv(csv_path: str, video_type: Optional[str] = "无码破解", title_col: str = "video_title") -> List[str]:
    """
    一站式函数：从CSV文件中提取指定类型的视频编号
    
    Args:
        csv_path: CSV文件路径
        video_type: 视频类型筛选条件，默认"无码破解"
        title_col: 标题列名，默认"video_title"
        
    Returns:
        List[str]: 提取的视频编号列表
    """
    print(f"🚀 开始处理CSV文件: {csv_path}")
    
    # 1. 加载CSV
    df = load_actor_csv(csv_path)
    
    # 2. 筛选类型
    df_filtered = filter_by_type(df, video_type)
    
    # 3. 提取编号
    codes = extract_codes(df_filtered, title_col)
    
    print(f"✅ 处理完成，共提取 {len(codes)} 个视频编号")
    return codes


if __name__ == "__main__":
    # 测试代码
    test_csv_path = "./output/actor_七海蒂娜.csv"
    try:
        codes = get_video_codes_from_csv(test_csv_path)
        print(f"\n📋 最终结果: {codes}")
    except Exception as e:
        print(f"❌ 测试失败: {e}")