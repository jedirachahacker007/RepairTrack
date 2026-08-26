(function () {
    "use strict";
    if (window.__themeToggleInitialized) return;
    window.__themeToggleInitialized = true;

    var STORAGE_KEY = "kc-theme";

    function getSavedTheme() {
        return localStorage.getItem(STORAGE_KEY) || "light";
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem(STORAGE_KEY, theme);
        updateToggleButtons(theme);
    }

    function toggleTheme() {
        var current = document.documentElement.getAttribute("data-theme") || getSavedTheme();
        var next = current === "dark" ? "light" : "dark";
        applyTheme(next);
    }

    function updateToggleButtons(theme) {
        var buttons = document.querySelectorAll(".theme-toggle-btn, #themeToggleBtn, #sideNavThemeBtn");
        buttons.forEach(function (btn) {
            var iconEl = btn.querySelector(".theme-icon");
            var labelEl = btn.querySelector(".theme-label");
            if (theme === "dark") {
                if (iconEl) iconEl.textContent = "☀️";
                if (labelEl) labelEl.textContent = "Light Mode";
                btn.setAttribute("title", "สลับเป็นโหมดสว่าง (Light Mode)");
                btn.setAttribute("aria-label", "สลับเป็นโหมดสว่าง");
            } else {
                if (iconEl) iconEl.textContent = "🌙";
                if (labelEl) labelEl.textContent = "Dark Mode";
                btn.setAttribute("title", "สลับเป็นโหมดมืด (Dark Mode)");
                btn.setAttribute("aria-label", "สลับเป็นโหมดมืด");
            }
        });
    }

    // Apply immediately on load
    var currentTheme = getSavedTheme();
    document.documentElement.setAttribute("data-theme", currentTheme);

    document.addEventListener("DOMContentLoaded", function () {
        updateToggleButtons(currentTheme);

        document.addEventListener("click", function (e) {
            var target = e.target.closest(".theme-toggle-btn, #themeToggleBtn, #sideNavThemeBtn");
            if (target) {
                e.preventDefault();
                e.stopPropagation();
                toggleTheme();
            }
        });
    });

    window.toggleKCTheme = toggleTheme;
})();
