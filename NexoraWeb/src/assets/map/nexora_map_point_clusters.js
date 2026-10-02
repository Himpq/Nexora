const JOIN_DISTANCE = 44;
const SPLIT_DISTANCE = 56;
const CIRCLE_PADDING = 12;

function distanceSquared(left, right) {
    return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

/** 用实际屏幕距离合并相连近点；相交范围继续合并，圈内不混入其他组的图钉。 */
export class NexoraMapPointClusters {
    constructor() {
        this.previousGroups = new Map();
    }

    canJoin(item, member) {
        const previous = this.previousGroups.get(item.entry.index);
        const sameGroup = previous !== undefined && previous === this.previousGroups.get(member.entry.index);
        // 拆开的距离稍大于合并距离，缩放临界处不反复闪烁。
        const distance = sameGroup ? SPLIT_DISTANCE : JOIN_DISTANCE;

        return distanceSquared(item.pixel, member.pixel) <= distance ** 2;
    }

    findRoot(parents, index) {

        while (parents.get(index) !== index) {
            const parent = parents.get(index);
            parents.set(index, parents.get(parent));
            index = parent;
        }

        return index;
    }

    createRange(items) {
        const x = items.map((item) => item.pixel.x);
        const y = items.map((item) => item.pixel.y);
        const center = { x: (Math.min(...x) + Math.max(...x)) / 2, y: (Math.min(...y) + Math.max(...y)) / 2 };
        const radius = items.length === 1 ? 0
            : Math.max(18, ...items.map((item) => Math.sqrt(distanceSquared(item.pixel, center)) + CIRCLE_PADDING));

        return { items, center, radius };
    }

    findOverlappingRanges(groups) {

        for (let left = 0; left < groups.length; left += 1) {

            if (groups[left].items.length === 1) {
                continue;
            }

            for (let right = 0; right < groups.length; right += 1) {

                if (left !== right && distanceSquared(groups[left].center, groups[right].center) <= (groups[left].radius + groups[right].radius) ** 2) {
                    return { left, right };
                }
            }
        }

        return null;
    }

    /** 两个圈相交、或圈里还有独立点时归为同组，最终范围之间保持分离。 */
    mergeRanges(groups) {
        let overlapping = this.findOverlappingRanges(groups);

        while (overlapping) {
            const { left, right } = overlapping;
            const items = [...groups[left].items, ...groups[right].items].sort((first, second) => first.entry.index - second.entry.index);
            groups.splice(Math.max(left, right), 1);
            groups.splice(Math.min(left, right), 1);
            groups.push(this.createRange(items));
            overlapping = this.findOverlappingRanges(groups);
        }

        return groups.sort((left, right) => left.items[0].entry.index - right.items[0].entry.index);
    }

    /** 仅合并视野内的点；视野外名称继续独立显示为灰色。 */
    create(items) {
        const cells = new Map();
        const visible = items.filter((item) => item.visible).sort((left, right) => left.entry.index - right.entry.index);
        const parents = new Map(visible.map((item) => [item.entry.index, item.entry.index]));

        visible.forEach((item) => {
            const cellX = Math.floor(item.pixel.x / SPLIT_DISTANCE);
            const cellY = Math.floor(item.pixel.y / SPLIT_DISTANCE);

            for (let x = cellX - 1; x <= cellX + 1; x += 1) {

                for (let y = cellY - 1; y <= cellY + 1; y += 1) {
                    const nearby = cells.get(`${x},${y}`);

                    if (nearby) {
                        nearby.forEach((member) => {

                            if (this.canJoin(item, member)) {
                                const left = this.findRoot(parents, item.entry.index);
                                const right = this.findRoot(parents, member.entry.index);
                                parents.set(Math.max(left, right), Math.min(left, right));
                            }
                        });
                    }
                }
            }

            const key = `${cellX},${cellY}`;

            if (!cells.has(key)) {
                cells.set(key, []);
            }

            cells.get(key).push(item);
        });

        const components = new Map();
        visible.forEach((item) => {
            const root = this.findRoot(parents, item.entry.index);

            if (!components.has(root)) {
                components.set(root, []);
            }

            components.get(root).push(item);
        });
        const groups = this.mergeRanges([...components.values()].map((members) => this.createRange(members)));
        this.previousGroups.clear();

        return groups.filter((group) => group.items.length > 1).map((group) => {
            const key = group.items.map((item) => item.entry.index).join(',');
            group.items.forEach((item) => this.previousGroups.set(item.entry.index, key));

            return { key, ...group };
        });
    }
}
