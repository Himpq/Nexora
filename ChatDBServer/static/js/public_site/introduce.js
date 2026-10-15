/**
 * introduce.js — Nexora 公开介绍页交互
 *
 * 职责（只做三件事，不引入依赖）：
 *   1. 顶栏滚动状态 + 导航分区高亮（scrollspy）
 *   2. 分区进场动效（IntersectionObserver，尊重 prefers-reduced-motion）
 *   3. 命令行复制按钮
 *
 * 顶栏下拉菜单由同一 bundle 内的 public_site/site.js 负责。
 */
(function () {
    "use strict";

    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------- 1. 顶栏滚动状态 ---------- */
    const header = document.querySelector(".site-header");

    /* ---------- 2. 分区高亮 ---------- */
    const navLinks = Array.from(document.querySelectorAll('.main-nav a[href^="#"]'));
    const spyTargets = navLinks
        .map((link) => {
            const id = link.getAttribute("href").slice(1);
            const section = id ? document.getElementById(id) : null;

            return section ? { link, section } : null;
        })
        .filter(Boolean);

    function syncActiveSection() {
        if (spyTargets.length === 0) {
            return;
        }

        const offset = (header ? header.offsetHeight : 68) + 24;
        let current = null;

        spyTargets.forEach((target) => {
            if (target.section.getBoundingClientRect().top - offset <= 0) {
                current = target;
            }
        });

        spyTargets.forEach((target) => {
            if (target === current) {
                target.link.setAttribute("aria-current", "true");
            } else {
                target.link.removeAttribute("aria-current");
            }
        });
    }

    let scrollFrame = 0;

    function onScroll() {
        if (scrollFrame) {
            return;
        }

        scrollFrame = window.requestAnimationFrame(() => {
            scrollFrame = 0;

            if (header) {
                header.classList.toggle("is-scrolled", window.scrollY > 8);
            }

            syncActiveSection();
        });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    if (header) {
        header.classList.toggle("is-scrolled", window.scrollY > 8);
    }

    syncActiveSection();

    /* ---------- 3. 进场动效 ---------- */
    const revealItems = Array.from(document.querySelectorAll(".reveal"));

    if (revealItems.length > 0) {
        if (reduceMotion || typeof window.IntersectionObserver !== "function") {
            revealItems.forEach((item) => item.classList.add("is-in"));
        } else {
            root.classList.add("js-reveal");

            const observer = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (!entry.isIntersecting) {
                            return;
                        }

                        entry.target.classList.add("is-in");
                        observer.unobserve(entry.target);
                    });
                },
                { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
            );

            revealItems.forEach((item) => observer.observe(item));
        }
    }

    /* ---------- 4. 复制命令行 ---------- */
    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }

        return new Promise((resolve, reject) => {
            const scratch = document.createElement("textarea");

            scratch.value = text;
            scratch.setAttribute("readonly", "readonly");
            scratch.style.position = "fixed";
            scratch.style.opacity = "0";
            document.body.appendChild(scratch);
            scratch.select();

            try {
                document.execCommand("copy");
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                document.body.removeChild(scratch);
            }
        });
    }

    document.querySelectorAll("[data-copy]").forEach((button) => {
        const wrap = button.closest(".code-wrap");
        const source = wrap ? wrap.querySelector("pre code") : null;

        if (!source) {
            return;
        }

        const idleLabel = button.textContent;
        let resetTimer = 0;

        button.addEventListener("click", () => {
            copyText(source.textContent.trim()).then(
                () => {
                    button.textContent = "已复制";
                    button.classList.add("is-done");
                },
                () => {
                    button.textContent = "复制失败";
                }
            ).then(() => {
                window.clearTimeout(resetTimer);
                resetTimer = window.setTimeout(() => {
                    button.textContent = idleLabel;
                    button.classList.remove("is-done");
                }, 1600);
            });
        });
    });
}());
