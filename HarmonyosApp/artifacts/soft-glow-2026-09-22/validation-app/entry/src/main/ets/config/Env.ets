/**
 * 环境配置。云端默认；本地联调只改这里的一个开关，不再把局域网 IP 散落在 EntryAbility。
 * 模拟器访问宿主机后端必须用宿主机局域网 IP（官方 FAQ faqs-simulator-6），而非 127.0.0.1。
 *
 * 云端拓扑（2026-09-14 在服务器上核实，见 DEPLOY.md 与执行日志）：
 *   华为云 ECS 123.60.41.184 一台机器同时跑账号系统（ChatDBServer，nginx :80 → 127.0.0.1:5000）
 *   与 learning（nginx :5002 → 127.0.0.1:5001 → /opt/NexoraLearning）。
 *   `chat.himpqblog.cn` 解析到另一台机器（154.37.212.129，Himpq 主站），上面的 learning 是只有
 *   /context /plan /ask-in-context 那一代的旧版本，没有 GET /events、/today、/decision、/cognition，
 *   App 指过去就会退化成普通问答——不要再把域名写回来。
 *   ECS 的 443 是自签证书（SAN=IP），鸿蒙 http 默认不信，所以先走明文 HTTP；要上 HTTPS 得给
 *   每个客户端的请求带 caPath 指向随包分发的 nexora.crt（待做）。
 */
export class NxEnv {
  /** Nexora 账号系统：账号密码登录与 Flask 会话签发（ECS :80 → ChatDBServer 5000）。 */
  static readonly NEXORA_AUTH_BASE_URL: string = 'http://123.60.41.184';
  /** 云端 learning（ECS :5002 → NexoraLearning 5001）。 */
  static readonly CLOUD_BASE_URL: string = 'http://123.60.41.184:5002';
  /** 本地联调：true 时使用 LOCAL_BASE_URL 与 LOCAL_USERNAME。提交/演示前置为 false。 */
  static readonly USE_LOCAL: boolean = false;
  static readonly LOCAL_BASE_URL: string = 'http://192.168.1.170:5001';
  /** 本地联调时跳过账号登录直接用演示账号；云端模式下由 Identity 走账号登录或本机持久化会话。 */
  static readonly LOCAL_USERNAME: string = 'demo_student';

  static baseUrl(): string {
    return NxEnv.USE_LOCAL ? NxEnv.LOCAL_BASE_URL : NxEnv.CLOUD_BASE_URL;
  }
}
