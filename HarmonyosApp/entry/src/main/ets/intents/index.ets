/**
 * 意图注册表。装饰器意图只有在被依赖图引用的 ets 文件里才会被编译进 insight_intent 产物
 * （文档「基于Link的装饰器方案」：必须在被依赖的 ets 文件中添加装饰器才可以被编译），
 * 所以 EntryAbility 引用本文件，把三条意图挂进依赖图。
 */
import WhatsNextIntent from './WhatsNextIntent';
import ExplainIntent from './ExplainIntent';
import QuizMeIntent from './QuizMeIntent';

export const NEXORA_INTENT_NAMES: string[] = ['NexoraWhatsNext', 'NexoraExplain', 'NexoraQuizMe'];

/** 仅用于把执行器类纳入依赖图；运行时由意图框架实例化，这里不 new。 */
export function nexoraIntentExecutors(): Object[] {
  return [WhatsNextIntent, ExplainIntent, QuizMeIntent];
}
