/** 每次发送独享的取消句柄，停止旧回复不会影响时间线读取或下一次发送。 */
export class ReplyCancellation {
  cancelled: boolean = false;
  private handler: (() => void) | null = null;

  bind(handler: () => void): void {
    this.throwIfCancelled();
    this.handler = handler;
  }

  unbind(): void {
    this.handler = null;
  }

  cancel(): void {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    const handler = this.handler;
    this.handler = null;
    if (handler !== null) {
      handler();
    }
  }

  throwIfCancelled(): void {
    if (this.cancelled) {
      throw new Error('回复已停止');
    }
  }
}
