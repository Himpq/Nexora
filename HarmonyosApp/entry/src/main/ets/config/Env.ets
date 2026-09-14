/**
 * 环境配置。云端默认；本地联调只改这里的一个开关，不再把局域网 IP 散落在 EntryAbility。
 * 模拟器访问宿主机后端必须用宿主机局域网 IP（官方 FAQ faqs-simulator-6），而非 127.0.0.1。
 */
export class NxEnv {
  /** 云端基线（HTTPS，公开受信证书）。 */
  static readonly CLOUD_BASE_URL: string = 'https://chat.himpqblog.cn:5002';
  /** 本地联调：true 时使用 LOCAL_BASE_URL 与 LOCAL_USERNAME。提交/演示前置为 false。 */
  static readonly USE_LOCAL: boolean = true;
  static readonly LOCAL_BASE_URL: string = 'http://192.168.1.170:5001';
  /** 本地联调时跳过账号登录直接用演示账号；云端模式下由 Identity 走华为账号或本机持久化身份。 */
  static readonly LOCAL_USERNAME: string = 'demo_student';

  static baseUrl(): string {
    return NxEnv.USE_LOCAL ? NxEnv.LOCAL_BASE_URL : NxEnv.CLOUD_BASE_URL;
  }
}
