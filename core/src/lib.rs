//! DuoCompare 对比核心：目录对比、行级差异计算、文件读写。
//! 纯 Rust、不依赖 UI，方便后续做 CLI / 服务端复用。

pub mod diff;
pub mod dir;
pub mod fs;
