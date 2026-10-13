/**
 * github-project-settings.js — 从 GitHub 公共 API 读取仓库概览和语言占比。
 */
(function () {
    "use strict";

    var REPOSITORY_API = "https://api.github.com/repos/Himpq/Nexora";
    var CONTRIBUTOR_API = REPOSITORY_API + "/contributors?anon=1&per_page=1";
    var LANGUAGE_COLORS = {
        Python: "#3572a5",
        JavaScript: "#f1e05a",
        CSS: "#563d7c",
        Vue: "#41b883",
        TypeScript: "#3178c6",
        HTML: "#e34c26",
        SCSS: "#c6538c",
        Less: "#1d365d",
        Shell: "#89e051",
        Java: "#b07219",
        PowerShell: "#012456",
        Batchfile: "#c1f12e",
        Kotlin: "#a97bff",
        Go: "#00add8",
        Rust: "#dea584",
        Ruby: "#701516",
        "C++": "#f34b7d",
        C: "#555555",
        Other: "#e5e7eb"
    };
    var VISIBLE_LANGUAGE_COUNT = 6;
    var state = {
        loading: false
    };

    function byId(id) {
        return document.getElementById(id);
    }

    async function requestJson(url, signal) {
        var response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/vnd.github+json"
            },
            cache: "no-store",
            credentials: "omit",
            signal: signal
        });

        var data;

        try {
            data = await response.json();
        } catch (error) {
            throw new Error("GitHub 返回的数据无法解析。");
        }

        if (!response.ok) {
            throw new Error("GitHub API 请求失败（HTTP " + response.status + "）。");
        }

        return {
            data: data,
            response: response
        };
    }

    function readLastPage(linkHeader) {
        var links = String(linkHeader || "").split(/,\s*(?=<)/);

        for (var index = 0; index < links.length; index += 1) {
            if (!/;\s*rel="last"/.test(links[index])) {
                continue;
            }

            var page = links[index].match(/[?&]page=(\d+)/);

            if (page) {
                return Number(page[1]);
            }
        }

        return null;
    }

    /** 读取分页头的最后一页号，无需下载完整贡献者列表。 */
    async function readContributorCount(signal) {
        var result = await requestJson(CONTRIBUTOR_API, signal);

        if (!Array.isArray(result.data)) {
            throw new Error("GitHub 返回的贡献者数据格式不正确。");
        }

        var lastPage = readLastPage(result.response.headers.get("Link"));

        return lastPage === null ? result.data.length : lastPage;
    }

    /** 以 GitHub 返回的字节数计算比例，并将第七名之后合并为 Other。 */
    function createLanguageCategories(languageBytes) {
        if (!languageBytes || typeof languageBytes !== "object" || Array.isArray(languageBytes)) {
            throw new Error("GitHub 返回的语言统计格式不正确。");
        }

        var languages = Object.keys(languageBytes).map(function (name) {
            var bytes = Number(languageBytes[name]);

            if (!Number.isFinite(bytes) || bytes <= 0) {
                throw new Error("GitHub 返回了无效的语言字节数。");
            }

            return {
                name: name,
                bytes: bytes
            };
        }).sort(function (left, right) {
            return right.bytes - left.bytes;
        });

        var totalBytes = languages.reduce(function (total, language) {
            return total + language.bytes;
        }, 0);

        if (totalBytes <= 0) {
            throw new Error("GitHub 尚未提供仓库语言统计。");
        }

        var categories = languages.slice(0, VISIBLE_LANGUAGE_COUNT);
        var otherBytes = languages.slice(VISIBLE_LANGUAGE_COUNT).reduce(function (total, language) {
            return total + language.bytes;
        }, 0);

        if (otherBytes > 0) {
            categories.push({
                name: "Other",
                bytes: otherBytes
            });
        }

        categories.forEach(function (category) {
            if (!LANGUAGE_COLORS[category.name]) {
                throw new Error("GitHub 返回了尚未配置颜色的主要语言：" + category.name + "。");
            }
        });

        return {
            totalBytes: totalBytes,
            categories: categories
        };
    }

    function formatCount(value) {
        var count = Number(value);

        if (!Number.isInteger(count) || count < 0) {
            throw new Error("GitHub 返回了无效的仓库统计数字。");
        }

        return new Intl.NumberFormat("zh-CN").format(count);
    }

    function renderRepository(repository, contributorCount) {
        if (!repository || repository.full_name !== "Himpq/Nexora") {
            throw new Error("GitHub 返回的仓库与 Himpq/Nexora 不匹配。");
        }

        if (typeof repository.description !== "string" || !repository.owner || typeof repository.owner.avatar_url !== "string") {
            throw new Error("GitHub 返回的仓库简介或头像信息不完整。");
        }

        byId("github-project-description").textContent = repository.description;
        byId("github-project-description").classList.remove("is-error");
        byId("github-contributors-count").textContent = formatCount(contributorCount);
        byId("github-issues-count").textContent = formatCount(repository.open_issues_count);
        byId("github-stars-count").textContent = formatCount(repository.stargazers_count);
        byId("github-forks-count").textContent = formatCount(repository.forks_count);

        var avatar = byId("github-owner-avatar");
        var avatarUrl = repository.owner.avatar_url;

        var parsedAvatarUrl = new URL(avatarUrl);

        if (parsedAvatarUrl.protocol !== "https:" || parsedAvatarUrl.hostname !== "avatars.githubusercontent.com") {
            throw new Error("GitHub 返回了无效的仓库头像地址。");
        }

        avatar.src = parsedAvatarUrl.href;
        avatar.classList.add("is-visible");
    }

    function renderLanguages(languageStats) {
        var bar = byId("github-language-bar");
        var accessibleNames = [];

        bar.replaceChildren();

        languageStats.categories.forEach(function (category) {
            var percentage = category.bytes / languageStats.totalBytes * 100;
            var percentageText = percentage.toFixed(1) + "%";
            var color = LANGUAGE_COLORS[category.name];
            var segment = document.createElement("span");

            segment.className = "github-language-segment";
            segment.style.width = percentage.toFixed(4) + "%";
            segment.style.backgroundColor = color;
            segment.title = category.name + " " + percentageText;
            bar.appendChild(segment);
            accessibleNames.push(category.name + " " + percentageText);
        });

        bar.setAttribute("aria-label", accessibleNames.join("，"));
        bar.classList.add("is-visible");
    }

    function clearRepositoryData() {
        var description = byId("github-project-description");
        description.textContent = "正在从 GitHub 读取仓库简介、统计和语言占比…";
        description.classList.remove("is-error");
        byId("github-contributors-count").textContent = "—";
        byId("github-issues-count").textContent = "—";
        byId("github-stars-count").textContent = "—";
        byId("github-forks-count").textContent = "—";

        var avatar = byId("github-owner-avatar");
        avatar.removeAttribute("src");
        avatar.classList.remove("is-visible");

        var bar = byId("github-language-bar");
        bar.replaceChildren();
        bar.classList.remove("is-visible");
    }

    /** 每次打开设置页或手动刷新时读取 GitHub 当前公开统计。 */
    async function loadRepositoryData() {
        if (state.loading) {
            return;
        }

        state.loading = true;

        var controller = new AbortController();
        var timeoutId = window.setTimeout(function () {
            controller.abort();
        }, 12000);

        clearRepositoryData();

        try {
            var results = await Promise.all([
                requestJson(REPOSITORY_API, controller.signal),
                requestJson(REPOSITORY_API + "/languages", controller.signal),
                readContributorCount(controller.signal)
            ]);
            var languageStats = createLanguageCategories(results[1].data);

            renderRepository(results[0].data, results[2]);
            renderLanguages(languageStats);
        } catch (error) {
            clearRepositoryData();

            var message = error && error.name === "AbortError"
                ? "GitHub 请求超时，请检查网络后重试。"
                : String(error && error.message || "GitHub 数据读取失败。");

            var description = byId("github-project-description");
            description.textContent = "GitHub 数据读取失败：" + message + "重新打开设置页可重试。";
            description.classList.add("is-error");
            console.error("[github-project-settings] GitHub 数据读取失败", error);
        } finally {
            window.clearTimeout(timeoutId);
            state.loading = false;
        }
    }

    loadRepositoryData();
})();
