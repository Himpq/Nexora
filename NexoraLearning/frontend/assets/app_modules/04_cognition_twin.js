  const COGNITION_TWIN_STATUS = Object.freeze({
      unknown: Object.freeze({ label: "未观测", className: "is-unknown" }),
      unverified: Object.freeze({ label: "待验证", className: "is-unverified" }),
      developing: Object.freeze({ label: "建立中", className: "is-developing" }),
      stable: Object.freeze({ label: "稳定", className: "is-stable" }),
      at_risk: Object.freeze({ label: "风险", className: "is-at-risk" })
  });

  const COGNITION_TWIN_FILTERS = Object.freeze([
      Object.freeze({ key: "all", label: "全部" }),
      Object.freeze({ key: "due", label: "待复习" }),
      Object.freeze({ key: "at_risk", label: "风险" }),
      Object.freeze({ key: "developing", label: "建立中" }),
      Object.freeze({ key: "stable", label: "稳定" })
  ]);

  function getCognitionTwinCacheKey(lectureId) {
      const normalizedLectureId = String(lectureId || "").trim();

      if (!normalizedLectureId) {
          throw new Error("认知孪生缺少课程 ID");
      }

      return normalizedLectureId;
  }

  function validateCognitionTwinOverview(overview) {
      if (!overview || typeof overview !== "object") {
          throw new Error("认知概览响应缺少 overview");
      }

      if (!overview.summary || typeof overview.summary !== "object") {
          throw new Error("认知概览响应缺少 summary");
      }

      if (!Array.isArray(overview.states)) {
          throw new Error("认知概览响应缺少 states");
      }

      const summaryFields = ["concept_count", "evidence_count", "due_review_count"];

      for (const field of summaryFields) {
          if (!Number.isInteger(overview.summary[field]) || overview.summary[field] < 0) {
              throw new Error(`认知概览字段 ${field} 无效`);
          }
      }

      if (!overview.summary.status_counts || typeof overview.summary.status_counts !== "object") {
          throw new Error("认知概览响应缺少 status_counts");
      }

      if (!Number.isInteger(overview.generated_at) || overview.generated_at < 0) {
          throw new Error("认知概览缺少有效生成时间");
      }

      for (const statusKey of Object.keys(COGNITION_TWIN_STATUS)) {
          const statusCount = overview.summary.status_counts[statusKey];

          if (!Number.isInteger(statusCount) || statusCount < 0) {
              throw new Error(`认知概览状态 ${statusKey} 数量无效`);
          }
      }

      for (const stateRow of overview.states) {
          if (!stateRow || typeof stateRow !== "object" || !stateRow.concept || typeof stateRow.concept !== "object") {
              throw new Error("认知概览包含无效概念状态");
          }

          if (!COGNITION_TWIN_STATUS[stateRow.status]) {
              throw new Error(`认知概览包含未知状态 ${String(stateRow.status || "")}`);
          }

          if (!String(stateRow.concept.concept_id || "").trim() || !String(stateRow.concept.name || "").trim()) {
              throw new Error("认知概览概念缺少 ID 或名称");
          }

          if (!Number.isInteger(stateRow.evidence_count) || stateRow.evidence_count < 0) {
              throw new Error("认知概览包含无效证据数量");
          }

          for (const scoreField of ["mastery", "retention"]) {
              const scoreValue = stateRow[scoreField];

              if (scoreValue !== null && (typeof scoreValue !== "number" || !Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > 1)) {
                  throw new Error(`认知概览包含无效 ${scoreField}`);
              }
          }

          if (stateRow.next_review_at !== null && (!Number.isInteger(stateRow.next_review_at) || stateRow.next_review_at < 0)) {
              throw new Error("认知概览包含无效复习时间");
          }
      }

      if (overview.summary.concept_count !== overview.states.length) {
          throw new Error("认知概览概念数量与状态列表不一致");
      }

      return overview;
  }

  function formatCognitionTwinPercent(value) {
      if (value === null) {
          return "--";
      }

      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
          throw new Error("认知概览包含无效百分比");
      }

      return `${Math.round(value * 100)}%`;
  }

  function formatCognitionTwinReviewTime(timestamp) {
      if (timestamp === null) {
          return "";
      }

      if (!Number.isInteger(timestamp) || timestamp < 0) {
          throw new Error("认知概览包含无效复习时间");
      }

      const date = new Date(timestamp * 1000);

      if (Number.isNaN(date.getTime())) {
          throw new Error("认知概览包含无法解析的复习时间");
      }

      return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function isCognitionTwinReviewDue(stateRow, generatedAt) {
      if (stateRow.next_review_at === null) {
          return false;
      }

      if (!Number.isInteger(generatedAt) || generatedAt < 0) {
          throw new Error("认知概览缺少有效生成时间");
      }

      return stateRow.next_review_at <= generatedAt;
  }

  function getCognitionTwinVisibleStates(overview, filterKey) {
      if (filterKey === "all") {
          return overview.states.slice();
      }

      if (filterKey === "due") {
          return overview.states.filter((stateRow) => isCognitionTwinReviewDue(stateRow, overview.generated_at));
      }

      if (!COGNITION_TWIN_STATUS[filterKey]) {
          throw new Error(`未知认知孪生筛选条件 ${filterKey}`);
      }

      return overview.states.filter((stateRow) => stateRow.status === filterKey);
  }

  function buildCognitionTwinDistributionHtml(overview) {
      const conceptCount = overview.summary.concept_count;
      const segments = Object.entries(COGNITION_TWIN_STATUS).map(([statusKey, statusDefinition]) => {
          const count = overview.summary.status_counts[statusKey];
          const width = conceptCount > 0 ? (count / conceptCount) * 100 : 0;

          return `<span class="cognition-twin-distribution-segment ${statusDefinition.className}" style="width:${width}%" title="${statusDefinition.label} ${count}"></span>`;
      }).join("");
      const legend = Object.entries(COGNITION_TWIN_STATUS).map(([statusKey, statusDefinition]) => {
          const count = overview.summary.status_counts[statusKey];

          return `<span class="cognition-twin-legend-item"><i class="${statusDefinition.className}"></i>${statusDefinition.label}<strong>${count}</strong></span>`;
      }).join("");

      return `
          <section class="cognition-twin-distribution" aria-label="认知状态分布">
              <div class="cognition-twin-distribution-track">${segments}</div>
              <div class="cognition-twin-legend">${legend}</div>
          </section>
      `;
  }

  function buildCognitionTwinStateRowHtml(stateRow, generatedAt) {
      const concept = stateRow.concept;
      const statusDefinition = COGNITION_TWIN_STATUS[stateRow.status];
      const masteryText = formatCognitionTwinPercent(stateRow.mastery);
      const retentionText = formatCognitionTwinPercent(stateRow.retention);
      const reviewDue = isCognitionTwinReviewDue(stateRow, generatedAt);
      const reviewTime = formatCognitionTwinReviewTime(stateRow.next_review_at);
      const evidenceCount = stateRow.evidence_count;
      const conceptPath = String(concept.path || concept.chapter_name || "").trim();

      return `
          <article class="cognition-twin-concept-row">
              <div class="cognition-twin-concept-main">
                  <div class="cognition-twin-concept-name">${escapeHtml(String(concept.name))}</div>
                  <div class="cognition-twin-concept-path">${escapeHtml(conceptPath)}</div>
              </div>
              <span class="cognition-twin-status ${statusDefinition.className}">${statusDefinition.label}</span>
              <div class="cognition-twin-measure">
                  <span>掌握</span>
                  <strong>${masteryText}</strong>
              </div>
              <div class="cognition-twin-measure">
                  <span>保持</span>
                  <strong>${retentionText}</strong>
              </div>
              <div class="cognition-twin-evidence-count">${evidenceCount} 条证据</div>
              <div class="cognition-twin-review${reviewDue ? " is-due" : ""}">${reviewDue ? "待复习" : escapeHtml(reviewTime)}</div>
          </article>
      `;
  }

  function buildCognitionTwinConceptListHtml(overview, filterKey) {
      const visibleStates = getCognitionTwinVisibleStates(overview, filterKey);

      if (!visibleStates.length) {
          return '<div class="cognition-twin-empty">当前筛选下没有概念</div>';
      }

      const groups = new Map();

      for (const stateRow of visibleStates) {
          const chapterName = String(stateRow.concept.chapter_name || "未分章概念").trim();

          if (!groups.has(chapterName)) {
              groups.set(chapterName, []);
          }

          groups.get(chapterName).push(stateRow);
      }

      return Array.from(groups.entries()).map(([chapterName, stateRows]) => `
          <section class="cognition-twin-chapter">
              <header class="cognition-twin-chapter-head">
                  <h3>${escapeHtml(chapterName)}</h3>
                  <span>${stateRows.length}</span>
              </header>
              <div class="cognition-twin-concept-list">
                  ${stateRows.map((stateRow) => buildCognitionTwinStateRowHtml(stateRow, overview.generated_at)).join("")}
              </div>
          </section>
      `).join("");
  }

  function renderCognitionTwinOverview(container, lectureId, overview) {
      const cacheKey = getCognitionTwinCacheKey(lectureId);
      const filterKey = state.cognitionTwinFilters[cacheKey] || "all";
      const summary = overview.summary;

      container.innerHTML = `
          <div class="cognition-twin">
              <header class="cognition-twin-overview-head">
                  <div class="cognition-twin-summary">
                      <div class="cognition-twin-summary-primary">
                          <strong>${summary.concept_count}</strong>
                          <span>概念节点</span>
                      </div>
                      <div class="cognition-twin-summary-item">
                          <strong>${summary.evidence_count}</strong>
                          <span>认知证据</span>
                      </div>
                      <div class="cognition-twin-summary-item${summary.due_review_count > 0 ? " is-due" : ""}">
                          <strong>${summary.due_review_count}</strong>
                          <span>待复习</span>
                      </div>
                  </div>
                  <button class="cognition-twin-refresh" type="button" data-cognition-action="refresh" title="刷新认知状态" aria-label="刷新认知状态">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg>
                  </button>
              </header>
              ${buildCognitionTwinDistributionHtml(overview)}
              <nav class="cognition-twin-filters" aria-label="认知状态筛选">
                  ${COGNITION_TWIN_FILTERS.map((filter) => `<button class="cognition-twin-filter${filter.key === filterKey ? " is-active" : ""}" type="button" data-cognition-filter="${filter.key}">${filter.label}</button>`).join("")}
              </nav>
              <div class="cognition-twin-body">
                  ${buildCognitionTwinConceptListHtml(overview, filterKey)}
              </div>
          </div>
      `;

      bindCognitionTwinControls(container, lectureId);
  }

  function renderCognitionTwinError(container, lectureId, message) {
      container.innerHTML = `
          <div class="cognition-twin-message is-error">
              <strong>认知状态读取失败</strong>
              <span>${escapeHtml(String(message || "未知错误"))}</span>
              <button type="button" data-cognition-action="refresh">重新读取</button>
          </div>
      `;

      bindCognitionTwinControls(container, lectureId);
  }

  function bindCognitionTwinControls(container, lectureId) {
      const refreshButton = container.querySelector("[data-cognition-action='refresh']");

      if (refreshButton) {
          refreshButton.addEventListener("click", () => {
              void loadCourseCognitionTwin(lectureId);
          });
      }

      container.querySelectorAll("[data-cognition-filter]").forEach((button) => {
          button.addEventListener("click", () => {
              const filterKey = String(button.getAttribute("data-cognition-filter") || "").trim();
              const cacheKey = getCognitionTwinCacheKey(lectureId);
              const overview = state.cognitionOverviewCache[cacheKey];

              if (!overview) {
                  throw new Error("认知概览缓存不存在");
              }

              state.cognitionTwinFilters[cacheKey] = filterKey;
              renderCognitionTwinOverview(container, lectureId, overview);
          });
      });
  }

  /**
   * 加载当前课程的认知孪生概览。接口错误直接呈现，不使用伪造数据替代。
   */
  async function loadCourseCognitionTwin(lectureId) {
      const container = document.getElementById("courseCognitionTwinContainer");

      if (!container) {
          return;
      }

      const cacheKey = getCognitionTwinCacheKey(lectureId);
      container.dataset.lectureId = cacheKey;
      container.innerHTML = '<div class="cognition-twin-loading">正在读取认知状态...</div>';

      try {
          const data = await fetchJson(`/api/frontend/cognition/overview?lecture_id=${encodeURIComponent(cacheKey)}`);

          if (String(container.dataset.lectureId || "") !== cacheKey) {
              return;
          }

          if (data.success !== true) {
              throw new Error("认知概览接口未返回成功状态");
          }

          const overview = validateCognitionTwinOverview(data.overview);
          state.cognitionOverviewCache[cacheKey] = overview;
          renderCognitionTwinOverview(container, cacheKey, overview);
      } catch (error) {
          if (String(container.dataset.lectureId || "") !== cacheKey) {
              return;
          }

          console.error("[NexoraLearning] cognition overview load failed", {
              lectureId: cacheKey,
              error
          });
          renderCognitionTwinError(container, cacheKey, error && error.message ? error.message : "未知错误");
      }
  }
