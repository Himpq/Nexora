// ─────── Learner Profile Center ─────────────────────────────────────
// 画像中心为纯展示页：左侧六维雷达图，右侧数据解析 + 数据内容。
// 评估交互已迁移到宿主 Learning Sidebar 新建对话（选项式快速评估）。

  let profileCenterRadarChart = null;
  let profileCenterPollTimer = null;

  function profileCenterScoreRows() {
    const scores = state.profileCenter && Array.isArray(state.profileCenter.scores)
      ? state.profileCenter.scores
      : [];
    return scores.filter((item) => item && typeof item === "object");
  }

  function profileCenterSignature(payload) {
    const scores = payload && Array.isArray(payload.scores)
      ? payload.scores
      : [];
    const scorePart = scores
      .map((item) => `${item && item.key}:${item ? item.score : ""}:${item ? item.confidence : ""}`)
      .join("|");
    return `${payload && payload.updated_at ? payload.updated_at : 0}#${scorePart}`;
  }

  function renderProfileCenterRadar() {
    if (!el.profileCenterRadar || !el.profileCenterRadarEmpty) return;

    const scores = profileCenterScoreRows();
    const complete = scores.length === 6 && scores.every((item) => Number.isInteger(item.score));
    el.profileCenterRadarEmpty.hidden = complete;
    el.profileCenterRadar.hidden = !complete;

    if (!complete) {
      if (profileCenterRadarChart) {
        profileCenterRadarChart.dispose();
        profileCenterRadarChart = null;
      }

      return;
    }

    if (!window.echarts) {
      throw new Error("ECharts 未加载，无法绘制六维画像");
    }

    if (!profileCenterRadarChart) {
      profileCenterRadarChart = window.echarts.init(el.profileCenterRadar);
    }

    profileCenterRadarChart.setOption({
      animationDuration: 520,
      animationEasing: "cubicOut",
      tooltip: { trigger: "item" },
      radar: {
        shape: "polygon",
        radius: "64%",
        splitNumber: 4,
        indicator: scores.map((item) => ({ name: item.name, max: 100 })),
        axisName: { color: "#475467", fontSize: 12 },
        axisLine: { lineStyle: { color: "#e7e7e7" } },
        splitLine: { lineStyle: { color: ["#e7e7e7"] } },
        splitArea: { areaStyle: { color: ["#fafafa", "#f4f5f7"] } },
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { color: "#111111", width: 2 },
          itemStyle: { color: "#111111" },
          areaStyle: { color: "rgba(17, 17, 17, 0.08)" },
          data: [{ name: "学习画像", value: scores.map((item) => item.score) }],
        },
      ],
    }, true);
    profileCenterRadarChart.resize();
  }

  function renderProfileCenterScores() {
    if (!el.profileCenterScores) return;

    const scores = profileCenterScoreRows();
    el.profileCenterScores.innerHTML = scores.map((item) => {
      const scored = Number.isInteger(item.score);
      const scoreText = scored ? String(item.score) : "待评估";
      const confidenceText = scored && typeof item.confidence === "number"
        ? `置信度 ${Math.round(item.confidence * 100)}%`
        : "尚未评估";
      const width = scored ? Math.max(0, Math.min(100, item.score)) : 0;

      return `
        <article class="profile-score-row${scored ? "" : " is-pending"}">
          <div class="profile-score-head">
            <strong>${escapeHtml(String(item.name || ""))}</strong>
            <span>${scoreText}</span>
          </div>
          <div class="profile-score-track"><span style="width:${width}%"></span></div>
          <p>${escapeHtml(String(item.evidence || "完成快速评估后生成依据"))}</p>
          <small>${confidenceText}</small>
        </article>
      `;
    }).join("");
  }

  function renderProfileCenterFacts() {
    if (!el.profileCenterFacts) return;

    const dimensions = state.profileCenter && state.profileCenter.dimensions
      && typeof state.profileCenter.dimensions === "object"
      ? Object.values(state.profileCenter.dimensions)
      : [];
    const filled = dimensions.filter((item) => item && item.filled && String(item.value || "").trim());

    el.profileCenterFacts.innerHTML = filled.length
      ? filled.map((item) => `
          <article class="profile-fact-row">
            <strong>${escapeHtml(String(item.name || ""))}</strong>
            <p>${escapeHtml(String(item.value || "")).replace(/\n/g, "<br>")}</p>
          </article>
        `).join("")
      : '<div class="profile-facts-empty">评估中确认的信息会写入这里</div>';
  }

  function renderProfileCenter() {
    const payload = state.profileCenter || {};
    const scoredCount = Number(payload.scored_count || 0);
    const scoreTotal = Number(payload.score_total || 6);
    const profileFilledCount = Number(payload.profile_filled_count || 0);
    const profileTotal = Number(payload.profile_total || 8);
    const complete = scoredCount >= scoreTotal;

    if (el.profileCenterCompletion) {
      el.profileCenterCompletion.textContent = `评分 ${scoredCount}/${scoreTotal} · 画像 ${profileFilledCount}/${profileTotal}`;
    }

    if (el.profileCenterUpdatedAt) {
      el.profileCenterUpdatedAt.textContent = payload.updated_at
        ? `更新于 ${formatTs(Number(payload.updated_at))}`
        : "尚未评估";
    }

    if (el.profileCenterGuideBtn) {
      el.profileCenterGuideBtn.textContent = complete ? "重新评估" : (scoredCount > 0 ? "继续评估" : "开始快速评估");
    }

    renderProfileCenterRadar();
    renderProfileCenterScores();
    renderProfileCenterFacts();
  }

  function startProfileQuickInterview() {
    const payload = state.profileCenter || {};
    const prompt = String(payload.interview_prompt || "").trim();

    if (!prompt) {
      showToast("未获取到评估指令，请刷新画像中心后重试");
      return;
    }

    emitHostPayload("nexora:profile-interview:start", {
      text: prompt,
      display: "开始六维学习画像快速评估",
    });
    showToast("已在左侧学习对话中开始快速评估，点选选项即可");
  }

  async function loadProfileCenter(options) {
    const force = !!(options && options.force);

    if (state.profileCenterLoading) return;

    if (state.profileCenter && !force) {
      renderProfileCenter();
      window.requestAnimationFrame(() => {
        if (profileCenterRadarChart) profileCenterRadarChart.resize();
      });
      return;
    }

    state.profileCenterLoading = true;

    try {
      const payload = await fetchJson("/api/frontend/profile-center");
      state.profileCenter = payload;
      renderProfileCenter();
    } finally {
      state.profileCenterLoading = false;
    }
  }

  async function refreshProfileCenterIfChanged() {
    if (state.profileCenterLoading) return;

    state.profileCenterLoading = true;

    try {
      const payload = await fetchJson("/api/frontend/profile-center");

      if (profileCenterSignature(payload) !== profileCenterSignature(state.profileCenter)) {
        state.profileCenter = payload;
        renderProfileCenter();
      }
    } finally {
      state.profileCenterLoading = false;
    }
  }

  // 评估在侧栏对话进行、画像中心保持可见，轮询保证评分写回后页面实时更新。
  function startProfileCenterPolling() {
    if (profileCenterPollTimer) return;

    profileCenterPollTimer = window.setInterval(() => {
      if (!el.profileCenterView || !el.profileCenterView.classList.contains("is-active")) return;

      void refreshProfileCenterIfChanged();
    }, 3000);
  }

  function bindProfileCenterEvents() {
    if (el.profileCenterGuideBtn) {
      el.profileCenterGuideBtn.addEventListener("click", () => {
        startProfileQuickInterview();
      });
    }

    if (el.profileCenterView) {
      el.profileCenterView.addEventListener("click", (event) => {
        const startButton = event.target.closest("[data-profile-center-start]");

        if (startButton) {
          startProfileQuickInterview();
        }
      });
    }

    window.addEventListener("resize", () => {
      if (profileCenterRadarChart && el.profileCenterView.classList.contains("is-active")) {
        profileCenterRadarChart.resize();
      }
    });

    startProfileCenterPolling();
  }
