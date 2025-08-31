-- 创建字幕评论功能相关表
-- 迁移文件: 001_create_subtitle_comments.sql
-- 创建时间: 2024-01-22

-- 创建字幕评论表
CREATE TABLE IF NOT EXISTS subtitle_comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    video_id VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    timestamp DECIMAL(10,3) NOT NULL COMMENT '视频时间点（秒）',
    parent_id INT NULL COMMENT '父评论ID，用于回复',
    likes_count INT DEFAULT 0,
    replies_count INT DEFAULT 0,
    status ENUM('pending', 'approved', 'rejected', 'deleted') DEFAULT 'approved',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_video_id (video_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_user_id (user_id),
    INDEX idx_parent_id (parent_id),
    INDEX idx_created_at (created_at DESC)
);

-- 创建评论点赞表
CREATE TABLE IF NOT EXISTS comment_likes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    comment_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_comment_id (comment_id),
    UNIQUE KEY unique_user_comment (user_id, comment_id)
);

-- 插入一些示例数据（可选，用于测试）
INSERT INTO subtitle_comments (user_id, video_id, content, timestamp, likes_count) VALUES
(1, 'test_video_001', '这个场景太精彩了！', 120.5, 3),
(1, 'test_video_001', '演员表演很自然', 245.2, 1),
(2, 'test_video_001', '同意楼上，这段很棒', 121.0, 2);

INSERT INTO comment_likes (user_id, comment_id) VALUES
(2, 1),
(3, 1),
(1, 3);