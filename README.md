# OGame Tool - Interface Enhancer

> A comprehensive, high-performance UserScript (Tampermonkey) designed to optimize the OGame player experience by automating calculations, streamlining fleet deployments, and injecting advanced UI management tools.

## 🚀 Tech Stack
* **Language:** JavaScript (ES6+)
* **Platform:** Tampermonkey / Greasemonkey
* **Architecture:** Master Clock Game Loop & Passive DOM Injection

## ✨ Key Features
* **Server-Safe Empire Tracking:** Tracks resources across all your planets in real-time on your sidebar using mathematical extrapolation and passive local caching. Zero additional server requests, making it 100% invisible to anti-bot systems.
* **Advanced Auctioneer Assistant:** Features a floating tracking panel, smart phase detection, and instant bidding via keyboard shortcuts. Automatically injects auto-healing visual keybind badges directly onto the game's UI buttons.
* **Fleet Automation:** Quick-action interface for streamlined expedition deployments. Features an asynchronous "Fire and Forget" background execution loop that updates the dispatch button's text dynamically without freezing the game or requiring page reloads.
* **Smart Shipyard Calculator:** Automatically parses OGame's universal ISO 8601 time attributes to project exact total build times for multiple units, alongside dynamic energy requirement forecasting.
* **Alert System:** Desktop notifications and dynamic audio cues for critical game events (e.g., hostile attacks, fleet arrivals).

## ⚙️ Under the Hood (For Developers)
* **Master Clock Engine:** A single, unified central game loop synchronizes all DOM updates, background math, and auto-healing UI injections, eliminating micro-stutters and CPU bottlenecks.
* **Framework Bypass Protocol:** Overrides native `HTMLInputElement.prototype.value` setters and fires synthetic bubbling events (`input`, `change`, `keyup`) to forcefully wake up and update the modern reactive frameworks (Vue/React) used by OGame's front-end.
* **Asynchronous State Machine:** The auction fetcher utilizes safe, purely structural DOM checks (e.g., `.noAuctionOverlay`) and hybrid request throttling to determine active states, completely bypassing brittle, localized text translations.
* **O(1) DOM Caching:** Caches injected UI nodes into fast RAM, preventing memory leaks and layout thrashing by avoiding expensive DOM lookups during the main application loop.
* **CSS Cloaking:** Injects styling at `document-start` to instantly hide ads and format elements before the browser's first paint, entirely preventing FOUC (Flash of Unstyled Content).

## 📥 Installation
1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension for your browser.
2. Install the script via [GreasyFork](https://update.greasyfork.org/scripts/572555/OGame%20Tool.user.js).
3. Refresh your OGame tab.
