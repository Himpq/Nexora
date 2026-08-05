/*
 * 课程知识图谱的确定性布局。
 *
 * 章节按后代数量分配扇区，知识点按层级落在独立圆环上。这里不使用力导向
 * 或 strictRadial，是为了避免每次渲染漂移，以及同层节点被拓扑约束挤成竖链。
 */
(function (root) {
    "use strict";

    var FULL_CIRCLE = Math.PI * 2;
    var START_ANGLE = -Math.PI / 2;
    var MIN_CHAPTER_RADIUS = 260;
    var FIRST_RING_GAP = 230;
    var NEXT_RING_GAP = 190;
    var RING_STEP = 20;
    var ARC_SLOTS = {
        chapter: 150,
        concept: 128,
        sub: 112,
    };

    function roundUp(value, step) {
        return Math.ceil(value / step) * step;
    }

    function getArcSlot(node) {
        return ARC_SLOTS[node.data.kind] || ARC_SLOTS.concept;
    }

    function getOutwardLabelPlacement(angle, kind) {
        if (kind === "center") {
            return "center";
        }

        var horizontal = Math.cos(angle);
        var vertical = Math.sin(angle);

        if (Math.abs(horizontal) >= Math.abs(vertical) * 0.72) {
            return horizontal >= 0 ? "right" : "left";
        }

        return vertical >= 0 ? "bottom" : "top";
    }

    function getRingRadii(nodes) {
        var depthNodes = {};
        var maxDepth = 0;

        nodes.forEach(function (node) {
            var depth = Number(node.data.depth || 0);

            if (depth <= 0) {
                return;
            }

            if (!depthNodes[depth]) {
                depthNodes[depth] = [];
            }

            depthNodes[depth].push(node);
            maxDepth = Math.max(maxDepth, depth);
        });

        var radii = {};

        for (var depth = 1; depth <= maxDepth; depth += 1) {
            var nodesAtDepth = depthNodes[depth] || [];
            var requiredCircumference = nodesAtDepth.reduce(function (total, node) {
                return total + getArcSlot(node);
            }, 0);
            var requiredRadius = requiredCircumference / FULL_CIRCLE;

            if (depth === 1) {
                radii[depth] = roundUp(
                    Math.max(MIN_CHAPTER_RADIUS, requiredRadius),
                    RING_STEP
                );
                continue;
            }

            var ringGap = depth === 2 ? FIRST_RING_GAP : NEXT_RING_GAP;

            radii[depth] = roundUp(
                Math.max(radii[depth - 1] + ringGap, requiredRadius),
                RING_STEP
            );
        }

        return radii;
    }

    function buildChapterGroups(nodes) {
        var groups = [];
        var groupMap = {};

        nodes.forEach(function (node) {
            if (node.data.kind !== "chapter") {
                return;
            }

            var group = {
                chapter: node,
                descendants: [],
                byDepth: {},
                weight: 1,
            };

            groups.push(group);
            groupMap[node.id] = group;
        });

        nodes.forEach(function (node) {
            if (node.data.kind === "center" || node.data.kind === "chapter") {
                return;
            }

            var group = groupMap[node.data.chapterId];

            if (!group) {
                throw new Error("知识图谱节点未关联有效章节: " + node.id);
            }

            var depth = Number(node.data.depth || 0);

            if (!group.byDepth[depth]) {
                group.byDepth[depth] = [];
            }

            group.descendants.push(node);
            group.byDepth[depth].push(node);
        });

        groups.forEach(function (group) {
            group.weight = Math.max(2, group.descendants.length + 1);
        });

        return groups;
    }

    function positionNode(node, radius, angle) {
        return Object.assign({}, node, {
            data: Object.assign({}, node.data, {
                labelPlacement: getOutwardLabelPlacement(angle, node.data.kind),
            }),
            style: Object.assign({}, node.style, {
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
            }),
        });
    }

    function positionNodesInSector(nodes, radius, sectorStart, sectorSpan) {
        var positioned = [];
        var boundaryGap = Math.min(0.08, sectorSpan * 0.12);
        var usableStart = sectorStart + boundaryGap;
        var usableSpan = Math.max(0, sectorSpan - boundaryGap * 2);

        nodes.forEach(function (node, index) {
            var angle = nodes.length === 1
                ? sectorStart + sectorSpan / 2
                : usableStart + usableSpan * (index + 0.5) / nodes.length;

            positioned.push(positionNode(node, radius, angle));
        });

        return positioned;
    }

    /**
     * 返回带固定坐标的 G6 节点。中心始终处于几何中心，各章节扇区稳定且互不抢位。
     */
    function createChapterSectorLayout(nodes) {
        var centerNodes = nodes.filter(function (node) {
            return node.data.kind === "center";
        });
        var groups = buildChapterGroups(nodes);

        if (centerNodes.length !== 1) {
            throw new Error("知识图谱必须且只能包含一个课程中心节点");
        }

        if (!groups.length) {
            throw new Error("知识图谱缺少章节节点");
        }

        var radii = getRingRadii(nodes);
        var totalWeight = groups.reduce(function (total, group) {
            return total + group.weight;
        }, 0);

        // 此处日志用于定位重复出现的拥挤问题，只记录图规模与计算结果，不包含课程内容。
        root.console.info("[NexoraLearning][KnowledgeGraph] chapter-sector layout", {
            nodeCount: nodes.length,
            chapterCount: groups.length,
            ringRadii: Object.assign({}, radii),
            chapterWeights: groups.map(function (group) { return group.weight; }),
        });

        var positioned = [Object.assign({}, centerNodes[0], {
            data: Object.assign({}, centerNodes[0].data, { labelPlacement: "center" }),
            style: Object.assign({}, centerNodes[0].style, { x: 0, y: 0 }),
        })];
        var sectorStart = START_ANGLE;

        groups.forEach(function (group) {
            var sectorSpan = FULL_CIRCLE * group.weight / totalWeight;
            var sectorCenter = sectorStart + sectorSpan / 2;

            positioned.push(positionNode(group.chapter, radii[1], sectorCenter));

            Object.keys(group.byDepth).sort(function (left, right) {
                return Number(left) - Number(right);
            }).forEach(function (depthKey) {
                var depth = Number(depthKey);

                positioned = positioned.concat(positionNodesInSector(
                    group.byDepth[depth],
                    radii[depth],
                    sectorStart,
                    sectorSpan
                ));
            });

            sectorStart += sectorSpan;
        });

        return positioned;
    }

    root.NXKnowledgeGraphLayout = {
        createChapterSectorLayout: createChapterSectorLayout,
    };
})(window);
