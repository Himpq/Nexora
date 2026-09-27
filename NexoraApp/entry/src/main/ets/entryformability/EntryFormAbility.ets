import { Want } from '@kit.AbilityKit';
import { formBindingData, FormExtensionAbility } from '@kit.FormKit';
import { LearningCardAction, LearningCardData, LearningSystemEntry } from '../common/LearningSystemEntry';
import { LearningCardReply, LearningFormClient } from '../common/LearningFormClient';

export default class EntryFormAbility extends FormExtensionAbility {
    private responding: Set<string> = new Set<string>();

    onAddForm(want: Want): formBindingData.FormBindingData {
        const value: Object | undefined = want.parameters === undefined
            ? undefined : want.parameters['ohos.extra.param.key.form_identity'];
        const formId: string = value === undefined ? '' : String(value);
        LearningSystemEntry.rememberForm(this.context, formId);
        return formBindingData.createFormBindingData(LearningSystemEntry.card(this.context));
    }

    onUpdateForm(formId: string): void {
        void LearningSystemEntry.updateForm(formId, LearningSystemEntry.card(this.context));
    }

    onRemoveForm(formId: string): void {
        LearningSystemEntry.rememberForm(this.context, formId, true);
    }

    onFormEvent(formId: string, message: string): void {
        const action: LearningCardAction | null = LearningSystemEntry.parseAction(message);
        if (action === null) {
            return;
        }
        const key: string = action.identityToken + ':' + action.decisionId;
        if (this.responding.has(key)) {
            return;
        }
        this.responding.add(key);
        void this.respond(formId, action, key);
    }

    private async respond(formId: string, action: LearningCardAction, key: string): Promise<void> {
        try {
            const reply: LearningCardReply = await LearningFormClient.respond(this.context, action);
            const current: LearningCardData = LearningSystemEntry.card(this.context);
            if (reply.message.length > 0 && (current.identityToken === action.identityToken || current.identityToken.length === 0)) {
                const data: LearningCardData = {
                    title: reply.message, minutes: current.minutes,
                    actionable: reply.retry && current.decisionId === action.decisionId,
                    decisionId: reply.retry ? current.decisionId : '', identityToken: current.identityToken,
                };
                await LearningSystemEntry.updateForm(formId, data);
            } else {
                await LearningSystemEntry.updateForm(formId, current);
            }
        } finally {
            this.responding.delete(key);
        }
    }
}
