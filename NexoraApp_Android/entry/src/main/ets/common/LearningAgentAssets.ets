import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import picker from '@ohos.file.picker';

export class LearningAgentAssets {
    static async open(context: common.UIAbilityContext, url: string): Promise<void> {
        if (!/^https?:\/\//i.test(url)) {
            throw new Error('暂不支持打开该链接');
        }

        await context.startAbility({ action: 'ohos.want.action.viewData', uri: url });
    }

    static async exportText(context: common.UIAbilityContext, text: string): Promise<boolean> {
        const options = new picker.DocumentSaveOptions();
        options.newFileNames = ['学习记录-' + Date.now() + '.md'];
        const uris: string[] = await new picker.DocumentViewPicker(context).save(options);

        if (uris.length === 0) {
            return false;
        }

        const file: fs.File = fs.openSync(
            uris[0],
            fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC
        );

        try {
            fs.writeSync(file.fd, text);
        } finally {
            fs.closeSync(file);
        }

        return true;
    }
}
