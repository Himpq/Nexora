/**
 * 服务卡片（§9.3 #16）：今日卡——决策器一句话 + 进度环 + [好][晚点]。
 * 主路径走 formProvider.updateForm 主动刷新（不受定时刷新最小 30 分钟限制）。
 * onFormEvent 把卡片上的「好/晚点」回喂决策器 /decision/respond（原为空实现，按钮点了没反应）。
 */
import { formBindingData, FormExtensionAbility, formProvider } from '@kit.FormKit';
import { Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { preferences } from '@kit.ArkData';
import { http } from '@kit.NetworkKit';
import { CARD_PREF_NAME } from '../capability/form';
import { NxEnv } from '../config/Env';

const DOMAIN = 0x0000;
export default class EntryFormAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    hilog.info(DOMAIN, 'testTag', 'onAddForm');
    const formId: string = want.parameters !== undefined && want.parameters['ohos.extra.param.key.form_identity'] !== undefined
      ? String(want.parameters['ohos.extra.param.key.form_identity'])
      : '';
    if (formId.length > 0) {
      this.saveFormId(formId);
    }
    const data = formBindingData.createFormBindingData({
      'title': '我在看着你的进度，有需要我会说',
      'minutes': '',
      'percent': 0,
      'actionable': false,
    });
    return data;
  }

  onUpdateForm(formId: string): void {
    hilog.info(DOMAIN, 'testTag', 'onUpdateForm');
  }

  onFormEvent(formId: string, message: string): void {
    hilog.info(DOMAIN, 'testTag', 'onFormEvent: %{public}s', message);
    // postCardAction 的 params 被包成 {"message":"accept"} 形态的 JSON 串。
    let response: string = '';
    if (message.indexOf('accept') >= 0) {
      response = 'accept';
    } else if (message.indexOf('defer') >= 0) {
      response = 'defer';
    } else {
      return;
    }
    this.respondDecision(formId, response);
  }

  /** 把卡片上的选择回喂决策器，并就地刷新卡片文案（不拉起应用）。 */
  private async respondDecision(formId: string, response: string): Promise<void> {
    let decisionId: string = '';
    let baseUrl: string = '';
    let username: string = '';
    try {
      const options: preferences.Options = { name: CARD_PREF_NAME };
      const store = preferences.getPreferencesSync(this.context, options);
      decisionId = store.getSync('decision_id', '') as string;
      baseUrl = store.getSync('base_url', '') as string;
      username = store.getSync('username', '') as string;
    } catch (err) {
      return;
    }
    if (decisionId.length === 0) {
      return;
    }
    const root: string = baseUrl.length > 0 ? baseUrl.replace(/\/+$/, '') : NxEnv.baseUrl();

    const client = http.createHttp();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Nexora-Username': username,
      };
      await client.request(root + '/api/agent/v1/decision/respond', {
        method: http.RequestMethod.POST,
        header: headers,
        extraData: JSON.stringify({ 'decision_id': decisionId, 'response': response }),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 15000,
      });
      this.reflectResponse(formId, response);
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'decision respond failed');
    } finally {
      client.destroy();
    }
  }

  /** 回喂成功后卡片就地显示结果，按钮不再可用（§7 第一人称）。 */
  private reflectResponse(formId: string, response: string): void {
    const title: string = response === 'accept'
      ? '好，我把位置翻到你上次停的地方了。'
      : '行，我过 40 分钟再提一次。';
    const data = formBindingData.createFormBindingData({
      'title': title,
      'minutes': '',
      'percent': 0,
      'actionable': false,
    });
    try {
      formProvider.updateForm(formId, data);
    } catch (err) {
      // 卡片已被移除时忽略
    }
  }

  private saveFormId(formId: string): void {
    try {
      const options: preferences.Options = { name: CARD_PREF_NAME };
      const store = preferences.getPreferencesSync(this.context, options);
      store.putSync('form_id', formId);
      store.flush();
    } catch (err) {
      // 存储失败不影响卡片添加
    }
  }
}
