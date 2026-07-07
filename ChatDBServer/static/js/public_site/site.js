(function () {
    const header = document.querySelector(".site-header");
    const menuGroups = Array.from(document.querySelectorAll(".nav-menu-group"));
    const closeDelayMs = 300;
    const hoverSwitchDelayMs = 250;
    let activeGroup = null;
    let closeTimer = 0;
    let openTimer = 0;

    if (!header || menuGroups.length === 0) {
        return;
    }

    function clearCloseTimer() {

        if (!closeTimer) {
            return;
        }

        window.clearTimeout(closeTimer);
        closeTimer = 0;
    }

    function clearOpenTimer() {

        if (!openTimer) {
            return;
        }

        window.clearTimeout(openTimer);
        openTimer = 0;
    }

    function isInsideHeader(target) {
        return Boolean(target && header.contains(target));
    }

    function closeActiveGroup() {
        clearOpenTimer();
        clearCloseTimer();
        activeGroup = null;

        menuGroups.forEach((group) => {
            group.classList.remove("is-open");
        });
    }

    function setActiveGroup(group) {
        clearOpenTimer();
        clearCloseTimer();
        activeGroup = group;

        menuGroups.forEach((item) => {
            item.classList.toggle("is-open", item === group);
        });
    }

    function scheduleActiveGroup(group) {
        clearOpenTimer();
        clearCloseTimer();

        openTimer = window.setTimeout(() => {
            setActiveGroup(group);
        }, hoverSwitchDelayMs);
    }

    function scheduleClose() {
        clearOpenTimer();
        clearCloseTimer();

        closeTimer = window.setTimeout(() => {
            closeActiveGroup();
        }, closeDelayMs);
    }

    // 顶部菜单停留判定：titlebar 内移动不收起，真正离开后延迟关闭。
    menuGroups.forEach((group) => {
        group.addEventListener("mouseenter", () => {
            scheduleActiveGroup(group);
        });

        group.addEventListener("focusin", () => {
            setActiveGroup(group);
        });

        group.addEventListener("mouseleave", (event) => {
            clearOpenTimer();

            if (isInsideHeader(event.relatedTarget)) {
                clearCloseTimer();
                return;
            }

            scheduleClose();
        });

        group.addEventListener("focusout", () => {
            window.setTimeout(() => {

                if (isInsideHeader(document.activeElement)) {
                    return;
                }

                scheduleClose();
            }, 0);
        });
    });

    header.addEventListener("mouseenter", () => {

        if (!activeGroup) {
            return;
        }

        clearCloseTimer();
    });

    header.addEventListener("mousemove", () => {

        if (!activeGroup) {
            return;
        }

        clearCloseTimer();
    });

    header.addEventListener("mouseleave", (event) => {

        if (isInsideHeader(event.relatedTarget)) {
            return;
        }

        scheduleClose();
    });

    document.addEventListener("keydown", (event) => {

        if (event.key !== "Escape") {
            return;
        }

        closeActiveGroup();
    });
}());

(function () {
    const panel = document.querySelector(".updates-visual-panel");

    if (!panel) {
        return;
    }

    const titleEl = panel.querySelector("#updatesVisualTitle");
    const descEl = panel.querySelector("#updatesVisualDesc");
    const items = Array.from(panel.querySelectorAll(".updates-visual-points article"));

    if (!titleEl || !descEl || items.length === 0) {
        return;
    }

    function setActiveUpdate(item) {
        const title = String(item.dataset.updateTitle || "").trim();
        const desc = String(item.dataset.updateDesc || "").trim();
        const image = String(item.dataset.updateImage || "").trim();

        if (title) {
            titleEl.textContent = title;
        }

        if (desc) {
            descEl.textContent = desc;
        }

        if (image) {
            panel.style.setProperty("--updates-image", `url("${image}")`);
        }

        items.forEach((entry) => {
            entry.classList.toggle("is-active", entry === item);
        });
    }

    items.forEach((item) => {
        item.addEventListener("mouseenter", () => setActiveUpdate(item));
        item.addEventListener("focus", () => setActiveUpdate(item));
        item.addEventListener("click", () => setActiveUpdate(item));
    });

    setActiveUpdate(items[0]);
}());

(function () {
    const carousel = document.querySelector("[data-capability-carousel]");

    if (!carousel) {
        return;
    }

    const track = carousel.querySelector(".capability-track");
    const slides = Array.from(carousel.querySelectorAll("[data-capability-slide]"));
    const controls = Array.from(carousel.querySelectorAll("[data-capability-index]"));

    if (!track || slides.length === 0) {
        return;
    }

    let activeIndex = 0;
    let wheelLocked = false;

    function setActiveSlide(nextIndex) {
        const maxIndex = slides.length - 1;
        activeIndex = Math.max(0, Math.min(maxIndex, nextIndex));

        carousel.style.setProperty("--capability-index", String(activeIndex));

        slides.forEach((slide, index) => {
            slide.classList.toggle("is-active", index === activeIndex);
        });

        controls.forEach((control, index) => {
            control.classList.toggle("is-active", index === activeIndex);
        });
    }

    controls.forEach((control) => {
        control.addEventListener("click", () => {
            const nextIndex = Number.parseInt(control.dataset.capabilityIndex || "0", 10);

            setActiveSlide(Number.isFinite(nextIndex) ? nextIndex : 0);
        });
    });

    carousel.addEventListener("wheel", (event) => {
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;

        if (Math.abs(delta) < 12) {
            return;
        }

        const direction = delta > 0 ? 1 : -1;
        const nextIndex = activeIndex + direction;

        if (nextIndex < 0 || nextIndex >= slides.length) {
            return;
        }

        event.preventDefault();

        if (wheelLocked) {
            return;
        }

        wheelLocked = true;
        setActiveSlide(nextIndex);

        window.setTimeout(() => {
            wheelLocked = false;
        }, 620);
    }, { passive: false });

    setActiveSlide(0);
}());
