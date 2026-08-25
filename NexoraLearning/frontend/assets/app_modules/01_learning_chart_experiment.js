// ─────── Generic ECharts learning component ────────────────────────────
function renderChartExperimentPrediction(config) {
    const prompt = String(config.prediction_prompt || "").trim();
    const options = Array.isArray(config.prediction_options) ? config.prediction_options : [];

    if (!prompt || !options.length) {
        return "";
    }

    return `
      <div class="lp-chart-prediction">
        <div class="lp-chart-prediction-copy">
          <span>观察前预测</span>
          <strong>${escapeHtml(prompt)}</strong>
        </div>
        <div class="lp-chart-prediction-options" role="group" aria-label="预测选项">
          ${options.map((option) => `
            <button type="button" data-chart-prediction="${escapeHtml(String(option && option.id || ""))}" aria-pressed="false">
              ${escapeHtml(String(option && option.label || ""))}
            </button>
          `).join("")}
        </div>
      </div>
    `;
}


function renderChartExperimentLab(config, blockIndex) {
    const title = String(config.title || "数据实验").trim();
    const description = String(config.description || "").trim();
    const parameters = Array.isArray(config.parameters) ? config.parameters : [];
    const option = config.option && typeof config.option === "object" ? config.option : null;
    const series = option && Array.isArray(option.series) ? option.series : [];
    const requestedHeight = Number(config.height);
    const height = Number.isFinite(requestedHeight) ? requestedHeight : 480;
    const safeConfig = escapeHtml(encodeURIComponent(JSON.stringify(config)));

    if (!window.echarts || typeof window.echarts.init !== "function") {
        return renderLearningLabError("ECharts 本地资源未加载", "请检查本地 vendor/echarts 资源。");
    }

    if (!option || !series.length) {
        return renderLearningLabError("图表配置无效", "chart_experiment 必须提供包含 series 的 option。");
    }

    return `
      <section class="lp-lab lp-lab-chart-experiment" data-lab-config="${safeConfig}" data-lab-index="${escapeHtml(String(blockIndex))}">
        <div class="lp-lab-head">
          <div>
            <div class="lp-lab-kicker">交互图表</div>
            <h3>${escapeHtml(title)}</h3>
            ${description ? `<p>${escapeHtml(description)}</p>` : ""}
          </div>
          <span class="lp-chart-status" data-chart-status>正在构建图表</span>
        </div>
        ${renderChartExperimentPrediction(config)}
        ${parameters.length ? `
          <div class="lp-chart-controls">
            ${renderLearningLabControls(parameters, "", "拖动参数，图表将实时更新")}
          </div>
        ` : ""}
        <div class="lp-chart-stage" data-chart-stage role="img" aria-label="${escapeHtml(title)}" style="height:${escapeHtml(String(height))}px"></div>
        <div class="lp-chart-conclusion" data-chart-conclusion ${config.prediction_prompt ? "hidden" : ""}>
          <strong>观察结论</strong>
          <span>${escapeHtml(String(config.conclusion || ""))}</span>
        </div>
      </section>
    `;
}


function getChartExperimentValues(node, config) {
    const values = {};
    const parameters = Array.isArray(config.parameters) ? config.parameters : [];

    parameters.forEach((parameter) => {
        const key = String(parameter && parameter.key || "").trim();

        if (!key) {
            return;
        }

        const input = findLearningLabDataNode(node, "data-lab-param", key);
        const rawValue = input instanceof HTMLInputElement ? input.value : parameter.value;
        const value = Number(rawValue);

        if (!Number.isFinite(value)) {
            throw new Error(`参数 ${key} 不是有效数字`);
        }

        values[key] = value;

        const valueNode = findLearningLabDataNode(node, "data-lab-value", key);

        if (valueNode) {
            const unit = String(parameter.unit || "").trim();
            valueNode.textContent = `${Number(value.toFixed(4))}${unit ? ` ${unit}` : ""}`;
        }
    });

    return values;
}


