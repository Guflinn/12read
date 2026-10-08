/**
 * schema v5（0.2.0）：章节的「父级」—— 合集三级目录（册 → 章 → 节）里的中间那一级。
 *
 * 用户 2026-10-08 反馈：目录要像 iPhone 自带图书那样分得细 ——
 * 每本书是一个大分类，书下面再分「第几章」「第几节」。
 * 于是章节表要多记一层：节这一行的 parent_title 是它所属的章名，
 * 册下面的章 parent_title 就等于 group_title。目录据此把「节」缩进画在「章」下面。
 *
 * 纯加列，老数据一行都不用动。
 */
export const SCHEMA_V5_SQL = `
ALTER TABLE chapter ADD COLUMN parent_title TEXT;
`

export const SCHEMA_VERSION_5 = 5
