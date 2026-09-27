// EntryAbility 引用执行器，把装饰器注册加入编译依赖图。框架负责创建实例。
import WhatsNextIntent from './WhatsNextIntent';
import QuizMeIntent from './QuizMeIntent';

export function nexoraIntentExecutors(): Object[] {
    return [WhatsNextIntent, QuizMeIntent];
}
