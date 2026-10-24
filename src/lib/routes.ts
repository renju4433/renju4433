/**
 * 站内路由常量。
 *
 * 首页统一走 /home 而不是 /：托管网关的 CDN 把 /?sharecode=xxx 这一条 URL
 * 永久缓存成了旧版本（无法刷新），只有换成另一个路径才能拿到最新 HTML。
 */
export const HOME_HREF = '/home';

export function leagueHref(
  leagueId: string,
  status?: 'all' | 'in' | 'pre' | 'post'
): string {
  if (status && status !== 'all') {
    return `/league/${leagueId}/${status}`;
  }
  return leagueId === 'all' ? HOME_HREF : `/league/${leagueId}`;
}
