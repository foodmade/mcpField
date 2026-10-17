/**
 * 原生 SQL（db.execute）查出的 DATETIME 是不带时区的字符串，库里存的是 UTC，要补上 Z 再解析
 * （直接 new Date 会按服务器时区北京时间解析，差 8 小时）；已经是 Date 或 ISO 字符串的原样处理
 */
export function dbTime(value: Date | string): Date {
  if (value instanceof Date) return value
  return /[TZ]/.test(value) ? new Date(value) : new Date(value.replace(' ', 'T') + 'Z')
}
