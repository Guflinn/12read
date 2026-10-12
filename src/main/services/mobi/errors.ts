/**
 * MOBI 解析过程中的「这本书读不了」。
 *
 * 与 EpubError 同一套路：message 一律是给用户看的中文，由导入链路翻成导入失败的提示。
 * 这里额外记一个 `hint`：MOBI 的失败大多是「格式变体不支持」，能顺手告诉用户下一步怎么绕
 * （比如「用 Calibre 转一次」）比干说一句「打不开」有用得多。
 */
export class MobiError extends Error {
  constructor(
    message: string,
    /** 给用户的下一步建议；没有更好建议时为 null。 */
    readonly hint: string | null = null
  ) {
    super(message)
    this.name = 'MobiError'
  }
}
