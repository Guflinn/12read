/**
 * schema v4（0.2.0）：章节的「分组」—— 合集类 EPUB 的卷 / 册名。
 *
 * 背景：像《莫言作品全集（共18册）》这种一个文件装 18 本书的合集，
 * 目录（NCX/nav）顶层就是 18 个卷名，第二层才是各卷的章。
 * 0.2.0 之前只取「章」，卷名会被同落点去重吃掉，于是读者看到的是一串平铺的章，
 * **判断不出这是哪本书**（真书实测：18 个卷名只剩 8 个）。
 *
 * 现在把卷名单独存一列：正文/标题保持干净（阅读器顶部只显示章名），
 * 目录抽屉按卷分组展示。TXT 与普通 EPUB 这一列是 NULL，行为完全不变。
 *
 * 纯加列（`ALTER TABLE ... ADD COLUMN`），老数据一行都不用动。
 */
export const SCHEMA_V4_SQL = `
ALTER TABLE chapter ADD COLUMN group_title TEXT;
`

export const SCHEMA_VERSION_4 = 4