function requireChartExperimentInteger(value, label, maximum) {
    const number = Number(value);

    if (!Number.isInteger(number) || number < 1 || number > maximum) {
        throw new Error(`${label} 必须是 1 到 ${maximum} 之间的整数`);
    }

    return number;
}


function buildChartExperimentSource(source, values) {
    const sourceType = String(source && source.type || "").trim();

    if (sourceType === "xy") {
        const xMin = Number(source.x_min);
        const xMax = Number(source.x_max);
        const step = Number(source.step);

        if (![xMin, xMax, step].every(Number.isFinite) || xMax <= xMin || step <= 0) {
            throw new Error(`数据源 ${source.id} 的 x 轴范围无效`);
        }

        const pointCount = Math.floor((xMax - xMin) / step) + 1;

        if (pointCount > 600) {
            throw new Error(`数据源 ${source.id} 超过 600 个数据点`);
        }

        return Array.from({ length: pointCount }, (_item, index) => {
            const x = Number((xMin + index * step).toPrecision(12));
            const y = evaluateLabExpression(String(source.y || "").replace(/^=/, ""), values, { x, i: index });

            return [x, y];
        });
    }

    if (sourceType === "sequence") {
        const count = requireChartExperimentInteger(source.count, `数据源 ${source.id} 的 count`, 600);

        return Array.from({ length: count }, (_item, index) => (
            evaluateLabExpression(String(source.value || "").replace(/^=/, ""), values, { i: index })
        ));
    }

    if (sourceType === "matrix") {
        const rows = requireChartExperimentInteger(source.rows, `数据源 ${source.id} 的 rows`, 64);
        const columns = requireChartExperimentInteger(source.columns, `数据源 ${source.id} 的 columns`, 64);

        if (rows * columns > 1600) {
            throw new Error(`数据源 ${source.id} 超过 1600 个矩阵单元`);
        }

        const points = [];

        for (let row = 0; row < rows; row += 1) {

            for (let column = 0; column < columns; column += 1) {
                const value = evaluateLabExpression(
                    String(source.value || "").replace(/^=/, ""),
                    values,
                    { i: row, j: column },
                );
                points.push([column, row, value]);
            }
        }

        return points;
    }

    throw new Error(`数据源类型未注册：${sourceType || "未填写"}`);
}


function buildChartExperimentSources(config, values) {
    const sources = {};
    const definitions = Array.isArray(config.data_sources) ? config.data_sources : [];

    definitions.forEach((source) => {
        const sourceId = String(source && source.id || "").trim();

        if (!sourceId) {
            throw new Error("图表数据源缺少 id");
        }

        sources[sourceId] = buildChartExperimentSource(source, values);
    });

    return sources;
}


function resolveChartExperimentOptionValue(value, values, sources, extraValues) {
    if (Array.isArray(value)) {
        return value.map((item) => resolveChartExperimentOptionValue(item, values, sources, extraValues));
    }

    if (value && typeof value === "object") {
        const keys = Object.keys(value);

        if (keys.length === 1 && keys[0] === "$source") {
            const sourceId = String(value.$source || "").trim();

            if (!Object.prototype.hasOwnProperty.call(sources, sourceId)) {
                throw new Error(`图表引用了未生成的数据源：${sourceId}`);
            }

            return sources[sourceId].map((item) => Array.isArray(item) ? item.slice() : item);
        }

        const resolved = {};

        keys.forEach((key) => {
            resolved[key] = resolveChartExperimentOptionValue(value[key], values, sources, extraValues);
        });

        return resolved;
    }

    if (typeof value !== "string") {
        return value;
    }

    const text = value.trim();

    if (text.startsWith("=")) {
        return evaluateLabExpression(text.slice(1), values, extraValues);
    }

    return resolveLabText(value, values, extraValues);
}


