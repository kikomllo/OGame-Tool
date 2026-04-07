# OGame Tool - Interface Enhancer

> A comprehensive, high-performance UserScript (Tampermonkey) designed to optimize the OGame player experience by automating calculations, streamlining fleet deployments, and injecting advanced UI management tools.

## 🚀 Tech Stack
* **Language:** JavaScript (ES6+)
* **Platform:** Tampermonkey / Greasemonkey
* **Architecture:** Master Clock Game Loop & Passive DOM Injection

## ✨ Key Features
* **Server-Safe Empire Tracking:** Tracks resources across all your planets in real-time on your sidebar using mathematical extrapolation and passive local caching. Zero additional server requests, making it 100% invisible to anti-bot systems.
* **Seamless UI Integration:** Injects responsive, Flexbox-based resource tables directly into the native game dashboard with smart text-truncation and native compact number formatting.
* **Fleet Automation:** Quick-action interface for streamlined expedition deployments, including auto-healing API fetch sequences to recover expired tokens.
* **Alert System:** Desktop notifications and dynamic audio cues for critical game events (e.g., hostile attacks, fleet arrivals).

## ⚙️ Under the Hood (For Developers)
* **Master Clock Engine:** A single, unified central game loop synchronizes all DOM updates and background math, eliminating UI micro-stutters and CPU bottlenecks.
* **O(1) DOM Caching:** Caches injected UI nodes into fast RAM, preventing memory leaks and layout thrashing by avoiding expensive DOM lookups during the main application loop.
* **CSS Cloaking:** Injects styling at `document-start` to instantly hide ads and format elements before the browser's first paint, entirely preventing FOUC (Flash of Unstyled Content).

## 📥 Installation
1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension for your browser.
2. Install the script via [GreasyFork](https://update.greasyfork.org/scripts/572555/OGame%20Tool.user.js).
3. Refresh your OGame tab.