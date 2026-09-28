import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { textRecognition } from '@kit.CoreVisionKit';

export class LearningAgentAssets {
    static async readPicture(): Promise<string> {
        if (!canIUse('SystemCapability.AI.OCR.TextRecognition')) {
            throw new Error('当前设备不支持图片文字识别，可以粘贴题目文字继续提问');
        }
        const options = new photoAccessHelper.PhotoSelectOptions();
        options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
        options.maxSelectNumber = 1;
        const selected = await new photoAccessHelper.PhotoViewPicker().select(options);
        if (selected.photoUris.length === 0) { return ''; }
        const file = await fileIo.open(selected.photoUris[0], fileIo.OpenMode.READ_ONLY);
        let source: image.ImageSource | undefined = undefined;
        let pixels: image.PixelMap | undefined = undefined;
        try {
            source = image.createImageSource(file.fd);
            const info = await source.getImageInfo();
            const scale: number = Math.min(1, 2048 / Math.max(info.size.width, info.size.height));
            pixels = await source.createPixelMap({ desiredPixelFormat: image.PixelMapFormat.RGBA_8888,
                desiredSize: { width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale)) } });
            const result = await textRecognition.recognizeText({ pixelMap: pixels }, { isDirectionDetectionSupported: true });
            if (result.value.trim().length === 0) { throw new Error('没有识别到文字，请选择清晰的题目或教材图片'); }
            return result.value.substring(0, 4000);
        } finally {
            try {
                if (pixels !== undefined) { await pixels.release(); }
            } finally {
                try {
                    if (source !== undefined) { await source.release(); }
                } finally { await fileIo.close(file); }
            }
        }
    }

    static async open(context: common.UIAbilityContext, url: string): Promise<void> {
        if (!/^https?:\/\//i.test(url)) { throw new Error('暂不支持打开这个链接'); }
        await context.startAbility({ action: 'ohos.want.action.viewData', uri: url });
    }

    static async exportText(context: common.UIAbilityContext, text: string): Promise<boolean> {
        const options = new picker.DocumentSaveOptions();
        options.newFileNames = ['学习记录-' + Date.now() + '.md'];
        const uris = await new picker.DocumentViewPicker(context).save(options);
        if (uris.length === 0) { return false; }
        const file = await fileIo.open(uris[0], fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
        try { fileIo.writeSync(file.fd, text); } finally { await fileIo.close(file); }
        return true;
    }
}