function applyChartExperimentTheme(option) {
    const themed = Object.assign({}, option);
    themed.backgroundColor = "transparent";
    themed.color = Array.isArray(themed.color) && themed.color.length
        ? themed.color
        : ["#2563eb", "#111827", "#64748b", "#dc2626", "#0f766e", "#7c3aed"];
    themed.textStyle = Object.assign({
        color: "#111827",
        fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
    }, themed.textStyle || {});
    themed.animationDuration = Number.isFinite(Number(themed.animationDuration))
        ? Number(themed.animationDuration)
        : 240;
    themed.aria = Object.assign({ enabled: true }, themed.aria || {});

    return themed;
}


function describeChartExperiment(config, sources) {
    const series = Array.isArray(config.option && config.option.series) ? config.option.series : [];
    const types = Array.from(new Set(series.map((item) => String(item && item.type || "").trim()).filter(Boolean)));
    const pointCount = Object.values(sources).reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0);
    const typeText = types.length ? types.join(" / ") : "chart";

    return `${typeText} · ${series.length} 个系列${pointCount ? ` · ${pointCount} 个生成数据点` : ""}`;
}


function bindChartExperimentLab(node) {
    const config = decodeLearningLabConfig(node);
    const stage = node.querySelector("[data-chart-stage]");
    const statusNode = node.querySelector("[data-chart-status]");
    const resultNode = node.querySelector("[data-lab-result]");
    const conclusionNode = node.querySelector("[data-chart-conclusion]");

    if (!(stage instanceof HTMLElement)) {
        throw new Error("图表容器不存在");
    }

    const chart = window.echarts.init(stage, null, { renderer: "canvas" });
    let frameId = 0;

    const render = () => {
        frameId = 0;

        try {
            const values = getChartExperimentValues(node, config);
            const sources = buildChartExperimentSources(config, values);
            const option = resolveChartExperimentOptionValue(
                config.option,
                values,
                sources,
                { W: stage.clientWidth, H: stage.clientHeight },
            );
            chart.setOption(applyChartExperimentTheme(option), true);
            node.classList.remove("is-invalid");

            if (statusNode) {
                statusNode.textContent = describeChartExperiment(config, sources);
            }

            if (resultNode) {
                resultNode.textContent = Object.keys(values).length
                    ? "参数已应用，图表已实时更新"
                    : "图表已渲染";
            }
        } catch (error) {
            node.classList.add("is-invalid");

            if (statusNode) {
                statusNode.textContent = "图表配置错误";
            }

            if (resultNode) {
                resultNode.textContent = String(error && error.message || "图表渲染失败");
            }

            console.error("[NexoraLearning] chart_experiment render failed", error, config);
        }
    };

    const scheduleRender = () => {

        if (frameId) {
            window.cancelAnimationFrame(frameId);
        }

        frameId = window.requestAnimationFrame(render);
    };

    node.querySelectorAll("[data-lab-param]").forEach((input) => {
        input.addEventListener("input", scheduleRender);
    });

    node.querySelectorAll("[data-chart-prediction]").forEach((button) => {
        button.addEventListener("click", () => {
            const selectedId = String(button.getAttribute("data-chart-prediction") || "");
            const correctId = String(config.correct_prediction || "");
            const isCorrect = selectedId === correctId;

            node.querySelectorAll("[data-chart-prediction]").forEach((item) => {
                const selected = item === button;
                item.classList.toggle("is-selected", selected);
                item.setAttribute("aria-pressed", selected ? "true" : "false");
            });

            if (conclusionNode) {
                conclusionNode.hidden = false;
                conclusionNode.classList.toggle("is-correct", isCorrect);
                conclusionNode.innerHTML = `
                  <strong>${isCorrect ? "预测正确" : "根据图表修正判断"}</strong>
                  <span>${escapeHtml(String(config.conclusion || ""))}</span>
                `;
            }
        });
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(stage);
    render();

    state.lpLabCleanups.push(() => {

        if (frameId) {
            window.cancelAnimationFrame(frameId);
        }

        resizeObserver.disconnect();
        chart.dispose();
    });
}
