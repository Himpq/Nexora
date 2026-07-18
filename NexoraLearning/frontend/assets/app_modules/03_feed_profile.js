// ─────── Feed Rendering & Compose ─────────────────────────────────────

  /**
   * 渲染左侧频道列表
   */
  function renderFeedChannelList() {
      if (!el.feedChannelList) return;

      const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
      const selectedId = String(state.selectedFeedChannelId || "public_all");

      const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
      const allIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"></path></svg>`;
      const channelIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v11H9l-4 3Z"></path></svg>`;

      const seenChannelIds = new Set();
      const channelItems = [
          { id: "public_all", title: "所有动态", builtin: true },
          ...channels
      ].reduce((rows, row) => {
          const channelId = String((row && row.id) || "").trim();

          if (!channelId || seenChannelIds.has(channelId)) {
              return rows;
          }

          seenChannelIds.add(channelId);
          rows.push(Object.assign({}, row, {
              id: channelId,
              title: channelId === "public_all" ? "所有动态" : String((row && row.title) || channelId).trim(),
          }));
          return rows;
      }, []);

      const channelRows = channelItems.map((row) => {
          const channelId = String((row && row.id) || "").trim();
          const channelTitle = String((row && row.title) || "").trim();
          const isActive = channelId === selectedId;
          const isBuiltin = !!(row && row.builtin);

          return `
              <div class="feed-channel-item${isActive ? " is-active" : ""}" data-channel-id="${escapeHtml(channelId)}">
                  <button class="feed-channel-select-btn" type="button" data-feed-channel-select data-channel-id="${escapeHtml(channelId)}" aria-current="${isActive ? "true" : "false"}">
                      <span class="feed-channel-item-icon">${isBuiltin ? allIcon : channelIcon}</span>
                      <span class="feed-channel-item-name">${escapeHtml(channelTitle)}</span>
                  </button>
                  ${!isBuiltin ? `
                      <button class="feed-channel-action-btn" type="button" data-action="edit-channel" data-channel-id="${escapeHtml(channelId)}" title="编辑频道" aria-label="编辑频道 ${escapeHtml(channelTitle)}">${editIcon}</button>
                  ` : ""}
              </div>
          `;
      }).join("");

      el.feedChannelList.innerHTML = `
          <div class="feed-channel-rail-head">
              <span>频道</span>
              <strong>${channelItems.length}</strong>
          </div>
          <nav class="feed-channel-rail" aria-label="动态频道">
              ${channelRows}
          </nav>
      `;
  }

  /**
   * 渲染动态内容列表
   */
  function renderLearningFeeds() {
      if (!el.learningFeedPanel) return;

      if (el.progressList) el.progressList.hidden = state.dashboardSideTab !== "progress";
      if (el.learningPushPanel) el.learningPushPanel.hidden = state.dashboardSideTab !== "push";
      if (el.questionBankPanel) el.questionBankPanel.hidden = state.dashboardSideTab !== "questionBank";
      if (el.feedLayout) el.feedLayout.hidden = state.dashboardSideTab !== "feed";
      if (el.learningFeedComposeShell) el.learningFeedComposeShell.hidden = state.dashboardSideTab !== "feed";

      if (state.dashboardSideTab !== "feed") {
          if (state.dynamicPosting) exitLearningFeedComposeMode();
          return;
      }

      renderFeedChannelList();
      syncLearningFeedComposer();

      const rows = Array.isArray(state.learningFeeds) ? state.learningFeeds : [];
      if (!rows.length) {
          el.learningFeedPanel.innerHTML = '<div class="materials-empty">暂无学习动态</div>';
          return;
      }

      el.learningFeedPanel.innerHTML = `
          <div class="feed-stream-list">
              ${rows.slice(0, 20).map((row) => {
                  const username = getFeedAuthorName(row);
                  const handle = getFeedAuthorHandle(row);
                  const avatar = getFeedAuthorInitial(row);
                  const avatarUrl = getFeedAuthorAvatarUrl(row);
                  const summary = String(row.summary || row.content || "").trim() || "暂无内容";
                  const summaryHtml = renderTextWithMentions(summary);
                  const liked = Array.isArray(row.liked_user_ids) && row.liked_user_ids.includes(state.username);
                  const likesCount = Math.max(0, Number(row.likes_count) || 0);
                  const commentsCount = Math.max(0, Number(row.comments_count) || 0);
                  const timeText = formatFeedRelativeTime(row.timestamp);
                  const feedId = String(row.id || "").trim();
                  const expanded = !!state.feedExpandedMap[feedId];
                  const comments = Array.isArray(row.comments) ? row.comments : [];
                  const draft = String(state.feedCommentDrafts[feedId] || "");
                  const isAdminAuthor = !!row.author_is_admin;
                  const canDeleteFeed = !!row.can_delete;
                  const mentionState = state.feedMentionState && state.feedMentionState.key === `comment:${feedId}` ? state.feedMentionState : null;
                  const likeIcon = `
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M7 10h4l2-5c.2-.5.7-.8 1.2-.8.9 0 1.6.7 1.6 1.6v2.2h2.7c1.2 0 2.1 1.1 1.8 2.3l-1.4 7A2 2 0 0 1 17.7 19H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                          <path d="M4 10h3v9H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                      </svg>
                  `;
                  const commentIcon = `
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4 3v-3H7.5A2.5 2.5 0 0 1 5 12.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                      </svg>
                  `;
                  const timeIcon = `
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/>
                          <path d="M12 7.8v4.6l3.2 1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                  `;
                  const verifiedIcon = `
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <circle cx="12" cy="12" r="9" fill="#2563eb"/>
                          <path d="M8 12.3l2.3 2.3 5-5" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                  `;
                  const trashIcon = renderTrashIcon();
                  const renderComments = expanded ? `
                      <div class="feed-comments">
                          <div class="feed-comment-compose">
                              <div class="feed-comment-compose-main">
                                  <input class="feed-comment-input" type="text" data-feed-comment-input="${escapeHtml(feedId)}" placeholder="发表评论..." value="${escapeHtml(draft)}" autocomplete="off">
                                  <div class="feed-mention-menu" data-feed-mention-menu="${escapeHtml(feedId)}" hidden style="display:none"></div>
                              </div>
                              <button class="feed-comment-send" type="button" data-feed-action="comment-send" data-feed-id="${escapeHtml(feedId)}" aria-label="发送评论" title="发送评论">
                                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                      <path d="M4 11.5L20 4l-4.6 16-3.1-5.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                                  </svg>
                              </button>
                          </div>
                          <div class="feed-comment-list">
                              ${comments.length ? comments.map((comment) => {
                                  const commentAuthor = getFeedAuthorName(comment);
                                  const commentHandle = getFeedAuthorHandle(comment);
                                  const commentAvatar = getFeedAuthorAvatarUrl(comment);
                                  const commentInitial = getFeedAuthorInitial(comment);
                                  const commentTime = formatFeedRelativeTime(comment.timestamp);
                                  const isAdminCommentAuthor = !!comment.author_is_admin;
                                  const canDeleteComment = !!comment.can_delete;
                                  const commentId = String(comment.id || "").trim();
                                  return `
                                      <div class="feed-comment-item">
                                          ${commentAvatar
                                              ? `<img class="feed-comment-avatar feed-comment-avatar-image" src="${escapeHtml(commentAvatar)}" alt="${escapeHtml(commentAuthor)}">`
                                              : `<div class="feed-comment-avatar">${escapeHtml(commentInitial)}</div>`}
                                          <div class="feed-comment-main">
                                              <div class="feed-comment-head">
                                                  <span class="feed-comment-author">${escapeHtml(commentAuthor)}</span>
                                                  ${isAdminCommentAuthor ? `<span class="feed-item-verified feed-comment-verified" title="管理员">${verifiedIcon}</span>` : ""}
                                                  ${commentHandle ? `<span class="feed-comment-handle">@${escapeHtml(commentHandle)}</span>` : ""}
                                                  ${commentTime ? `<span class="feed-comment-time">${escapeHtml(commentTime)}</span>` : ""}
                                                  ${canDeleteComment ? `<button class="feed-comment-delete" type="button" data-feed-action="comment-delete" data-feed-id="${escapeHtml(feedId)}" data-comment-id="${escapeHtml(commentId)}" aria-label="删除评论" title="删除评论">${trashIcon}</button>` : ""}
                                              </div>
                                              <div class="feed-comment-content">${renderTextWithMentions(String(comment.content || "").trim())}</div>
                                              <div class="feed-comment-actions">
                                                  <button class="feed-comment-action-btn ${Array.isArray(comment.liked_user_ids) && comment.liked_user_ids.includes(state.username) ? "is-active" : ""}" type="button" data-feed-action="comment-like" data-feed-id="${escapeHtml(feedId)}" data-comment-id="${escapeHtml(commentId)}" aria-label="点赞评论" title="点赞评论">
                                                      <span class="feed-action-icon">${likeIcon}</span>
                                                      <span class="feed-action-count">${Math.max(0, Number(comment.likes_count) || 0)}</span>
                                                  </button>
                                                  <button class="feed-comment-action-btn" type="button" data-feed-action="comment-reply" data-feed-id="${escapeHtml(feedId)}" data-comment-id="${escapeHtml(commentId)}" data-comment-username="${escapeHtml(commentHandle || String((comment && comment.author && comment.author.user_id) || ''))}" aria-label="回复评论" title="回复评论">
                                                      <span class="feed-action-icon">${renderReplyIcon()}</span>
                                                      <span class="feed-action-label">回复</span>
                                                  </button>
                                              </div>
                                          </div>
                                      </div>
                                  `;
                              }).join("") : '<div class="feed-comments-empty">暂无评论</div>'}
                          </div>
                      </div>
                  ` : "";

                  return `
                      <article class="feed-item">
                          ${avatarUrl
                              ? `<img class="feed-item-avatar feed-item-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(username)}">`
                              : `<div class="feed-item-avatar">${escapeHtml(avatar)}</div>`}
                          <div class="feed-item-body">
                              <div class="feed-item-head">
                                  <div class="feed-item-author-row">
                                      <span class="feed-item-author">${escapeHtml(username)}</span>
                                      ${isAdminAuthor ? `<span class="feed-item-verified" title="管理员">${verifiedIcon}</span>` : ""}
                                      ${handle ? `<span class="feed-item-handle">@${escapeHtml(handle)}</span>` : ""}
                                      ${timeText ? `<span class="feed-item-time"><span class="feed-time-icon">${timeIcon}</span><span>${escapeHtml(timeText)}</span></span>` : ""}
                                  </div>
                              </div>
                              <div class="feed-item-summary">${summaryHtml}</div>
                              <div class="feed-item-foot">
                                  <div class="feed-item-actions">
                                      <button class="feed-action-btn ${liked ? "is-active" : ""}" type="button" data-feed-action="like" data-feed-id="${escapeHtml(String(row.id || ""))}" aria-label="点赞" title="点赞">
                                          <span class="feed-action-icon">${likeIcon}</span>
                                          <span class="feed-action-count">${likesCount}</span>
                                      </button>
                                      <button class="feed-action-btn" type="button" data-feed-action="comment-toggle" data-feed-id="${escapeHtml(feedId)}" aria-label="评论" title="展开评论" aria-expanded="${expanded ? "true" : "false"}">
                                          <span class="feed-action-icon">${commentIcon}</span>
                                          <span class="feed-action-count">${commentsCount}</span>
                                      </button>
                                      ${canDeleteFeed ? `<button class="feed-action-btn feed-action-btn-danger" type="button" data-feed-action="feed-delete" data-feed-id="${escapeHtml(feedId)}" aria-label="删除动态" title="删除动态"><span class="feed-action-icon">${trashIcon}</span></button>` : ""}
                                  </div>
                              </div>
                              ${renderComments}
                              <div class="feed-item-divider" aria-hidden="true"></div>
                          </div>
                      </article>
                  `;
              }).join("")}
          </div>
      `;
  }

  function syncDashboardSideTabs() {
    const activeTab = ["progress", "push", "questionBank", "feed"].includes(state.dashboardSideTab)
      ? state.dashboardSideTab
      : "progress";
    state.dashboardSideTab = activeTab;
    const surfacePanel = el.progressList ? el.progressList.closest(".progress-panel") : null;

    if (surfacePanel) {
      surfacePanel.setAttribute("data-dashboard-surface", activeTab);
    }
    const isProgress = activeTab === "progress";
    const isPush = activeTab === "push";
    const isQuestionBank = activeTab === "questionBank";
    const isFeed = activeTab === "feed";
    if (el.dashboardProgressTabBtn) {
      el.dashboardProgressTabBtn.classList.toggle("is-active", isProgress);
      el.dashboardProgressTabBtn.setAttribute("aria-selected", isProgress ? "true" : "false");
    }
    if (el.dashboardPushTabBtn) {
      el.dashboardPushTabBtn.classList.toggle("is-active", isPush);
      el.dashboardPushTabBtn.setAttribute("aria-selected", isPush ? "true" : "false");
    }
    if (el.dashboardQuestionBankTabBtn) {
      el.dashboardQuestionBankTabBtn.classList.toggle("is-active", isQuestionBank);
      el.dashboardQuestionBankTabBtn.setAttribute("aria-selected", isQuestionBank ? "true" : "false");
    }
    if (el.dashboardProgressFeedTabBtn) {
      el.dashboardProgressFeedTabBtn.classList.toggle("is-active", isFeed);
      el.dashboardProgressFeedTabBtn.setAttribute("aria-selected", isFeed ? "true" : "false");
    }
    if (el.openMaterialsViewBtn) {
      el.openMaterialsViewBtn.hidden = !isProgress;
    }
    if (el.dashboardFocusPanel) {
      el.dashboardFocusPanel.hidden = !isProgress;
    }
    if (el.progressList) {
      el.progressList.hidden = !isProgress;
    }
    if (el.learningPushPanel) {
      el.learningPushPanel.hidden = !isPush;
    }
    if (el.questionBankPanel) {
      el.questionBankPanel.hidden = !isQuestionBank;
    }
    if (el.feedLayout) {
      el.feedLayout.hidden = !isFeed;
    }
    renderPie();
    renderLearningPushCenter();
    renderQuestionBankCenter();
    renderLearningFeeds();
  }

  function syncPieProfileTabs() {
    state.dashboardPieTab = "profile";
    if (el.dashboardPieTabBtn) {
      el.dashboardPieTabBtn.classList.remove("is-active");
      el.dashboardPieTabBtn.setAttribute("aria-selected", "false");
    }
    if (el.dashboardProfileTabBtn) {
      el.dashboardProfileTabBtn.classList.add("is-active");
      el.dashboardProfileTabBtn.setAttribute("aria-selected", "true");
    }
    if (el.timePieChart) {
      el.timePieChart.hidden = true;
    }
    if (el.userProfileDimensions) {
      el.userProfileDimensions.hidden = false;
    }
    renderDashboardNotifications();
  }

  async function loadUserProfile() {
    try {
      const data = await fetchJson("/api/frontend/profile");
      if (data && data.success) {
        state.userProfile = data;
      }
    } catch (_err) {
      state.userProfile = null;
    }
  }

  async function loadDashboardNotifications() {
    const data = await fetchJson("/api/frontend/notifications?limit=20");
    state.notifications = Array.isArray(data.items) ? data.items : [];
    state.adminPendingParse = data.admin_pending_parse && typeof data.admin_pending_parse === "object"
      ? data.admin_pending_parse
      : { count: 0, items: [] };
  }

  async function loadQuestionBank() {
    try {
      const qs = new URLSearchParams();
      qs.set("group_mode", "chapter");
      qs.set("page", String(Math.max(1, Number(state.questionBankPage || 1))));
      qs.set("page_size", String(Math.max(1, Number(state.questionBankPageSize || 5))));
      if (state.questionBankFilter.lectureId && state.questionBankFilter.lectureId !== "all") {
        qs.set("lecture_id", state.questionBankFilter.lectureId);
      }
      if (state.questionBankFilter.answerState && state.questionBankFilter.answerState !== "all") {
        qs.set("answer_state", state.questionBankFilter.answerState);
      }
      if (state.questionBankFilter.questionType && state.questionBankFilter.questionType !== "all") {
        qs.set("question_type", state.questionBankFilter.questionType);
      }
      const data = await fetchJson(`/api/frontend/question-bank?${qs.toString()}`);
      state.questionBankItems = Array.isArray(data.items) ? data.items : [];
      state.questionBankGroups = Array.isArray(data.groups) ? data.groups : [];
      state.questionBankSummary = data.summary && typeof data.summary === "object"
        ? data.summary
        : { total: state.questionBankItems.length, pending: 0, submitted: 0, needs_review: 0 };
      state.questionBankPagination = data.pagination && typeof data.pagination === "object"
        ? data.pagination
        : {
            page: Math.max(1, Number(state.questionBankPage || 1)),
            page_size: Math.max(1, Number(state.questionBankPageSize || 5)),
            total: state.questionBankItems.length,
            total_pages: 1,
            has_prev: false,
            has_next: false,
          };
      state.questionBankPage = Math.max(1, Number(state.questionBankPagination.page || 1));
    } catch (_err) {
      state.questionBankItems = [];
      state.questionBankGroups = [];
      state.questionBankSelectedGroupId = "";
      state.questionBankSelectedGroup = null;
      state.questionBankSummary = { total: 0, pending: 0, submitted: 0, needs_review: 0 };
      state.questionBankPagination = { page: 1, page_size: state.questionBankPageSize || 5, total: 0, total_pages: 1, has_prev: false, has_next: false };
    }
  }

  async function loadQuestionBankGroup(groupId) {
    const targetGroupId = String(groupId || "").trim();
    if (!targetGroupId) return null;
    state.questionBankSelectedGroupId = targetGroupId;
    state.questionBankGroupLoading = true;
    state.questionBankGroupError = "";
    try {
      const data = await fetchJson(`/api/frontend/question-bank/groups/${encodeURIComponent(targetGroupId)}`);
      const group = data && data.group && typeof data.group === "object" ? data.group : {};
      if (Array.isArray(data && data.items)) {
        group.items = data.items;
      }
      state.questionBankSelectedGroup = normalizeQuestionBankGroup(group);
      return state.questionBankSelectedGroup;
    } catch (err) {
      state.questionBankSelectedGroup = null;
      state.questionBankGroupError = err && err.message ? err.message : "题组加载失败";
      return null;
    } finally {
      state.questionBankGroupLoading = false;
    }
  }

  async function refreshQuestionBankAfterAnswer() {
    const selectedGroupId = String(state.questionBankSelectedGroupId || "").trim();
    await loadQuestionBank();
    if (selectedGroupId) {
      state.questionBankSelectedGroupId = selectedGroupId;
      await loadQuestionBankGroup(selectedGroupId);
    }
  }

  async function openQuestionBankGroupPractice(groupId) {
    const targetGroupId = String(groupId || "").trim();
    if (!targetGroupId) return;
    state.questionPracticeReturnView = "dashboard";
    state.questionBankSelectedGroupId = targetGroupId;
    state.questionBankSelectedGroup = null;
    state.questionBankGroupAnswerFilter = state.questionBankFilter.answerState === "needs_review" ? "needs_review" : "all";
    state.questionBankGroupLoading = true;
    state.questionBankGroupError = "";
    setView("questionPractice");
    renderQuestionPracticePage();
    await loadQuestionBankGroup(targetGroupId);
    renderQuestionPracticePage();
  }

  function closeQuestionBankPracticePage() {
    state.dashboardSideTab = "questionBank";
    state.questionBankGroupAnswerFilter = "all";
    syncDashboardSideTabs();
    setView("dashboard");
    renderQuestionBankCenter();
  }

  function renderNotificationTime(row) {
    const ts = Number(row && row.date);
    return Number.isFinite(ts) && ts > 0 ? formatTs(ts) : "";
  }

  function getNotificationId(row) {
    return String(row && (row.notification_id || row.id) || "").trim();
  }

  function isFeedNotification(row) {
    return String(row && row.source || "").trim().toLowerCase() === "feed";
  }

  function getNotificationActor(row) {
    return row && typeof row.actor === "object" ? row.actor : {};
  }

  function getNotificationActorName(row) {
    const actor = getNotificationActor(row);
    return String(
      actor.nickname
      || actor.display_name
      || actor.username
      || actor.user_id
      || row.actor_user_id
      || "用户"
    ).trim() || "用户";
  }

  function renderNotificationActorAvatar(row) {
    if (!isFeedNotification(row)) return "";

    const actorName = getNotificationActorName(row);
    const actor = getNotificationActor(row);
    const avatarUrl = normalizeFeedAvatarUrl(String(actor.avatar_url || actor.avatar || "").trim());
    const initial = (Array.from(actorName)[0] || "动").toUpperCase();

    return avatarUrl
      ? `<img class="dashboard-notice-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(actorName)}">`
      : `<div class="dashboard-notice-avatar dashboard-notice-avatar-fallback">${escapeHtml(initial)}</div>`;
  }

  function renderNotificationRemoveIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `;
  }

  async function removeDashboardNotification(notificationId) {
    const targetId = String(notificationId || "").trim();

    if (!targetId) return;

    await fetchJson(`/api/frontend/notifications/${encodeURIComponent(targetId)}/remove`, {
      method: "POST",
    });

    state.notifications = (Array.isArray(state.notifications) ? state.notifications : [])
      .filter((row) => getNotificationId(row) !== targetId);
    renderDashboardNotifications();
  }

  function renderDashboardNotifications() {
    if (!el.userProfileDimensions) return;
    const notifications = Array.isArray(state.notifications) ? state.notifications : [];
    const pending = state.adminPendingParse && typeof state.adminPendingParse === "object"
      ? state.adminPendingParse
      : { count: 0, items: [] };
    const pendingCount = Number(pending.count) || 0;
    const pendingItems = Array.isArray(pending.items) ? pending.items : [];
    const pendingHtml = state.isAdmin && pendingCount > 0 ? `
      <button class="dashboard-notice-admin-alert" type="button" data-view="settings" data-settings-tab="refinement">
        <div class="dashboard-notice-alert-title">待解析教材</div>
        <div class="dashboard-notice-alert-count">${pendingCount}</div>
        <div class="dashboard-notice-alert-sub">${escapeHtml(pendingItems.slice(0, 2).map((item) => String(item.book_title || "").trim()).filter(Boolean).join("、") || "有教材等待解析")}</div>
      </button>
    ` : "";

    const notificationHtml = notifications.length ? notifications.map((row) => {
      const title = String(row.title || "通知").trim();
      const content = String(row.content || "").trim();
      const timeText = renderNotificationTime(row);
      const jumpto = String(row.jumpto || "").trim();
      const notificationId = getNotificationId(row);
      const actorAvatarHtml = renderNotificationActorAvatar(row);
      const itemClass = actorAvatarHtml ? "dashboard-notice-item has-avatar" : "dashboard-notice-item";

      return `
        <article class="${itemClass}" ${jumpto ? `data-notice-jumpto="${escapeHtml(jumpto)}"` : ""} ${notificationId ? `data-notification-id="${escapeHtml(notificationId)}"` : ""}>
          ${actorAvatarHtml}
          <div class="dashboard-notice-main">
            <div class="dashboard-notice-title">${escapeHtml(title)}</div>
            ${content ? `<div class="dashboard-notice-content">${escapeHtml(content)}</div>` : ""}
            ${timeText ? `<div class="dashboard-notice-time">${escapeHtml(timeText)}</div>` : ""}
          </div>
          ${notificationId ? `
            <button class="dashboard-notice-remove" type="button" data-notice-remove-id="${escapeHtml(notificationId)}" aria-label="移除通知" title="移除通知">
              ${renderNotificationRemoveIcon()}
            </button>
          ` : ""}
        </article>
      `;
    }).join("") : '<div class="dashboard-notice-empty">暂无通知</div>';

    el.userProfileDimensions.innerHTML = `
      <section class="dashboard-notice-list">
        ${pendingHtml}
        ${notificationHtml}
      </section>
    `;
  }

  function renderReplyIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 7 4 12l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5 12h7.5c4 0 6.5 2 8 5- .2-6.2-4-10-10.2-10H9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }

  function enterFeedComposeMode() {
    state.dynamicPosting = true;
    resetFeedMentionState();
    syncFeedMentionMenus();
    syncLearningFeedComposer({ focus: true });
  }

  function exitFeedComposeMode() {
    state.dynamicPosting = false;
    resetFeedMentionState();
    syncFeedMentionMenus();
    syncLearningFeedComposer();
  }

  async function postLearningFeed(content) {
    const text = String(content || "").trim();
    if (!text) throw new Error("动态内容不能为空");
    const data = await fetchJson("/api/frontend/learning-feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: text,
        content: text,
        channel_id: String(state.selectedFeedChannelId || "public_all"),
      }),
    });
    await loadLearningFeeds();
    exitFeedComposeMode();
    return data;
  }

  async function deleteLearningFeed(feedId) {
    const id = String(feedId || "").trim();
    if (!id) return;
    await fetchJson(`/api/frontend/learning-feeds/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await loadLearningFeeds();
    renderLearningFeeds();
  }

  async function deleteLearningFeedComment(feedId, commentId) {
    const fid = String(feedId || "").trim();
    const cid = String(commentId || "").trim();
    if (!fid || !cid) return;
    await fetchJson(`/api/frontend/learning-feeds/${encodeURIComponent(fid)}/comments/${encodeURIComponent(cid)}`, {
      method: "DELETE",
    });
    state.feedExpandedMap[fid] = true;
    await loadLearningFeeds();
    renderLearningFeeds();
  }

  function handleHostReaderCommand(data) {
    if (!data || typeof data !== "object") return false;
    if (String(data.source || "").trim().toLowerCase() !== "nexora-host") return false;

    const msgType = String(data.type || "").trim().toLowerCase();

    if (msgType !== "nexora:reader:close") return false;

    closeReader(false, {
      closeReason: String(data.close_reason || data.reason || "host_reader_close").trim(),
      closeTarget: String(data.close_target || data.target || "").trim(),
    });
    return true;
  }

  window.addEventListener("message", async (event) => {
    const data = event && event.data;
    if (!data || typeof data !== "object") return;
    if (handleHostReaderCommand(data)) return;
    if (String(data.source || "").trim().toLowerCase() !== "nexora-learning") return;
    const msgType = String(data.type || "").trim().toLowerCase();
    const requestId = String(data.requestId || "").trim();
    if (msgType === "nexora:feed-compose:submit") {
      try {
        const result = await postLearningFeed(String(data.content || ""));
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "nexora-learning",
            type: "nexora:feed-compose:result",
            requestId,
            success: true,
            item: result && result.item ? result.item : null,
          }, "*");
        }
      } catch (err) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "nexora-learning",
            type: "nexora:feed-compose:result",
            requestId,
            success: false,
            error: String(err && err.message ? err.message : "发布动态失败"),
          }, "*");
        }
      }
      return;
    }
    if (msgType === "nexora:feed-users:search") {
      try {
        const query = String(data.q || "").trim();
        const limit = Math.max(1, Math.min(Number(data.limit) || 8, 20));
        const rows = await searchFeedUsers(query, limit);
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "nexora-learning",
            type: "nexora:feed-users:search:result",
            requestId,
            success: true,
            items: Array.isArray(rows) ? rows : [],
          }, "*");
        }
      } catch (err) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "nexora-learning",
            type: "nexora:feed-users:search:result",
            requestId,
            success: false,
            error: String(err && err.message ? err.message : "搜索失败"),
            items: [],
          }, "*");
        }
      }
    }
  });

// ─────── User Profile ─────────────────────────────────────────────────
  function renderUserProfile() {
    const username = getCurrentUserDisplayName();
    const identity = String((state.user && (state.user.identity || state.user.role)) || "").trim().toLowerCase();
    const role = state.isAdmin ? "管理员" : (identity === "teacher" ? "教师" : "成员");
    const avatar = (Array.from(username.trim())[0] || "N").toUpperCase();
    const avatarUrl = getCurrentUserAvatarUrl();
    const booksCount = state.allLectureRows.reduce((sum, row) => sum + toNumber(row && row.books_count, 0), 0);
    const connected = !!(state.integration && state.integration.connected);
    const modelsCount = toNumber(state.integration && state.integration.models_count, 0);
    const totalHours = toNumber(state.totalStudyHours, 0);

    el.userProfileCard.innerHTML = `
      ${avatarUrl
        ? `<img class="user-profile-avatar user-profile-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(username)}">`
        : `<div class="user-profile-avatar">${escapeHtml(avatar)}</div>`}
      <div class="user-profile-meta">
        <div class="user-profile-name">${escapeHtml(username)}</div>
        <div class="user-profile-line">角色：${escapeHtml(role)} · 全部课程：${state.allLectureRows.length} · 教材：${booksCount}</div>
        <div class="user-profile-line">学习时长：${totalHours > 0 ? `${totalHours.toFixed(1)}h` : "0h"} · 模型：${connected ? `已连接(${modelsCount})` : "未连接"}</div>
      </div>
    `;
  }

