/**
 * §9.3 服务卡片主动刷新（#16）：updateForm 不受定时刷新最小间隔限制，为主路径。
 * 除卡片数据外，还把「好/晚点」回喂决策器所需的上下文（decision_id / base_url / username）
 * 写入同一 Preferences——卡片运行在独立进程，取不到应用的 AppStorage。
 */
import { formBindingData, formProvider } from '@kit.FormKit';
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

export const CARD_PREF_NAME: string = 'nexora_card';

export class FormService {
  async updateToday(context: common.UIAbilityContext, title: string, minutes: string,
    percent: number, decisionId: string): Promise<void> {
    let store: preferences.Preferences;
    try {
      const options: preferences.Options = { name: CARD_PREF_NAME };
      store = preferences.getPreferencesSync(context, options);
    } catch (err) {
      return;
    }

    // 回喂上下文：卡片进程按这三项直接调 /decision/respond。
    try {
      const baseUrl: string | undefined = AppStorage.get<string>('nxBaseUrl');
      const username: string | undefined = AppStorage.get<string>('nxUsername');
      store.putSync('decision_id', decisionId);
      store.putSync('base_url', baseUrl !== undefined ? baseUrl : '');
      store.putSync('username', username !== undefined ? username : '');
      store.flush();
    } catch (err) {
      // 上下文写入失败只影响卡片按钮回喂，不影响卡片展示
    }

    let formId: string = '';
    try {
      formId = store.getSync('form_id', '') as string;
    } catch (err) {
      return;
    }
    if (formId.length === 0) {
      return;
    }

    const data = formBindingData.createFormBindingData({
      'title': title,
      'minutes': minutes,
      'percent': percent,
      'actionable': decisionId.length > 0,
    });
    try {
      await formProvider.updateForm(formId, data);
    } catch (err) {
      // 卡片已被移除时忽略
    }
  }
}

export const sharedForm: FormService = new FormService();
