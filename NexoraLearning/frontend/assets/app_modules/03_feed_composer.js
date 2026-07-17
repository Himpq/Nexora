// -------- Learning Feed Composer --------

    function getSelectedLearningFeedChannelTitle() {
        const selectedId = String(state.selectedFeedChannelId || "public_all");

        if (selectedId === "public_all") {
            return "所有动态";
        }

        const channels = Array.isArray(state.learningFeedChannels) ? state.learningFeedChannels : [];
        const selectedChannel = channels.find((row) => String((row && row.id) || "").trim() === selectedId);

        if (!selectedChannel) {
            throw new Error(`Learning 动态频道不存在: ${selectedId}`);
        }

        const channelTitle = String(selectedChannel.title || "").trim();

        if (!channelTitle) {
            throw new Error(`Learning 动态频道缺少标题: ${selectedId}`);
        }

        return channelTitle;
    }

    // 动态输入和评论共用 @用户状态，这里只渲染 dynamic-post 对应的菜单。
    function syncLearningFeedPostMentionMenu() {
        const menu = el.learningFeedPostMentionMenu;

        if (!(menu instanceof HTMLElement)) {
            throw new Error("Learning 动态输入缺少 @用户菜单容器");
        }

        const mentionState = state.feedMentionState;
        const visible = !!(
            state.dynamicPosting
            && mentionState
            && mentionState.key === "dynamic-post"
            && mentionState.visible
            && Array.isArray(mentionState.users)
            && mentionState.users.length
        );

        if (!visible) {
            menu.innerHTML = "";
            syncFeedMentionMenuVisibility(menu, false);
            return;
        }

        menu.innerHTML = buildFeedMentionMenuHtml("dynamic-post", mentionState);
        syncFeedMentionMenuVisibility(menu, true);
    }

    // 将状态一次性同步到按钮、展开面板、频道名称和发送可用性。
    function syncLearningFeedComposer(options = {}) {
        const source = options && typeof options === "object" ? options : {};
        const shell = el.learningFeedComposeShell;
        const composer = el.learningFeedComposer;
        const toggleButton = el.learningFeedComposeBtn;
        const input = el.learningFeedPostInput;
        const channel = el.learningFeedComposeChannel;
        const submitButton = el.learningFeedPostSubmitBtn;

        if (!(shell instanceof HTMLElement)
            || !(composer instanceof HTMLElement)
            || !(toggleButton instanceof HTMLButtonElement)
            || !(input instanceof HTMLTextAreaElement)
            || !(channel instanceof HTMLElement)
            || !(submitButton instanceof HTMLButtonElement)) {
            throw new Error("Learning 动态输入组件 DOM 未完整初始化");
        }

        const opened = !!state.dynamicPosting;
        const draft = String(state.feedPostDraft);
        const submitting = !!state.feedPostSubmitting;

        shell.classList.toggle("is-open", opened);
        composer.classList.toggle("is-open", opened);
        composer.setAttribute("aria-hidden", opened ? "false" : "true");
        toggleButton.setAttribute("aria-expanded", opened ? "true" : "false");
        toggleButton.setAttribute("aria-label", opened ? "收起动态输入" : "发布动态");
        toggleButton.title = opened ? "收起动态输入" : "发布动态";
        channel.textContent = getSelectedLearningFeedChannelTitle();

        if (input.value !== draft) {
            input.value = draft;
        }

        input.disabled = submitting;
        submitButton.disabled = submitting || !draft.trim();
        syncLearningFeedPostMentionMenu();

        if (opened && source.focus) {
            window.requestAnimationFrame(() => {
                input.focus({ preventScroll: true });
                const caret = input.value.length;
                input.setSelectionRange(caret, caret);
            });
        }
    }

    // 发布成功后清空草稿；失败时保持面板和原始输入，允许用户继续编辑。
    async function submitLearningFeedComposer() {
        const input = el.learningFeedPostInput;

        if (!(input instanceof HTMLTextAreaElement)) {
            throw new Error("Learning 动态输入框未初始化");
        }

        const content = String(state.feedPostDraft).trim();

        if (!content || state.feedPostSubmitting) {
            return;
        }

        state.feedPostSubmitting = true;
        syncLearningFeedComposer();

        try {
            await postLearningFeed(content);
            state.feedPostDraft = "";
            input.value = "";
            showToast("动态已发布");
        } catch (error) {
            showToast(String(error && error.message ? error.message : "发布动态失败"));
        } finally {
            state.feedPostSubmitting = false;
            syncLearningFeedComposer();
        }
    }

    function applyLearningFeedPostMentionSelection(index) {
        const mentionState = state.feedMentionState;
        const input = el.learningFeedPostInput;
        const user = mentionState && Array.isArray(mentionState.users)
            ? mentionState.users[index]
            : null;

        if (!(input instanceof HTMLTextAreaElement) || !user) {
            return false;
        }

        const applied = applyMentionSelectionToInput(input, user);

        if (applied) {
            state.feedPostDraft = input.value;
            syncLearningFeedComposer({ focus: true });
        }

        return applied;
    }

    function handleLearningFeedComposerKeydown(event) {
        const input = el.learningFeedPostInput;

        if (!(input instanceof HTMLTextAreaElement) || event.target !== input) {
            return;
        }

        if (input.dataset.composing === "true" || event.isComposing) {
            return;
        }

        const mentionState = state.feedMentionState;
        const mentionVisible = !!(
            mentionState
            && mentionState.key === "dynamic-post"
            && mentionState.visible
            && Array.isArray(mentionState.users)
            && mentionState.users.length
        );

        if (mentionVisible && event.key === "ArrowDown") {
            event.preventDefault();
            mentionState.activeIndex = (Number(mentionState.activeIndex || 0) + 1) % mentionState.users.length;
            syncLearningFeedPostMentionMenu();
            return;
        }

        if (mentionVisible && event.key === "ArrowUp") {
            event.preventDefault();
            mentionState.activeIndex = (Number(mentionState.activeIndex || 0) - 1 + mentionState.users.length) % mentionState.users.length;
            syncLearningFeedPostMentionMenu();
            return;
        }

        if (mentionVisible && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            applyLearningFeedPostMentionSelection(Number(mentionState.activeIndex || 0));
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();

            if (mentionVisible) {
                resetFeedMentionState();
                syncLearningFeedPostMentionMenu();
                return;
            }

            exitLearningFeedComposeMode();
            return;
        }

        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submitLearningFeedComposer();
        }
    }

    // 组件事件只绑定一次，所有草稿、输入法和 @用户状态均由 NexoraLearning 自己持有。
    function bindLearningFeedComposerEvents() {
        const shell = el.learningFeedComposeShell;
        const toggleButton = el.learningFeedComposeBtn;
        const input = el.learningFeedPostInput;
        const mentionMenu = el.learningFeedPostMentionMenu;
        const submitButton = el.learningFeedPostSubmitBtn;

        if (!(shell instanceof HTMLElement)
            || !(toggleButton instanceof HTMLButtonElement)
            || !(input instanceof HTMLTextAreaElement)
            || !(mentionMenu instanceof HTMLElement)
            || !(submitButton instanceof HTMLButtonElement)) {
            throw new Error("Learning 动态输入组件无法绑定事件：DOM 不完整");
        }

        if (shell.dataset.bound === "1") {
            return;
        }

        shell.dataset.bound = "1";
        toggleButton.addEventListener("click", () => {
            if (state.dynamicPosting) {
                exitLearningFeedComposeMode();
                return;
            }

            enterFeedComposeMode();
        });
        submitButton.addEventListener("click", () => {
            void submitLearningFeedComposer();
        });
        input.addEventListener("input", () => {
            state.feedPostDraft = String(input.value || "");
            syncLearningFeedComposer();

            if (input.dataset.composing === "true") {
                return;
            }

            updateFeedMentionCandidates(input).catch((error) => {
                console.error("Learning 动态 @用户搜索失败", error);
                resetFeedMentionState();
                syncLearningFeedPostMentionMenu();
            });
        });
        input.addEventListener("compositionstart", () => {
            input.dataset.composing = "true";
        });
        input.addEventListener("compositionend", () => {
            delete input.dataset.composing;
            state.feedPostDraft = String(input.value || "");
            updateFeedMentionCandidates(input).catch((error) => {
                console.error("Learning 动态 @用户搜索失败", error);
                resetFeedMentionState();
                syncLearningFeedPostMentionMenu();
            });
        });
        input.addEventListener("keydown", handleLearningFeedComposerKeydown);
        mentionMenu.addEventListener("click", (event) => {
            const target = event.target;

            if (!(target instanceof Element)) {
                return;
            }

            const option = target.closest("[data-mention-index]");

            if (!(option instanceof HTMLButtonElement)) {
                return;
            }

            event.preventDefault();
            applyLearningFeedPostMentionSelection(Number(option.getAttribute("data-mention-index") || 0));
        });
        syncLearningFeedComposer();
    }
