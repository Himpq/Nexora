(function () {
  "use strict";

  const el = {
    progressList: document.getElementById("progressList"),
    timePieChart: document.getElementById("timePieChart"),
    userProfileCard: document.getElementById("userProfileCard"),
  };

  const PIE_COLORS = ["#111111", "#373737", "#585858", "#7a7a7a", "#9d9d9d", "#bbbbbb"];

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function polarToCartesian(cx, cy, radius, angleDeg) {
    const angleRad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(angleRad),
      y: cy + radius * Math.sin(angleRad),
    };
  }

  function donutPath(cx, cy, outerR, innerR, startAngle, endAngle) {
    const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
    const outerEnd = polarToCartesian(cx, cy, outerR, endAngle);
    const innerStart = polarToCartesian(cx, cy, innerR, endAngle);
    const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerStart.x} ${innerStart.y}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
      "Z",
    ].join(" ");
  }

  function buildSampleCourses() {
    const rows = [
      {
        id: "course-product-design",
        name: "产品设计方法",
        progress: 72,
        studyHours: 14.5,
        chapterCurrent: "第 6 章 · 任务流设计",
        chapterNext: "第 7 章 · 原型验证",
      },
      {
        id: "course-ml-intro",
        name: "机器学习导论",
        progress: 48,
        studyHours: 9.2,
        chapterCurrent: "第 4 章 · 线性回归",
        chapterNext: "第 5 章 · 分类边界",
      },
      {
        id: "course-english-reading",
        name: "英文阅读训练",
        progress: 31,
        studyHours: 6.8,
        chapterCurrent: "第 2 章 · 长难句拆解",
        chapterNext: "第 3 章 · 学术段落速读",
      },
      {
        id: "course-history-notes",
        name: "世界史整理",
        progress: 84,
        studyHours: 18.1,
        chapterCurrent: "第 9 章 · 工业革命专题",
        chapterNext: "第 10 章 · 近代国家形成",
      },
      {
        id: "course-data-analysis",
        name: "数据分析基础",
        progress: 56,
        studyHours: 7.4,
        chapterCurrent: "第 5 章 · 描述统计",
        chapterNext: "第 6 章 · 可视化表达",
      },
      {
        id: "course-frontend-system",
        name: "前端工程体系",
        progress: 63,
        studyHours: 11.3,
        chapterCurrent: "第 7 章 · 构建链路",
        chapterNext: "第 8 章 · 性能优化",
      },
      {
        id: "course-writing",
        name: "写作表达训练",
        progress: 27,
        studyHours: 5.6,
        chapterCurrent: "第 2 章 · 观点展开",
        chapterNext: "第 3 章 · 论证结构",
      },
      {
        id: "course-economy",
        name: "经济学入门",
        progress: 39,
        studyHours: 8.7,
        chapterCurrent: "第 3 章 · 供需关系",
        chapterNext: "第 4 章 · 市场结构",
      },
    ];

    return rows.map((item, index) => ({
      ...item,
      color: PIE_COLORS[index % PIE_COLORS.length],
    }));
  }

  function renderProgressList(courses) {
    el.progressList.innerHTML = courses
      .map(
        (course) => `
          <article class="nxl-course-item is-open" data-course-id="${escapeHtml(course.id)}">
            <div class="nxl-course-toggle">
              <div class="nxl-course-top">
                <div class="nxl-course-main">
                  <p class="nxl-course-title">${escapeHtml(course.name)}</p>
                  <p class="nxl-course-meta">当前学习到 ${escapeHtml(course.chapterCurrent)}</p>
                </div>
                <span class="nxl-course-percent">${course.progress}%</span>
              </div>
              <div class="nxl-course-bar-row">
                <div class="nxl-course-bar">
                  <div class="nxl-course-bar-fill" style="width:${course.progress}%"></div>
                </div>
                <span class="nxl-course-stage">下一章 ${escapeHtml(course.chapterNext)}</span>
              </div>
            </div>
          </article>
        `
      )
      .join("");
  }

  function renderUserProfile() {
    el.userProfileCard.innerHTML = `
      <div class="user-profile-avatar" aria-hidden="true">NL</div>
      <div class="user-profile-meta">
        <div class="user-profile-name">Sample Learner</div>
        <div class="user-profile-line">学习天数 · 128 天</div>
        <div class="user-profile-line">本周完成 · 4 节课程</div>
        <div class="user-profile-line">连续学习 · 9 天</div>
      </div>
    `;
  }

  function renderPie(courses) {
    const visibleCourses = courses.slice(0, 6);
    const total = visibleCourses.reduce((sum, course) => sum + course.studyHours, 0);
    const cx = 192;
    const cy = 148;
    const outer = 94;
    const inner = 50;
    let currentAngle = 0;

    const segments = visibleCourses.map((course) => {
      const value = Number(course.studyHours || 0);
      const angle = total > 0 ? (value / total) * 360 : 0;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      const midAngle = startAngle + angle / 2;
      currentAngle = endAngle;

      const anchor = polarToCartesian(cx, cy, outer + 14, midAngle);
      const bend = polarToCartesian(cx, cy, outer + 34, midAngle);
      const isRight = bend.x >= cx;
      const labelX = isRight ? 332 : 48;
      const textAnchor = isRight ? "start" : "end";

      return {
        ...course,
        id: `seg-${course.id}`,
        path: donutPath(cx, cy, outer, inner, startAngle, endAngle),
        labelLine: {
          x1: anchor.x,
          y1: anchor.y,
          x2: bend.x,
          y2: bend.y,
          x3: labelX,
          y3: bend.y,
        },
        labelX,
        labelY: bend.y - 6,
        subY: bend.y + 12,
        textAnchor,
        offsetX: Math.cos(((midAngle - 90) * Math.PI) / 180) * 8,
        offsetY: Math.sin(((midAngle - 90) * Math.PI) / 180) * 8,
      };
    });

    el.timePieChart.innerHTML = `
      <svg class="nxl-pie-svg" viewBox="0 0 380 300" role="img" aria-label="学习时间占比">
        ${segments
          .map(
            (segment) => `
              <g class="nxl-pie-segment" data-segment-id="${escapeHtml(segment.id)}">
                <path d="${segment.path}" fill="${segment.color}"></path>
              </g>
            `
          )
          .join("")}
        <circle cx="${cx}" cy="${cy}" r="${inner - 1}" fill="#ffffff"></circle>
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" class="nxl-pie-center-label">sample</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" class="nxl-pie-center-value">${escapeHtml(`${total.toFixed(1)}h`)}</text>
        ${segments
          .map(
            (segment) => `
              <g class="nxl-pie-callout" data-segment-id="${escapeHtml(segment.id)}">
                <polyline points="${segment.labelLine.x1},${segment.labelLine.y1} ${segment.labelLine.x2},${segment.labelLine.y2} ${segment.labelLine.x3},${segment.labelLine.y3}"></polyline>
                <text x="${segment.labelX}" y="${segment.labelY}" text-anchor="${segment.textAnchor}">${escapeHtml(segment.name)}</text>
                <text x="${segment.labelX}" y="${segment.subY}" text-anchor="${segment.textAnchor}" class="nxl-pie-callout-sub">${escapeHtml(`${Math.round((segment.studyHours / total) * 100)}% · ${segment.progress}% 进度`)}</text>
              </g>
            `
          )
          .join("")}
      </svg>
    `;

    const segmentEls = Array.from(el.timePieChart.querySelectorAll(".nxl-pie-segment"));
    const calloutEls = Array.from(el.timePieChart.querySelectorAll(".nxl-pie-callout"));

    function setActive(segmentId) {
      segmentEls.forEach((node) => {
        const active = node.getAttribute("data-segment-id") === segmentId;
        node.classList.toggle("is-active", active);
        const path = node.querySelector("path");
        if (!path) return;
        const segment = segments.find((item) => item.id === node.getAttribute("data-segment-id"));
        if (!segment) return;
        path.style.transform = active ? `translate(${segment.offsetX}px, ${segment.offsetY}px) scale(1.035)` : "";
      });

      calloutEls.forEach((node) => {
        node.classList.toggle("is-active", node.getAttribute("data-segment-id") === segmentId);
      });
    }

    function clearActive() {
      segmentEls.forEach((node) => {
        node.classList.remove("is-active");
        const path = node.querySelector("path");
        if (path) path.style.transform = "";
      });
      calloutEls.forEach((node) => node.classList.remove("is-active"));
    }

    segmentEls.forEach((node) => {
      node.addEventListener("mouseenter", () => setActive(node.getAttribute("data-segment-id") || ""));
      node.addEventListener("mouseleave", clearActive);
    });

    calloutEls.forEach((node) => {
      node.addEventListener("mouseenter", () => setActive(node.getAttribute("data-segment-id") || ""));
      node.addEventListener("mouseleave", clearActive);
    });
  }

  function renderSample() {
    const courses = buildSampleCourses();
    renderProgressList(courses);
    renderPie(courses);
    renderUserProfile();
  }

  renderSample();
})();
