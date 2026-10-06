/**
 * schema v3（0.1.4）：阅读统计的**去重水位线**。
 *
 * 背景：0.1.3 的「字数」是按进度落点的位移累加的，于是有两个夸大：
 *   1. 来回刷会把同一段文字反复计入（往回翻不加，但再前进又加一次）；
 *   2. 拖着滚动条一路略过去的文字，因为每一步都小于 STAT_MAX_STEP_CHARS，也被当成读了。
 * 现在改成主进程按「这一天在这一章读到过的最远偏移」算增量：没有超出水位线就不算新字，
 * 于是同一段当天只记一次。水位线按天存，第二天接着读会重新算。
 *
 * 纯加表，老数据一行都不用动（与 v2 同样处理）。
 */
export const SCHEMA_V3_SQL = `
CREATE TABLE IF NOT EXISTS reading_span (
  book_id       TEXT    NOT NULL,
  day           TEXT    NOT NULL,
  chapter_index INTEGER NOT NULL,
  max_offset    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (book_id, day, chapter_index),
  FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE
);
`

export const SCHEMA_VERSION_3 = 3
