// ─────── Event Bindings ───────────────────────────────────────────────
  function bindEvents() {
    el.openMaterialsViewBtn.addEventListener("click", () => {
      setView("materials");
      openMaterialsShelf();
    });
    if (el.dashboardProgressTabBtn) {
      el.dashboardProgressTabBtn.addEventListener("click", () => {
        state.dashboardSideTab = "progress";
        syncDashboardSideTabs();
      });
    }
    if (el.dashboardPushTabBtn) {
      el.dashboardPushTabBtn.addEventListener("click", () => {
        state.dashboardSideTab = "push";
        syncDashboardSideTabs();
      });
    }
    if (el.dashboardQuestionBankTabBtn) {
      el.dashboardQuestionBankTabBtn.addEventListener("click", async () => {
        state.dashboardSideTab = "questionBank";
        await loadQuestionBank();
        syncDashboardSideTabs();
      });
    }
    if (el.dashboardProgressFeedTabBtn) {
      el.dashboardProgressFeedTabBtn.addEventListener("click", () => {
        state.dashboardSideTab = "feed";
        syncDashboardSideTabs();
      });
    }
    bindLearningPushEvents();
    bindLearningResourceStudioEvents();
    if (el.backFromResourceStudioBtn) {
      el.backFromResourceStudioBtn.addEventListener("click", () => {
        state.dashboardSideTab = "push";
        setView("dashboard");
        syncDashboardSideTabs();
      });
    }
    if (el.backFromVideoStudioBtn) {
      el.backFromVideoStudioBtn.addEventListener("click", () => {
        state.dashboardSideTab = "push";
        setView("dashboard");
        syncDashboardSideTabs();
      });
    }
    if (el.backFromResourceReaderBtn) {
      el.backFromResourceReaderBtn.addEventListener("click", () => {
        closeLearningResourceReader();
      });
    }
    if (el.backFromResourceReviewBtn) {
      el.backFromResourceReviewBtn.addEventListener("click", () => {
        closeLearningResourceReview();
      });
    }
    if (el.questionBankPanel) {
      el.questionBankPanel.addEventListener("change", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const filter = target.closest("[data-qb-filter]");
        if (!filter) return;
        const key = String(filter.getAttribute("data-qb-filter") || "").trim();
        if (!Object.prototype.hasOwnProperty.call(state.questionBankFilter, key)) return;
        state.questionBankFilter[key] = String(filter.value || "all");
        state.questionBankPage = 1;
        state.questionBankSelectedGroupId = "";
        state.questionBankSelectedGroup = null;
        await loadQuestionBank();
        renderQuestionBankCenter();
      });
      el.questionBankPanel.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const groupFilterNode = target.closest("[data-qb-group-filter]");
        if (groupFilterNode) {
          state.questionBankGroupAnswerFilter = String(groupFilterNode.getAttribute("data-qb-group-filter") || "all").trim() || "all";
          renderQuestionBankCenter();
          scrollQuestionBankToAllSection();
          return;
        }
        const pageNode = target.closest("[data-qb-page]");
        if (pageNode) {
          const nextPage = Number(pageNode.getAttribute("data-qb-page") || "1");
          const totalPages = Math.max(1, Number((state.questionBankPagination || {}).total_pages || 1));
          if (!Number.isFinite(nextPage) || nextPage < 1 || nextPage > totalPages || pageNode.hasAttribute("disabled")) return;
          state.questionBankPage = Math.max(1, Math.min(totalPages, Math.floor(nextPage)));
          state.questionBankSelectedGroupId = "";
          state.questionBankSelectedGroup = null;
          await loadQuestionBank();
          renderQuestionBankCenter();
          scrollQuestionBankToAllSection();
          return;
        }
        const actionNode = target.closest("[data-qb-action]");
        if (!actionNode) return;
        const action = String(actionNode.getAttribute("data-qb-action") || "").trim();
        if (action === "open-group") {
          const groupId = String(actionNode.getAttribute("data-group-id") || "").trim();
          if (!groupId) return;
          await openQuestionBankGroupPractice(groupId);
          return;
        }
        if (action === "open-group-review") {
          const groupId = String(actionNode.getAttribute("data-group-id") || "").trim();
          if (!groupId) return;
          await openQuestionBankGroupReview(groupId);
          return;
        }
        if (action === "open-mistakes") {
          state.questionBankFilter.answerState = "needs_review";
          state.questionBankPage = 1;
          state.questionBankSelectedGroupId = "";
          state.questionBankSelectedGroup = null;
          await loadQuestionBank();
          renderQuestionBankCenter();
          scrollQuestionBankToAllSection();
          return;
        }
        if (action === "clear-mistakes") {
          state.questionBankFilter.answerState = "all";
          state.questionBankPage = 1;
          state.questionBankSelectedGroupId = "";
          state.questionBankSelectedGroup = null;
          await loadQuestionBank();
          renderQuestionBankCenter();
          return;
        }
        if (action === "back-groups") {
          state.questionBankSelectedGroupId = "";
          state.questionBankSelectedGroup = null;
          state.questionBankGroupError = "";
          state.questionBankGroupAnswerFilter = "all";
          renderQuestionBankCenter();
          scrollQuestionBankToAllSection();
          return;
        }
        if (action === "paper-submit") {
          await submitQuestionBankPaper(actionNode);
          return;
        }
        if (action === "paper-clear") {
          clearQuestionBankPaperInputs();
          return;
        }
        if (action === "answer") {
          const questionId = String(actionNode.getAttribute("data-question-id") || "").trim();
          openQuestionBankPractice(questionId);
          return;
        }
        if (action === "open-lecture") {
          const lectureId = String(actionNode.getAttribute("data-lecture-id") || "").trim();
          if (!lectureId) return;
          setView("materials");
          openLectureHome(lectureId, { returnTarget: "dashboard" });
          return;
        }
        if (action === "toggle-answer") {
          const questionId = String(actionNode.getAttribute("data-question-id") || "").trim();
          const answer = questionId ? document.getElementById(`qbAnswer${questionId}`) : null;
          if (answer) {
            answer.hidden = !answer.hidden;
          }
        }
      });
      el.questionBankPanel.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        const card = target.closest('.question-exam-set-card[data-qb-action="open-group"]');
        if (!card || !el.questionBankPanel.contains(card)) return;

        const groupId = String(card.getAttribute("data-group-id") || "").trim();
        if (!groupId) return;

        event.preventDefault();
        await openQuestionBankGroupPractice(groupId);
      });
    }
    if (el.backFromQuestionPracticeBtn) {
      el.backFromQuestionPracticeBtn.addEventListener("click", () => {
        closeQuestionBankPracticePage();
      });
    }
    if (el.questionPracticeContent) {
      el.questionPracticeContent.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const groupFilterNode = target.closest("[data-qb-group-filter]");
        if (groupFilterNode) {
          state.questionBankGroupAnswerFilter = String(groupFilterNode.getAttribute("data-qb-group-filter") || "all").trim() || "all";
          renderQuestionPracticePage();
          return;
        }
        const actionNode = target.closest("[data-qb-action]");
        if (!actionNode) return;
        const action = String(actionNode.getAttribute("data-qb-action") || "").trim();
        if (action === "exam-jump") {
          setQuestionExamIndex(actionNode.getAttribute("data-exam-index"));
          return;
        }
        if (action === "exam-prev") {
          setQuestionExamIndex(ensureQuestionExamState().currentIndex - 1);
          return;
        }
        if (action === "exam-next") {
          setQuestionExamIndex(ensureQuestionExamState().currentIndex + 1);
          return;
        }
        if (action === "exam-exit-review") {
          closeQuestionBankPracticePage();
          return;
        }
        if (action === "paper-submit") {
          await submitQuestionBankPaper(actionNode);
          return;
        }
        if (action === "paper-clear") {
          clearQuestionBankPaperInputs();
          return;
        }
        if (action === "answer") {
          const questionId = String(actionNode.getAttribute("data-question-id") || "").trim();
          openQuestionBankPractice(questionId);
          return;
        }
        if (action === "open-lecture") {
          const lectureId = String(actionNode.getAttribute("data-lecture-id") || "").trim();
          if (!lectureId) return;
          setView("materials");
          openLectureHome(lectureId, { returnTarget: "dashboard" });
        }
      });
      el.questionPracticeContent.addEventListener("input", (event) => {
        captureQuestionExamDraft(event.target);
      });
    }
    if (el.questionPracticeHeaderMeta) {
      el.questionPracticeHeaderMeta.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const actionNode = target.closest("[data-qb-action]");
        if (!actionNode) return;
        const action = String(actionNode.getAttribute("data-qb-action") || "").trim();

        if (action === "paper-submit") {
          await submitQuestionBankPaper(actionNode);
          return;
        }

        if (action === "exam-exit-review") {
          closeQuestionBankPracticePage();
        }
      });
    }
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const actionNode = target.closest("[data-qb-practice-action]");
      if (!actionNode) return;
      const modal = document.getElementById("questionBankPracticeModal");
      if (!modal || !modal.contains(actionNode)) return;
      const action = String(actionNode.getAttribute("data-qb-practice-action") || "").trim();
      if (action === "close") {
        closeQuestionBankPracticeModal();
        return;
      }
      if (action === "toggle-reference") {
        const reference = modal.querySelector(".question-bank-practice-reference");
        if (reference) {
          reference.hidden = !reference.hidden;
        }
        return;
      }
      if (action === "submit") {
        const questionId = String(actionNode.getAttribute("data-question-id") || "").trim();
        submitQuestionBankPractice(questionId);
      }
    });
    if (el.feedChannelList) {
      el.feedChannelList.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const editBtn = target.closest("[data-action='edit-channel']");
        if (editBtn) {
          event.preventDefault();
          event.stopPropagation();
          const channelId = String(editBtn.getAttribute("data-channel-id") || "").trim();
          if (channelId) {
            openChannelEditDialog(channelId);
          }
          return;
        }

        const channelItem = target.closest("[data-feed-channel-select]");
        if (!channelItem) return;

        const channelId = String(channelItem.getAttribute("data-channel-id") || "").trim();
        if (!channelId || channelId === String(state.selectedFeedChannelId || "public_all")) return;

        state.selectedFeedChannelId = channelId;
        loadLearningFeeds().catch((err) => showToast(`加载动态失败：${err.message || "未知错误"}`));
      });
    }
    if (el.dashboardPieTabBtn) {
      el.dashboardPieTabBtn.addEventListener("click", () => {
        state.dashboardPieTab = "pie";
        syncPieProfileTabs();
      });
    }
    if (el.dashboardProfileTabBtn) {
      el.dashboardProfileTabBtn.addEventListener("click", () => {
        state.dashboardPieTab = "profile";
        syncPieProfileTabs();
      });
    }
    if (el.userProfileDimensions) {
      el.userProfileDimensions.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const removeBtn = target.closest("[data-notice-remove-id]");
        if (removeBtn) {
          event.preventDefault();
          event.stopPropagation();
          const notificationId = String(removeBtn.getAttribute("data-notice-remove-id") || "").trim();

          try {
            await removeDashboardNotification(notificationId);
          } catch (err) {
            showToast(`移除通知失败：${err.message || "未知错误"}`);
          }

          return;
        }

        const settingsBtn = target.closest("[data-view='settings'][data-settings-tab]");
        if (settingsBtn) {
          const tab = String(settingsBtn.getAttribute("data-settings-tab") || "refinement").trim();
          openSettingsView(tab || "refinement").catch((err) => showToast(`打开设置失败：${err.message || "未知错误"}`));
          return;
        }

        const notice = target.closest("[data-notice-jumpto]");
        if (!notice) return;

        const jumpto = String(notice.getAttribute("data-notice-jumpto") || "").trim();
        if (jumpto) {
          emitHostPayload("nexora:notification:open", { jumpto });
        }
      });
    }
    bindLearningFeedComposerEvents();
    if (el.dashboardFocusPanel) {
      el.dashboardFocusPanel.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const item = target.closest("[data-dashboard-focus-lecture-id]");
        if (!item) return;
        const lectureId = String(item.getAttribute("data-dashboard-focus-lecture-id") || "");
        if (!lectureId) return;
        setView("materials");
        openLectureHome(lectureId, { returnTarget: "dashboard" });
      });
    }

    el.progressList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const item = target.closest("[data-progress-lecture-id]");
      if (!item) return;
      const lectureId = String(item.getAttribute("data-progress-lecture-id") || "");
      if (!lectureId) return;
      setView("materials");
      openLectureHome(lectureId, { returnTarget: "dashboard" });
    });
    if (el.learningFeedPanel) {
      el.learningFeedPanel.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest("[data-feed-action]");
        if (!btn) return;
        event.preventDefault();
        const action = String(btn.getAttribute("data-feed-action") || "").trim();
        const feedId = String(btn.getAttribute("data-feed-id") || "").trim();
        if (!feedId) return;
        try {
          if (action === "like") {
            await toggleLearningFeedLike(feedId);
            return;
          }
          if (action === "comment-toggle") {
            state.feedExpandedMap[feedId] = !state.feedExpandedMap[feedId];
            renderLearningFeeds();
            return;
          }
          if (action === "comment-like") {
            const commentId = String(btn.getAttribute("data-comment-id") || "").trim();
            if (!commentId) return;
            await toggleLearningFeedCommentLike(feedId, commentId);
            return;
          }
          if (action === "comment-reply") {
            const handle = String(btn.getAttribute("data-comment-username") || "").trim();
            const targetInput = el.learningFeedPanel.querySelector(`[data-feed-comment-input="${CSS.escape(feedId)}"]`);
            if (!(targetInput instanceof HTMLInputElement) || !handle) return;
            const prefix = `@${handle} 回复：`;
            const current = String(targetInput.value || "");
            if (!current.startsWith(prefix)) {
              targetInput.value = `${prefix}${current.replace(/^\s+/, "")}`;
              state.feedCommentDrafts[feedId] = targetInput.value;
              targetInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
            targetInput.focus();
            try {
              const caret = targetInput.value.length;
              targetInput.setSelectionRange(caret, caret);
            } catch (_err) {}
            return;
          }
          if (action === "mention-pick") {
            const mentionIndex = Number(btn.getAttribute("data-mention-index") || 0);
            const mentionState = state.feedMentionState;
            if (!mentionState || !Array.isArray(mentionState.users)) return;
            const picked = mentionState.users[mentionIndex];
            const targetInput = el.learningFeedPanel.querySelector(`[data-feed-comment-input="${CSS.escape(feedId)}"]`);
            if (!(targetInput instanceof HTMLInputElement) || !picked) return;
            applyMentionSelectionToInput(targetInput, picked);
            targetInput.focus();
            return;
          }
          if (action === "comment-send") {
            await submitLearningFeedComment(feedId);
            return;
          }
          if (action === "feed-delete") {
            openConfirm("确认删除这条动态？", async () => {
              await deleteLearningFeed(feedId);
            });
            return;
          }
          if (action === "comment-delete") {
            const commentId = String(btn.getAttribute("data-comment-id") || "").trim();
            if (!commentId) return;
            openConfirm("确认删除这条评论？", async () => {
              await deleteLearningFeedComment(feedId, commentId);
            });
            return;
          }
        } catch (err) {
          showToast(String(err && err.message ? err.message : "动态操作失败"));
        }
      });
      el.learningFeedPanel.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const feedId = String(target.getAttribute("data-feed-comment-input") || "").trim();
        if (!feedId) return;
        state.feedCommentDrafts[feedId] = String(target.value || "");
        if (target.dataset.composing === "true") {
          return;
        }
        updateFeedMentionCandidates(target).catch(() => {
          resetFeedMentionState();
          syncFeedMentionMenus();
        });
      });
      el.learningFeedPanel.addEventListener("compositionstart", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const feedId = String(target.getAttribute("data-feed-comment-input") || "").trim();
        if (!feedId) return;
        target.dataset.composing = "true";
        state.feedCommentComposing[feedId] = true;
      });
      el.learningFeedPanel.addEventListener("compositionend", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const feedId = String(target.getAttribute("data-feed-comment-input") || "").trim();
        if (!feedId) return;
        delete state.feedCommentComposing[feedId];
        delete target.dataset.composing;
        state.feedCommentDrafts[feedId] = String(target.value || "");
        updateFeedMentionCandidates(target).catch(() => {
          resetFeedMentionState();
          syncFeedMentionMenus();
        });
      });
      el.learningFeedPanel.addEventListener("keydown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const feedId = String(target.getAttribute("data-feed-comment-input") || "").trim();
        if (!feedId) return;
        if (target.dataset.composing === "true" || event.isComposing) {
          return;
        }
        const mentionState = state.feedMentionState;
        if (!mentionState || !mentionState.visible || mentionState.key !== `comment:${feedId}` || !Array.isArray(mentionState.users) || !mentionState.users.length) {
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          mentionState.activeIndex = (Number(mentionState.activeIndex || 0) + 1) % mentionState.users.length;
          syncFeedMentionMenus();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          mentionState.activeIndex = (Number(mentionState.activeIndex || 0) - 1 + mentionState.users.length) % mentionState.users.length;
          syncFeedMentionMenus();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          const picked = mentionState.users[Number(mentionState.activeIndex || 0)];
          if (!picked) return;
          event.preventDefault();
          applyMentionSelectionToInput(target, picked);
          return;
        }
        if (event.key === "Escape") {
          resetFeedMentionState();
          syncFeedMentionMenus();
        }
      });
    }
    if (el.confirmCancelBtn) {
      el.confirmCancelBtn.addEventListener("click", () => closeConfirm());
    }
    if (el.confirmBackdrop) {
      el.confirmBackdrop.addEventListener("click", (event) => {
        if (event.target === el.confirmBackdrop) {
          closeConfirm();
        }
      });
    }
    if (el.confirmOkBtn) {
      el.confirmOkBtn.addEventListener("click", async () => {
        const action = state.confirmAction;
        closeConfirm();
        if (typeof action !== "function") return;
        try {
          await action();
        } catch (err) {
          showToast(String(err && err.message ? err.message : "操作失败"));
        }
      });
    }

    el.backToDashboardBtn.addEventListener("click", async () => {
      if (state.materialsDetailMode === "catalog") {
        returnFromCourseHome();
        return;
      }
      if (state.materialsPageMode === "lecture") {
        returnFromCourseHome();
        return;
      }
      closeReader();
      setView("dashboard");
      await refreshAll();
    });
    if (el.backFromCourseHomeBtn) {
      el.backFromCourseHomeBtn.addEventListener("click", () => {
        returnFromCourseHome();
      });
    }
    if (el.openUploadViewBtn) {
      el.openUploadViewBtn.addEventListener("click", () => {
        closeReader();
        setView("upload");
        setUploadTab("upload");
      });
    }
    if (el.courseHomeUploadBtn) {
      el.courseHomeUploadBtn.addEventListener("click", () => {
        closeReader();
        setView("upload");
        setUploadTab("upload");
      });
    }
    if (el.courseHomeSettingsBtn) {
      el.courseHomeSettingsBtn.addEventListener("click", () => {
        if (state.materialsDetailMode === "catalog" && state.catalogContext) {
          openTeacherEditPanel(state.selectedLectureId, {
            mode: "book",
            bookId: state.catalogContext.bookId,
          });
          return;
        }
        openTeacherEditPanel(state.selectedLectureId, { mode: "lecture" });
      });
    }
    el.backToMaterialsBtn.addEventListener("click", () => {
      closeReader();
      setView("materials");
      syncMaterialsPageMode();
    });
    el.backFromSettingsBtn.addEventListener("click", () => {
      setView("dashboard");
    });
    el.backFromLearningPathBtn.addEventListener("click", () => {
      setView("materials");
      syncMaterialsPageMode();
    });
    setLearningPathOutlineCollapsed(readLearningPathOutlineCollapsed(), false);
    if (el.learningPathOutlineToggle) {
      el.learningPathOutlineToggle.addEventListener("click", () => {
        setLearningPathOutlineCollapsed(!state.lpOutlineCollapsed, true);
      });
    }
    if (el.learningPathOutlinePane) {
      el.learningPathOutlinePane.addEventListener("click", (event) => {
        const rawTarget = event.target;
        const target = rawTarget instanceof Element
          ? rawTarget
          : rawTarget && rawTarget.parentElement instanceof Element
            ? rawTarget.parentElement
            : null;
        const tab = target ? target.closest("[data-lp-side-tab]") : null;

        if (!tab || !el.learningPathOutlinePane.contains(tab)) {
          return;
        }

        const nextTab = String(tab.getAttribute("data-lp-side-tab") || "").trim();

        if (nextTab !== "outline" && nextTab !== "report") {
          return;
        }

        state.learningPathSideTab = nextTab;
        renderLearningPathSidePanel(state.selectedLectureId);
      });
    }
    {
      const lpScrollPane = el.learningPathMarkdown ? el.learningPathMarkdown.closest(".learning-path-main-pane") : null;
      if (lpScrollPane) {
        lpScrollPane.addEventListener("scroll", emitLearningPathScrollTelemetry, { passive: true });
      }
    }
    el.backFromReaderBtn.addEventListener("click", () => {
      if (!state.isReaderOpen) return;
      if (isReaderSettingsOpen()) {
        setReaderSettingsPanelOpen(false);
        return;
      }
      if (el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
        setChapterListPanelOpen(false);
        return;
      }
      if (state.readerViewMode === "reading") {
        setReaderFullscreen(false);
        closeReader(false, { closeReason: "reader_back", closeTarget: "learning" });
        return;
      }
      closeReader(false, { closeReason: "reader_back", closeTarget: "learning" });
    });
    if (el.readerSettingsBtn) {
      el.readerSettingsBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        logReaderDebug("readerSettingsBtn:click", {});
        setReaderSettingsPanelOpen(!isReaderSettingsOpen());
      });
    }
    if (el.readerSettingsPanel) {
      el.readerSettingsPanel.addEventListener("click", (event) => {
        event.stopPropagation();
        logReaderDebug("readerSettingsPanel:click", {});
      });
      el.readerSettingsPanel.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        logReaderDebug("readerSettingsPanel:pointerdown", {});
      });
      ["transitionstart", "transitionend", "animationstart", "animationend"].forEach((evtName) => {
        el.readerSettingsPanel.addEventListener(evtName, () => {
          logReaderDebug(`readerSettingsPanel:${evtName}`, {});
        });
      });
    }
    if (el.readerChapterListBtn) {
      el.readerChapterListBtn.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      el.readerChapterListBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setChapterListPanelOpen(!(el.chapterListPanel && el.chapterListPanel.classList.contains("show")));
        setReaderSettingsPanelOpen(false);
      });
    }
    if (el.chapterListContent) {
      el.chapterListContent.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        
        // 检查是否点击了小节
        const sessionItem = target.closest(".session-item");
        if (sessionItem) {
          const chapterIdx = Number(sessionItem.getAttribute("data-chapter-index") || "0");
          const sessionIdx = Number(sessionItem.getAttribute("data-session-index") || "0");
          const sessionRange = sessionItem.getAttribute("data-session-range") || "";
          markSessionVisited(chapterIdx, sessionIdx);
          renderChapterList();
          // 解析session range获取偏移量
          let scrollToOffset = null;
          if (sessionRange) {
            const parts = sessionRange.split(":");
            if (parts.length >= 1) {
              scrollToOffset = Number(parts[0]) || 0;
            }
          }
          // 打开对应章节并滚动到session位置
          openReaderChapter(chapterIdx, scrollToOffset, {
            sessionIndex: sessionIdx,
            sessionRange,
          });
          setChapterListPanelOpen(false);
          state.readerViewMode = "reading";
          syncFloatingBtnVisibility();
          syncReaderModeUI();
          setReaderFullscreen(true);
          return;
        }
        
        // 检查是否点击了章节
        const item = target.closest("[data-reader-chapter-index]");
        if (!item) return;
        const idx = Number(item.getAttribute("data-reader-chapter-index") || "0");
        if (idx !== state.readerActiveChapterIndex) {
          reportReaderChapterComplete(state.readerActiveChapterIndex).catch((err) => {
            console.warn("[NXL-Reader] chapter complete before chapter switch failed", err);
          });
        }
        openReaderChapter(idx);
        setChapterListPanelOpen(false);
        state.readerViewMode = "reading";
        syncFloatingBtnVisibility();
        syncReaderModeUI();
        setReaderFullscreen(true);
      });
    }
    if (el.closeChapterList) {
      el.closeChapterList.addEventListener("click", () => setChapterListPanelOpen(false));
    }
    if (el.fontSizeSlider) {
      el.fontSizeSlider.addEventListener("input", () => {
        const v = Number(el.fontSizeSlider.value || DEFAULT_READER_SETTINGS.fontSize);
        state.readerSettings.fontSize = Math.max(12, Math.min(36, Math.round(v)));
        syncReaderSettingsPanel();
        applyReaderTypography();
        saveReaderSettings();
      });
    }
    if (el.lineHeightSlider) {
      el.lineHeightSlider.addEventListener("input", () => {
        const v = Number(el.lineHeightSlider.value || DEFAULT_READER_SETTINGS.paragraphSpacing);
        state.readerSettings.paragraphSpacing = Math.max(1.0, Math.min(3.5, Number(v.toFixed(1))));
        syncReaderSettingsPanel();
        applyReaderTypography();
        saveReaderSettings();
      });
    }
    if (el.edgeClickWidthSlider) {
      el.edgeClickWidthSlider.addEventListener("input", () => {
        const v = Number(el.edgeClickWidthSlider.value || DEFAULT_READER_SETTINGS.edgeClickWidth);
        state.readerSettings.edgeClickWidth = Math.max(30, Math.min(160, Math.round(v)));
        syncReaderSettingsPanel();
        applyReaderTypography();
        saveReaderSettings();
      });
    }
    document.querySelectorAll('input[name="readerTheme"]').forEach((node) => {
      node.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        state.readerSettings.theme = String(target.value || "light");
        applyReaderTypography();
        saveReaderSettings();
      });
    });
    document.querySelectorAll('input[name="readerDisplayMode"]').forEach((node) => {
      node.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        state.readerSettings.displayMode = String(target.value || "zh-ja");
        saveReaderSettings();
      });
    });
    if (el.enableKeyNavigation) {
      el.enableKeyNavigation.addEventListener("change", () => {
        state.readerSettings.enableKeyNavigation = !!el.enableKeyNavigation.checked;
        saveReaderSettings();
      });
    }
    if (el.translatorSelect) {
      el.translatorSelect.addEventListener("change", () => {
        state.readerSettings.preferredTranslator = String(el.translatorSelect.value || "auto");
        saveReaderSettings();
      });
    }
    if (el.resetReaderSettings) {
      el.resetReaderSettings.addEventListener("click", () => {
        state.readerSettings = {
          fontSize: DEFAULT_READER_SETTINGS.fontSize,
          paragraphSpacing: DEFAULT_READER_SETTINGS.paragraphSpacing,
          edgeClickWidth: DEFAULT_READER_SETTINGS.edgeClickWidth,
          theme: DEFAULT_READER_SETTINGS.theme,
          displayMode: DEFAULT_READER_SETTINGS.displayMode,
          enableKeyNavigation: DEFAULT_READER_SETTINGS.enableKeyNavigation,
          preferredTranslator: DEFAULT_READER_SETTINGS.preferredTranslator,
        };
        syncReaderSettingsPanel();
        applyReaderTypography();
        saveReaderSettings();
        showToast("阅读设置已重置");
      });
    }
    if (el.exportReaderSettings) {
      el.exportReaderSettings.addEventListener("click", () => {
        try {
          const settingsJson = JSON.stringify(state.readerSettings, null, 2);
          const blob = new Blob([settingsJson], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "reader-settings.json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast("阅读设置已导出");
        } catch (_err) {
          showToast("导出设置失败");
        }
      });
    }
    el.readerContent.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const guidePatch = target ? target.closest(".reader-guide-highlight, .reader-guide-section-break") : null;

      if (guidePatch) {
        event.preventDefault();
        event.stopPropagation();
        jumpToReaderGuideCard(Number(guidePatch.getAttribute("data-reader-guide-patch-index") || "0"));
        return;
      }

      if (!state.isReaderFullscreen) return;
      if (target && target.closest(".annotation-marker")) return;
      const navBtn = target ? target.closest("[data-reader-nav]") : null;
      if (navBtn) {
        event.preventDefault();
        event.stopPropagation();
        const dir = String(navBtn.getAttribute("data-reader-nav") || "");
        const nextIndex = dir === "prev"
          ? state.readerActiveChapterIndex - 1
          : state.readerActiveChapterIndex + 1;
        if (dir === "next" && nextIndex > state.readerActiveChapterIndex) {
          reportReaderChapterComplete(state.readerActiveChapterIndex).catch((err) => {
            console.warn("[NXL-Reader] chapter complete before next navigation failed", err);
          });
        }
        openReaderChapter(nextIndex);
        return;
      }
      if (isReaderSettingsOpen()) {
        setReaderSettingsPanelOpen(false);
        state.readerClosePanelsUntil = Date.now() + 180;
        return;
      }
      if (el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
        setChapterListPanelOpen(false);
        state.readerClosePanelsUntil = Date.now() + 180;
        return;
      }
      event.stopPropagation();
      logReaderDebug("readerContent:clickToggle", {});
      toggleReaderUI();
    });
    el.readerContent.addEventListener("contextmenu", handleReaderContextMenu);
    el.readerContent.addEventListener("pointerdown", (event) => {
      hideHostReaderSelectionContextMenu();
      if (!state.isReaderOpen || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !el.readerContent || !el.readerContent.contains(target)) return;
      readerSelectionTelemetryState.pointerDownKey = getReaderSelectionSignature();
      readerSelectionTelemetryState.pointerActive = true;
    }, { capture: true });
    document.addEventListener("selectionchange", () => {
      if (!state.isReaderOpen || !readerSelectionTelemetryState.pointerActive) return;
      scheduleReaderSelectionTelemetry("selectionchange", false);
    }, { capture: true });
    document.addEventListener("pointerup", (event) => {
      if (!state.isReaderOpen || !readerSelectionTelemetryState.pointerActive) return;
      if (event.button !== 0) {
        resetReaderSelectionTelemetry();
        return;
      }
      scheduleReaderSelectionTelemetry("pointerup", true);
    }, { capture: true });
    document.addEventListener("pointercancel", () => {
      if (!readerSelectionTelemetryState.pointerActive) return;
      resetReaderSelectionTelemetry();
    }, { capture: true });
    el.readerContent.addEventListener("scroll", () => {
      if (!state.isReaderOpen) return;
      hideHostReaderSelectionContextMenu();
      const chapterMeta = getReaderCurrentChapterMeta();
      const scrollContainer = getReaderScrollContainer();
      if (!scrollContainer) return;
      const scrollHeight = Number(scrollContainer.scrollHeight || 0);
      const clientHeight = Number(scrollContainer.clientHeight || 0);
      const maxScroll = Math.max(0, scrollHeight - clientHeight);
      const scrollTop = Number(scrollContainer.scrollTop || 0);
      const scrollPercent = maxScroll > 0 ? (scrollTop / maxScroll) : 0;
      emitTelemetry("reader_scroll", {
        lecture_id: String(state.selectedLectureId || "").trim(),
        book_id: String(state.selectedBookId || "").trim(),
        chapter_index: chapterMeta.chapterIndex,
        chapter_title: chapterMeta.chapterTitle,
        scroll_top: scrollTop,
        scroll_height: scrollHeight,
        client_height: clientHeight,
        scroll_percent: Number(scrollPercent.toFixed(4)),
      });
      scheduleReaderPositionSave(scrollContainer);
      scheduleHostReaderContextSync(120);
      checkSessionProgressByScroll();
    }, { passive: true, capture: true });
    if (el.readerClickLeft) {
      el.readerClickLeft.addEventListener("click", (event) => {
        if (!state.isReaderFullscreen) return;
        if (el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
          setChapterListPanelOpen(false);
          state.readerClosePanelsUntil = Date.now() + 180;
          return;
        }
        if (isReaderSettingsOpen()) {
          setReaderSettingsPanelOpen(false);
          state.readerClosePanelsUntil = Date.now() + 180;
          return;
        }
        event.stopPropagation();
        logReaderDebug("readerClickLeft:toggle", {});
        toggleReaderUI();
      });
    }
    if (el.readerClickRight) {
      el.readerClickRight.addEventListener("click", (event) => {
        if (!state.isReaderFullscreen) return;
        if (el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
          setChapterListPanelOpen(false);
          state.readerClosePanelsUntil = Date.now() + 180;
          return;
        }
        if (isReaderSettingsOpen()) {
          setReaderSettingsPanelOpen(false);
          state.readerClosePanelsUntil = Date.now() + 180;
          return;
        }
        event.stopPropagation();
        logReaderDebug("readerClickRight:toggle", {});
        toggleReaderUI();
      });
    }
    document.addEventListener("keydown", (event) => {
      if (state.isReaderOpen && state.readerSettings.enableKeyNavigation) {
        if (event.key === "s" || event.key === "S") {
          event.preventDefault();
          setReaderSettingsPanelOpen(!isReaderSettingsOpen());
          return;
        }
      }
      if (event.key === "Escape" && isReaderSettingsOpen()) {
        setReaderSettingsPanelOpen(false);
        return;
      }
      if (event.key === "Escape" && el.chapterListPanel && el.chapterListPanel.classList.contains("show")) {
        setChapterListPanelOpen(false);
        return;
      }
      if (event.key === "Escape" && state.isReaderFullscreen) {
        setReaderFullscreen(false);
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!state.isReaderOpen || !state.isReaderFullscreen) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const clickedSettingsPanel = !!target.closest("#readerSettingsPanel");
      const clickedChapterPanel = !!target.closest("#chapterListPanel");
      const clickedSettingsBtn = !!target.closest("#readerSettingsBtn");
      const clickedChapterBtn = !!target.closest("#readerChapterListBtn");
      if (isReaderSettingsOpen() && !clickedSettingsPanel && !clickedSettingsBtn) {
        setReaderSettingsPanelOpen(false);
        state.readerClosePanelsUntil = Date.now() + 180;
      }
      if (el.chapterListPanel && el.chapterListPanel.classList.contains("show") && !clickedChapterPanel && !clickedChapterBtn) {
        setChapterListPanelOpen(false);
        state.readerClosePanelsUntil = Date.now() + 180;
      }
    });
    window.addEventListener("resize", () => {
      if (state.isReaderOpen) {
        applyReaderTypography();
        scheduleHostReaderContextSync(120);
      }
    });
    window.addEventListener("nexora:course-workspace:layout", () => {
      if (state.materialsPageMode !== "lecture" || state.materialsDetailMode !== "lecture") {
        return;
      }

      renderLectureDetail();
    });

    el.kickerCreateTabBtn.addEventListener("click", () => setUploadTab("create"));
    el.kickerUploadTabBtn.addEventListener("click", () => setUploadTab("upload"));

    el.profileAdminSettingsBtn.addEventListener("click", () => {
      openSettingsView("users").catch((err) => showToast(`打开设置失败：${err.message || "未知错误"}`));
    });

    if (el.learningStatusBtn) {
      el.learningStatusBtn.addEventListener("click", () => {
        const opened = window.open("/api/frontend/status", "_blank", "noopener");
        if (opened) opened.opener = null;
      });
    }

    if (el.profileAgentsBtn) {
      el.profileAgentsBtn.addEventListener("click", () => {
        const opened = window.open("/api/sample/agents", "_blank", "noopener");
        if (opened) opened.opener = null;
      });
    }

    el.openCoursePickerBtn.addEventListener("click", () => {
      renderCoursePicker("");
    });
    el.materialsLectureInput.addEventListener("click", () => {
      renderCoursePicker("");
    });

    el.lectureList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const item = target.closest(".lecture-item");
      if (!item) return;
      openLectureHome(String(item.getAttribute("data-lecture-id") || ""));
    });

    el.lectureDetailPane.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const lectureCard = target.closest("[data-lecture-home-id]");
      if (lectureCard) {
        openLectureHome(String(lectureCard.getAttribute("data-lecture-home-id") || ""));
        return;
      }
    });

    if (el.courseHomePane) {
      el.courseHomePane.addEventListener("click", handleCourseHomeClick);
      el.courseHomePane.addEventListener("keydown", handleCourseHomeKeydown);
      el.courseHomeContent.addEventListener("click", handleCatalogClick);
    }

    el.materialsPreviewPane.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.id !== "coursePickerSearchInput") return;
      renderCoursePicker(target.value || "");
      const input = document.getElementById("coursePickerSearchInput");
      if (input) {
        input.focus();
        const end = String(target.value || "").length;
        input.setSelectionRange(end, end);
      }
    });

    el.materialsPreviewPane.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const courseItem = target.closest("[data-course-picker-id]");
      if (!courseItem) return;
      const lectureId = String(courseItem.getAttribute("data-course-picker-id") || "");
      if (!lectureId) return;
      setSelectedUploadLecture(lectureId);
      renderUploadPreviewEmpty("课程已选择，继续选择教材文件进行预览");
      showToast("课程选择成功");
    });

    el.settingsNavList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const item = target.closest("[data-settings-tab]");
      if (!item) return;
      state.settingsTab = String(item.getAttribute("data-settings-tab") || "refinement");
      if (state.settingsTab === "model") {
        loadModelSettings()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载模型设置失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "logs") {
        loadSettingsLogs()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载模型日志失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "channels") {
        loadLearningFeedChannels()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载频道失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "users") {
        loadSettingsUsers()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载用户列表失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "refinement") {
        loadRefinementSettings()
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载精读列表失败：${err.message || "未知错误"}`));
        return;
      }
      if (state.settingsTab === "courses") {
        Promise.all([loadMaterialsRows(), loadRefinementSettings()])
          .then(() => renderSettingsView())
          .catch((err) => showToast(`加载课程管理失败：${err.message || "未知错误"}`));
        return;
      }
      renderSettingsView();
    });

    el.settingsDetailPane.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const saveBtn = target.closest("#saveModelSettingsBtn");
      if (saveBtn) {
        saveModelSettings()
          .then(() => showToast("模型设置已保存"))
          .catch((err) => showToast(`保存失败：${err.message || "未知错误"}`));
        return;
      }
      const refreshUsersBtn = target.closest("#refreshSettingsUsersBtn");
      if (refreshUsersBtn) {
        loadSettingsUsers(state.settingsUsersQuery)
          .then(() => showToast("用户列表已刷新"))
          .catch((err) => showToast(`刷新用户列表失败：${err.message || "未知错误"}`));
        return;
      }
      const saveUserIdentityBtn = target.closest("[data-action='save-user-identity']");
      if (saveUserIdentityBtn) {
        if (saveUserIdentityBtn instanceof HTMLButtonElement && saveUserIdentityBtn.disabled) return;
        const userId = String(saveUserIdentityBtn.getAttribute("data-user-id") || "").trim();
        if (!userId) return;
        const card = saveUserIdentityBtn.closest(".settings-user-card");
        const select = card ? card.querySelector("[data-user-identity-select]") : null;
        let identity = select instanceof HTMLSelectElement ? String(select.value || "").trim().toLowerCase() : "";
        if (identity !== "student" && identity !== "teacher") identity = "student";
        if (saveUserIdentityBtn instanceof HTMLButtonElement) {
          saveUserIdentityBtn.disabled = true;
          saveUserIdentityBtn.classList.add("is-saving");
        }
        updateSettingsUserIdentity(userId, identity)
          .then((updated) => {
            if (updated) {
              patchSettingsUserCardIdentity(userId, updated);
              return;
            }
            return loadSettingsUsers(state.settingsUsersQuery);
          })
          .then(() => showToast("用户身份已更新"))
          .catch((err) => {
            if (saveUserIdentityBtn instanceof HTMLButtonElement) {
              saveUserIdentityBtn.disabled = false;
              saveUserIdentityBtn.classList.remove("is-saving");
            }
            showToast(`更新用户身份失败：${err.message || "未知错误"}`);
          });
        return;
      }
      const saveChannelBtn = target.closest("#saveFeedChannelBtn");
      if (saveChannelBtn) {
          saveFeedChannel()
              .then(() => {
                  showToast(state.channelEditState.channelId ? "频道已更新" : "频道创建成功");
                  renderSettingsChannels();
              })
              .catch((err) => showToast(`操作失败：${err.message || "未知错误"}`));
          return;
      }

      const cancelEditBtn = target.closest("#cancelEditChannelBtn");
      if (cancelEditBtn) {
          resetChannelEditState();
          renderSettingsChannels();
          return;
      }

      const createNewChannelBtn = target.closest("#createNewChannelBtn");
      if (createNewChannelBtn) {
          resetChannelEditState();
          renderSettingsChannels();
          return;
      }

      // 删除频道（必须在 select-channel 之前，因为按钮在 item 内部）
      const deleteChannelBtn = target.closest("[data-action='delete-feed-channel']");
      if (deleteChannelBtn) {
          const channelId = String(deleteChannelBtn.getAttribute("data-channel-id") || "");
          if (!channelId) return;
          confirmModalAsync("确认删除该频道？")
              .then((ok) => {
                  if (!ok) return null;
                  return removeLearningFeedChannel(channelId);
              })
              .then((result) => {
                  if (result === null) return;
                  showToast("频道已删除");
                  renderSettingsChannels();
              })
              .catch((err) => showToast(`删除频道失败：${err.message || "未知错误"}`));
          return;
      }

      const selectChannelBtn = target.closest("[data-action='select-channel']");
      if (selectChannelBtn) {
          const channelId = String(selectChannelBtn.getAttribute("data-channel-id") || "").trim();
          if (channelId) {
              openChannelEditDialog(channelId);
          }
          return;
      }

      const createSettingsCourseBtn = target.closest("[data-action='create-settings-course']");
      if (createSettingsCourseBtn) {
          try {
              await createLectureFromSettings();
              state.settingsCourseView = "detail";
              await loadMaterialsRows();
              await loadRefinementSettings();
              renderSettingsCourses();
              showToast("课程创建成功");
          } catch (err) {
              showToast(`创建失败：${err.message || "未知错误"}`);
          }
          return;
      }

      const uploadSettingsBookBtn = target.closest("[data-action='upload-settings-book']");
      if (uploadSettingsBookBtn) {
          try {
              await uploadBookFromSettings();
              state.settingsRefinementView = "detail";
              await loadMaterialsRows();
              await loadRefinementSettings();
              renderSettingsView();
              showToast("教材上传成功，已进入教材管理流程");
          } catch (err) {
              showToast(`上传失败：${err.message || "未知错误"}`);
          }
          return;
      }

      const saveRefinementBookBtn = target.closest("[data-action='save-refinement-book-info']");
      if (saveRefinementBookBtn) {
          if (saveRefinementBookBtn instanceof HTMLButtonElement && saveRefinementBookBtn.disabled) return;

          const lectureId = String(saveRefinementBookBtn.getAttribute("data-lecture-id") || "").trim();
          const bookId = String(saveRefinementBookBtn.getAttribute("data-book-id") || "").trim();

          if (!lectureId || !bookId) return;

          try {
              if (saveRefinementBookBtn instanceof HTMLButtonElement) {
                  saveRefinementBookBtn.disabled = true;
              }

              const saved = await saveRefinementBookInfo(lectureId, bookId);

              if (saved) {
                  showToast("教材资料已保存");
              }
          } catch (err) {
              showToast(`保存失败：${err.message || "未知错误"}`);
          } finally {
              if (saveRefinementBookBtn instanceof HTMLButtonElement && saveRefinementBookBtn.isConnected) {
                  saveRefinementBookBtn.disabled = false;
              }
          }

          return;
      }

      const openRefinementCoverPickerBtn = target.closest("[data-action='open-refinement-book-cover-picker']");
      if (openRefinementCoverPickerBtn) {
          const lectureId = String(openRefinementCoverPickerBtn.getAttribute("data-lecture-id") || "").trim();
          const bookId = String(openRefinementCoverPickerBtn.getAttribute("data-book-id") || "").trim();

          try {
              await openRefinementBookCoverPicker(lectureId, bookId);
          } catch (err) {
              showToast(`打开封面选择失败：${err.message || "未知错误"}`);
          }

          return;
      }

      const closeRefinementCoverPickerBtn = target.closest("[data-action='close-refinement-book-cover-picker']");
      if (closeRefinementCoverPickerBtn) {
          closeRefinementBookCoverPicker();
          return;
      }

      const selectRefinementCoverBtn = target.closest("[data-action='select-refinement-book-cover']");
      if (selectRefinementCoverBtn) {
          const coverPath = String(selectRefinementCoverBtn.getAttribute("data-cover-path") || "").trim();

          if (coverPath) {
              setRefinementBookCoverSelection(coverPath);
              closeRefinementBookCoverPicker();
          }

          return;
      }

      const clearRefinementCoverBtn = target.closest("[data-action='clear-refinement-book-cover']");
      if (clearRefinementCoverBtn) {
          setRefinementBookCoverSelection("");
          return;
      }

      const showSettingsCourseCreateBtn = target.closest("[data-action='show-settings-course-create']");
      if (showSettingsCourseCreateBtn) {
          state.settingsCourseView = "create";
          renderSettingsCourses();
          return;
      }

      const showSettingsCourseDetailBtn = target.closest("[data-action='show-settings-course-detail']");
      if (showSettingsCourseDetailBtn) {
          state.settingsCourseView = "detail";
          renderSettingsCourses();
          return;
      }

      const showSettingsBookUploadBtn = target.closest("[data-action='show-settings-book-upload']");
      if (showSettingsBookUploadBtn) {
          state.settingsRefinementView = "upload";
          renderSettingsRefinement();
          return;
      }

      const showSettingsRefinementDetailBtn = target.closest("[data-action='show-settings-refinement-detail']");
      if (showSettingsRefinementDetailBtn) {
          state.settingsRefinementView = "detail";
          renderSettingsRefinement();
          return;
      }

      const toggleSettingsBookUploadBtn = target.closest("[data-action='toggle-settings-book-upload']");
      if (toggleSettingsBookUploadBtn) {
          state.settingsRefinementView = "detail";
          renderSettingsView();
          return;
      }

      // 课程管理：选择课程
      const selectCourseBtn = target.closest("[data-action='select-settings-course']");
      if (selectCourseBtn) {
          const lectureId = String(selectCourseBtn.getAttribute("data-lecture-id") || "").trim();
          if (lectureId) {
              state.settingsCourseEditId = lectureId;
              state.settingsCourseView = "detail";
              renderSettingsCourses();
          }
          return;
      }

      // 课程管理：保存课程
      const saveCourseBtn = target.closest("[data-action='save-settings-course']");
      if (saveCourseBtn) {
          const lectureId = state.settingsCourseEditId;
          if (!lectureId) return;
          const titleInput = document.getElementById("settingsCourseTitleInput");
          const categoryInput = document.getElementById("settingsCourseCategoryInput");
          const descInput = document.getElementById("settingsCourseDescInput");
          const coverInput = document.getElementById("settingsCourseCoverInput");
          const updates = {};
          if (titleInput) updates.title = String(titleInput.value || "").trim();
          if (categoryInput) updates.category = String(categoryInput.value || "").trim();
          if (descInput) updates.description = String(descInput.value || "").trim();
          if (coverInput) updates.cover_path = String(coverInput.value || "").trim();
          try {
              await fetchJson(`/api/lectures/${encodeURIComponent(lectureId)}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(updates),
              });
              showToast("课程已更新");
              await loadMaterialsRows();
              renderSettingsCourses();
          } catch (err) {
              showToast(`保存失败：${err.message || "未知错误"}`);
          }
          return;
      }

      const startCourseOutlineBtn = target.closest("[data-action='start-course-outline']");
      if (startCourseOutlineBtn) {
          const lectureId = String(startCourseOutlineBtn.getAttribute("data-lecture-id") || "").trim();
          if (!lectureId) return;
          try {
              await startOutline(lectureId);
              renderSettingsCourses();
              showToast("已开始课程大纲生成");
          } catch (err) {
              showToast(`大纲生成启动失败：${err.message || "未知错误"}`);
          }
          return;
      }

      // 课程管理：AI 生成简介
      const genDescBtn = target.closest("[data-action='generate-course-description']");
      if (genDescBtn) {
          showToast("AI 生成功能即将上线");
          return;
      }

      // 课程管理：打开封面选择器
      const openCoverPickerBtn = target.closest("[data-action='open-cover-picker']");
      if (openCoverPickerBtn) {
          openCoverPicker();
          return;
      }

      // 课程管理：关闭封面选择器
      const closeCoverPickerBtn = target.closest("[data-action='close-cover-picker']");
      if (closeCoverPickerBtn) {
          closeCoverPicker();
          return;
      }

      // 课程管理：封面选择器背景点击关闭
      const coverPickerBackdrop = target.closest(".settings-cover-picker-backdrop");
      if (coverPickerBackdrop) {
          closeCoverPicker();
          return;
      }

      // 课程管理：选择封面图片
      const coverPickerItem = target.closest("[data-action='select-cover-image']");
      if (coverPickerItem) {
          const coverPath = String(coverPickerItem.getAttribute("data-cover-path") || "").trim();
          if (coverPath) {
              const coverInput = document.getElementById("settingsCourseCoverInput");
              const coverPreview = document.getElementById("settingsCourseCoverPreview");
              if (coverInput) coverInput.value = coverPath;
              if (coverPreview) {
                  coverPreview.innerHTML = `<img src="${escapeHtml(resolveApiUrl(coverPath))}" alt="封面">`;
              }
              closeCoverPicker();
          }
          return;
      }

      // 新建频道模式：添加用户到选择列表
      const addUserSelectionBtn = target.closest("[data-action='add-user-to-selection']");
      if (addUserSelectionBtn) {
          const userId = String(addUserSelectionBtn.getAttribute("data-user-id") || "").trim();
          if (userId) {
              state.channelEditState.selectedUserIds = [...(state.channelEditState.selectedUserIds || []), userId];
              renderChannelEditPanel();
          }
          return;
      }

      // 新建频道模式：从选择列表移除用户
      const removeUserSelectionBtn = target.closest("[data-action='remove-user-from-selection']");
      if (removeUserSelectionBtn) {
          const userId = String(removeUserSelectionBtn.getAttribute("data-user-id") || "").trim();
          if (userId) {
              state.channelEditState.selectedUserIds = (state.channelEditState.selectedUserIds || []).filter((id) => id !== userId);
              renderChannelEditPanel();
          }
          return;
      }

      // 设为全员公开
      const toggleAllPublicOnBtn = target.closest("[data-action='toggle-all-public-on']");
      if (toggleAllPublicOnBtn) {
          state.channelEditState.isAllPublic = true;
          state.channelEditState.selectedUserIds = ["ALL"];
          renderChannelEditPanel();
          return;
      }

      // 取消全员公开
      const toggleAllPublicOffBtn = target.closest("[data-action='toggle-all-public-off']");
      if (toggleAllPublicOffBtn) {
          state.channelEditState.isAllPublic = false;
          state.channelEditState.selectedUserIds = [];
          renderChannelEditPanel();
          return;
      }

      // 编辑频道模式：添加用户到频道（先更新本地状态，再异步请求）
      const addUserBtn = target.closest("[data-action='add-user-to-channel']");
      if (addUserBtn) {
          const channelId = String(addUserBtn.getAttribute("data-channel-id") || "").trim();
          const userId = String(addUserBtn.getAttribute("data-user-id") || "").trim();
          if (channelId && userId) {
              addUserToChannel(channelId, userId);
          }
          return;
      }

      // 编辑频道模式：从频道移除用户
      const removeUserBtn = target.closest("[data-action='remove-user-from-channel']");
      if (removeUserBtn) {
          const channelId = String(removeUserBtn.getAttribute("data-channel-id") || "").trim();
          const userId = String(removeUserBtn.getAttribute("data-user-id") || "").trim();
          if (channelId && userId) {
              removeUserFromChannel(channelId, userId);
          }
          return;
      }
      const startBtn = target.closest("[data-action='start-refinement']");
      if (startBtn) {
        const lectureId = String(startBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(startBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;

        if (startBtn instanceof HTMLButtonElement) {
          startBtn.disabled = true;
        }

        markRefinementItemCoarseQueued(lectureId, bookId);
        renderSettingsRefinement();

        try {
          await startRefinement(lectureId, bookId);
          showToast("已提交粗读任务");
          renderSettingsView();
        } catch (err) {
          try {
            await loadRefinementSettings();
          } catch (refreshErr) {
            renderSettingsView();
            showToast(`粗读启动失败：${err.message || "未知错误"}；状态刷新失败：${refreshErr.message || "未知错误"}`);
            return;
          }

          renderSettingsView();
          showToast("粗读启动失败：" + (err.message || "未知错误"));
        }

        return;
      }
      const stopBtn = target.closest("[data-action='stop-refinement']");
      if (stopBtn) {
        const lectureId = String(stopBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(stopBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        const ok = await confirmModalAsync("确认重置该教材状态？这会清空当前提炼进度。");
        if (!ok) return;
        stopRefinement(lectureId, bookId)
          .then(() => {
            showToast("已停止并重置教材状态");
          })
          .catch((err) => showToast("停止失败：" + (err.message || "未知错误")));
        return;
      }
      const toggleStepsBtn = target.closest("[data-action='toggle-refine-steps']");
      if (toggleStepsBtn) {
        const key = String(toggleStepsBtn.getAttribute("data-refine-key") || "");
        if (!key) return;
        state.refinementExpandedMap[key] = !state.refinementExpandedMap[key];
        renderSettingsRefinement();
        return;
      }
      const intensiveBtn = target.closest("[data-action='start-intensive']");
      if (intensiveBtn) {
        const lectureId = String(intensiveBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(intensiveBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startIntensive(lectureId, bookId)
          .then(() => {
            showToast("已开始精读");
          })
          .catch((err) => showToast("精读执行失败：" + (err.message || "未知错误")));
        return;
      }
      const sectionBtn = target.closest("[data-action='start-section']");
      if (sectionBtn) {
        const lectureId = String(sectionBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(sectionBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startSection(lectureId, bookId)
          .then(() => {
            showToast("已开始分节");
          })
          .catch((err) => showToast("分节执行失败：" + (err.message || "未知错误")));
        return;
      }
      const annotationBtn = target.closest("[data-action='start-annotation']");
      if (annotationBtn) {
        const lectureId = String(annotationBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(annotationBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startAnnotation(lectureId, bookId)
          .then(() => {
            showToast("已开始批注生成");
          })
          .catch((err) => showToast("批注执行失败：" + (err.message || "未知错误")));
        return;
      }
      const summaryBtn = target.closest("[data-action='start-summary']");
      if (summaryBtn) {
        const lectureId = String(summaryBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(summaryBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startSummary(lectureId, bookId)
          .then(() => {
            showToast("已开始全书概述生成");
          })
          .catch((err) => showToast("全书概述执行失败：" + (err.message || "未知错误")));
        return;
      }
      const videoBtn = target.closest("[data-action='start-video']");
      if (videoBtn) {
        const lectureId = String(videoBtn.getAttribute("data-lecture-id") || "");
        const bookId = String(videoBtn.getAttribute("data-book-id") || "");
        if (!lectureId || !bookId) return;
        startVideo(lectureId, bookId)
          .then(() => {
            showToast("已开始视频搜索");
            renderSettingsView();
          })
          .catch((err) => showToast("视频搜索启动失败：" + (err.message || "未知错误")));
        return;
      }
    });

    el.settingsDetailPane.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target instanceof HTMLSelectElement) {
          if (target.id === "settingsUploadLectureSelect") {
              state.settingsBookUpload.lectureId = String(target.value || "").trim();
              return;
          }

          if (target.id === "settingsLogCategorySelect") {
              state.settingsLogCategory = String(target.value || "all");
              if (state.settingsLogCategory !== "model") {
                  state.settingsLogSource = "";
              }
              loadSettingsLogs().catch((err) => showToast(`加载模型日志失败：${err.message || "未知错误"}`));
              return;
          }
          if (target.id === "settingsLogSourceSelect") {
              state.settingsLogSource = String(target.value || "");
              loadSettingsLogs().catch((err) => showToast(`加载模型日志失败：${err.message || "未知错误"}`));
              return;
          }
      }

      if (target instanceof HTMLInputElement && target.id === "settingsUploadFileInput") {
          rememberSettingsBookUploadInputFile(target);
          return;
      }

      if (target.matches(".settings-user-select-item input[type='checkbox']")) {
          const userId = String(target.value || "").trim();
          if (!userId) return;

          const selectedIds = state.channelEditState.selectedUserIds || [];
          if (target.checked) {
              if (!selectedIds.includes(userId)) {
                  state.channelEditState.selectedUserIds = [...selectedIds, userId];
              }
          } else {
              state.channelEditState.selectedUserIds = selectedIds.filter((id) => id !== userId);
          }
          renderSettingsChannels();
          return;
      }
    });

    el.settingsDetailPane.addEventListener("input", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;

      if (target.matches("[data-channel-user-search]")) {
          state.channelEditState.searchQuery = String(target.value || "").trim();
          renderSettingsChannels();

          const newSearchInput = document.querySelector("[data-channel-user-search]");
          if (newSearchInput instanceof HTMLInputElement) {
              newSearchInput.focus();
              const len = newSearchInput.value.length;
              newSearchInput.setSelectionRange(len, len);
          }
          return;
      }

      if (target.id === "settingsChannelTitleInput") {
          state.channelEditState.title = String(target.value || "").trim();
          return;
      }

      if (target.id === "settingsUploadBookTitleInput") {
          state.settingsBookUpload.title = String(target.value || "");
          return;
      }

      if (target.id === "settingsUploadFileInput") {
          rememberSettingsBookUploadInputFile(target);
          return;
      }
    });

    if (el.confirmBackdrop) {
      el.confirmBackdrop.addEventListener("click", (event) => {
        if (event.target === el.confirmBackdrop) {
          closeConfirmModal();
        }
      });
    }

    el.materialsFileInput.addEventListener("change", async () => {
      const file = el.materialsFileInput.files ? el.materialsFileInput.files[0] : null;
      await handleSelectedUploadFile(file);
    });

    if (el.materialsFileDropZone) {
      ["dragenter", "dragover"].forEach((eventName) => {
        el.materialsFileDropZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          event.stopPropagation();
          el.materialsFileDropZone.classList.add("is-dragover");
        });
      });

      ["dragleave", "drop"].forEach((eventName) => {
        el.materialsFileDropZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          event.stopPropagation();
          el.materialsFileDropZone.classList.remove("is-dragover");
        });
      });

      el.materialsFileDropZone.addEventListener("drop", async (event) => {
        const files = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : null;
        const file = files && files.length ? files[0] : null;
        await handleSelectedUploadFile(file);
      });
    }

    el.createLectureBtn.addEventListener("click", async () => {
      try {
        await createLecture();
        await refreshAll();
        setView("materials");
        closeReader();
        renderLectureList();
        renderLectureDetail();
        showToast("课程创建成功");
      } catch (err) {
        showToast(`创建失败：${err.message || "未知错误"}`);
      }
    });

    el.materialsUploadBookBtn.addEventListener("click", async () => {
      try {
        await uploadBookByFile();
        await refreshAll();
        setView("materials");
        closeReader();
        renderLectureList();
        renderLectureDetail();
        showToast("教材上传成功，已进入教材管理流程");
      } catch (err) {
        showToast(`上传失败：${err.message || "未知错误"}`);
      }
    });

  }

// ─────── Init & Bootstrap ─────────────────────────────────────────────
  function updateAdminVisibility() {
    el.profileAdminSettingsBtn.hidden = !state.isAdmin;
    if (el.openUploadViewBtn) {
      el.openUploadViewBtn.hidden = true;
    }
    if (el.courseHomeUploadBtn) {
      el.courseHomeUploadBtn.hidden = true;
    }
    if (el.courseHomeSettingsBtn) {
      el.courseHomeSettingsBtn.hidden = true;
    }
  }

  async function init() {
    state.username = getRuntimeUsername();
    syncTelemetryUserId();
    loadReaderSettings();
    setView("dashboard");
    syncReaderSettingsPanel();
    setUploadTab("create");
    renderUploadPreviewEmpty("请选择教材文件后预览");
    renderSelectedUploadFileState(null);
    setUploadTip("支持 EPUB、PDF、TXT、MD、DOCX、DOC、C、H、PY、RST", false);
    notifyHostReaderState(false);

    await loadFrontendContext();
    updateAdminVisibility();
    await refreshAll();
    bindEvents();
  }

  init().catch((err) => {
    showToast(`初始化失败：${err && err.message ? err.message : "未知错误"}`);
  });

  window.addEventListener("beforeunload", () => {
    stopSettingsPolling();
    notifyHostInputVisibility(false);
    closeReader(true);
    const telemetry = window.NXLTelemetry;
    if (telemetry && typeof telemetry.flush === "function") {
      telemetry.flush(true);
    }
  });
})();
