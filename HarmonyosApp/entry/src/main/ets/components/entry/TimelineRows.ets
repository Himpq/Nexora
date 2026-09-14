/**
 * 时间线分段数据源（§6.1）。
 *
 * 把条目按自然日分组，展平成「日期头 + 条目」的单一索引空间供 LazyForEach 消费；
 * **折叠的天不进索引**——演示账号 60+ 条时首屏只渲染今天，长列表滚动与翻看问题一并解决。
 *
 * 行 key 带上 status：决策条目被回喂（pending → accept/defer/dismiss）后 key 变化，
 * 强制重建条目组件。这是第 5 轮 MirrorOfYou 踩过的坑——@Builder/@Reusable 在 key 不变的
 * 保留项上不随数据刷新。
 */
import { TimelineEntry } from '../../models/Index';

export class TimelineRow {
  isDay: boolean = false;
  key: string = '';
  dayKey: string = '';
  dayLabel: string = '';
  dayCount: number = 0;
  expanded: boolean = false;
  // 非空占位：LazyForEach 的构建闭包里不便做 null 判空，日期头行不会读这个字段。
  entry: TimelineEntry = { id: '', kind: 'system', ts: 0, text: '', unattended: false };
}

export function nxDayKey(ts: number): string {
  const d: Date = new Date(ts);
  const m: number = d.getMonth() + 1;
  const day: number = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

export function nxDayLabel(ts: number): string {
  const d: Date = new Date(ts);
  const now: Date = new Date();
  const todayStart: number = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thatStart: number = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays: number = Math.round((todayStart - thatStart) / 86400000);
  if (diffDays === 0) {
    return '今天';
  }
  if (diffDays === 1) {
    return '昨天';
  }
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

export class SectionedEntryDataSource implements IDataSource {
  private rows: TimelineRow[] = [];
  private entries: TimelineEntry[] = [];
  private collapsedDays: string[] = [];
  private defaultsApplied: boolean = false;
  private listeners: DataChangeListener[] = [];
  private includeDayHeaders: boolean = true;

  constructor(includeDayHeaders: boolean = true) {
    this.includeDayHeaders = includeDayHeaders;
  }

  totalCount(): number {
    return this.rows.length;
  }

  getData(index: number): TimelineRow {
    return this.rows[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) {
      this.listeners.push(listener);
    }
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const pos: number = this.listeners.indexOf(listener);
    if (pos >= 0) {
      this.listeners.splice(pos, 1);
    }
  }

  /** 条目按 ts 升序传入。首次设置时展开今天，若今天为空则展开最新一天。 */
  setEntries(items: TimelineEntry[]): void {
    this.entries = items;
    if (!this.includeDayHeaders) {
      this.collapsedDays = [];
      this.rebuild();
      return;
    }
    if (!this.defaultsApplied && items.length > 0) {
      const todayKey: string = nxDayKey(new Date().getTime());
      // 有今天的记录时展开今天；否则展开最新一天，保证首屏总能落到
      // 最新条目，而不是只停在一个折叠的日期标题上。
      let expandedKey: string = todayKey;
      let hasToday: boolean = false;
      for (let i = 0; i < items.length; i++) {
        if (nxDayKey(items[i].ts) === todayKey) {
          hasToday = true;
          break;
        }
      }
      if (!hasToday) {
        expandedKey = nxDayKey(items[items.length - 1].ts);
      }
      const collapsed: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const key: string = nxDayKey(items[i].ts);
        if (key !== expandedKey && collapsed.indexOf(key) < 0) {
          collapsed.push(key);
        }
      }
      this.collapsedDays = collapsed;
      this.defaultsApplied = true;
    }
    this.rebuild();
  }

  toggleDay(dayKey: string): void {
    const at: number = this.collapsedDays.indexOf(dayKey);
    if (at >= 0) {
      this.collapsedDays.splice(at, 1);
    } else {
      this.collapsedDays.push(dayKey);
    }
    this.rebuild();
  }

  isCollapsed(dayKey: string): boolean {
    return this.collapsedDays.indexOf(dayKey) >= 0;
  }

  /** 当前渲染的条目行数（不含日期头），用于「回到最新」判断。 */
  visibleEntryCount(): number {
    let count: number = 0;
    for (let i = 0; i < this.rows.length; i++) {
      if (!this.rows[i].isDay) {
        count++;
      }
    }
    return count;
  }

  private rebuild(): void {
    if (!this.includeDayHeaders) {
      const rows: TimelineRow[] = [];
      for (let i = 0; i < this.entries.length; i++) {
        const item: TimelineEntry = this.entries[i];
        const row: TimelineRow = new TimelineRow();
        row.isDay = false;
        row.key = item.id + '_' + (item.status !== undefined ? item.status : '');
        row.dayKey = nxDayKey(item.ts);
        row.entry = item;
        rows.push(row);
      }
      this.rows = rows;
      for (let i = 0; i < this.listeners.length; i++) {
        this.listeners[i].onDataReloaded();
      }
      return;
    }
    const counts: Map<string, number> = new Map<string, number>();
    for (let i = 0; i < this.entries.length; i++) {
      const key: string = nxDayKey(this.entries[i].ts);
      const prev: number | undefined = counts.get(key);
      counts.set(key, prev === undefined ? 1 : prev + 1);
    }

    const rows: TimelineRow[] = [];
    let currentDay: string = '';
    for (let i = 0; i < this.entries.length; i++) {
      const item: TimelineEntry = this.entries[i];
      const key: string = nxDayKey(item.ts);
      if (key !== currentDay) {
        currentDay = key;
        const total: number | undefined = counts.get(key);
        const header: TimelineRow = new TimelineRow();
        header.isDay = true;
        header.key = 'day_' + key;
        header.dayKey = key;
        header.dayLabel = nxDayLabel(item.ts);
        header.dayCount = total === undefined ? 0 : total;
        header.expanded = this.collapsedDays.indexOf(key) < 0;
        rows.push(header);
      }
      if (this.collapsedDays.indexOf(key) >= 0) {
        continue;
      }
      const row: TimelineRow = new TimelineRow();
      row.isDay = false;
      row.key = item.id + '_' + (item.status !== undefined ? item.status : '');
      row.dayKey = key;
      row.entry = item;
      rows.push(row);
    }

    this.rows = rows;
    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i].onDataReloaded();
    }
  }
}
