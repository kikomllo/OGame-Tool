// ==UserScript==
// @name         OGame Tool
// @namespace    http://tampermonkey.net/
// @version      1.16
// @description  My First Script, hope you enjoy!
// @author       You
// @match        *://*.ogame.gameforge.com/*
// @include      *://*.ogame.gameforge.com/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://update.greasyfork.org/scripts/572555/OGame%20Tool.user.js
// @updateURL    https://update.greasyfork.org/scripts/572555/OGame%20Tool.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // --- CROSS-BROWSER BRIDGE ---
    const gameWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // --- SCRIPT CONFIGURATION (KEYBINDS) ---
    const Config = {
        keybinds: {
            sendExpos: 'e',
            upgradeItem: 'Enter',
            maxBids: ['w', 's', 'x'],
            smallBids: ['q', 'a', 'z'],
            clearBids: 'd',
        }
    };

    // --- GLOBAL GAME STATE ---
    const GameState = {
        currentPlanetID: null,
        resources: { metal: 0, crystal: 0, deuterium: 0, energy: 0 },
        fleet: { current: 0, max: 0, expos: 0, maxExpos: 0 },
        empireData: {},
        auction: {
            active: false,
            timeText: "Unknown",
            shadowEndTime: 0,
            shadowNextAuction: 0,
            currentSum: "0",
            nextFetch: 0
        }
    };

    // --- MASTER CLOCK QUEUE ---
    const MasterClockQueue = [];

    // --- GLOBALS ---
    const FLEET_BTN_ID = "customExpoBtn";
    const FLEET_SECBTN_ID = "customExpoSecBtn";
    const PANEL_ID = "customPanel";

    const rowCount = 6;
    let audioCtx = null;
    let beeped = false;
    let attackedState = false;

    let UINodes = {};

    if (!localStorage.getItem("expoFleet")){
        localStorage.setItem("expoFleet", "");
    }

    const shipNames = [
        ["fighterlight", 204], ["fighterheavy", 205],
        ["cruiser", 206], ["battleship", 207],
        ["interceptor", 215], ["bomber", 211],
        ["destroyer", 213], ["reaper", 218],
        ["explorer", 219], ["transportersmall", 202],
        ["transporterlarge", 203], ["espionageprobe", 210]
    ];

    // --- HELPERS ---
    const Helpers = {
        parseCleanJSON: function(rawText) {
            if (rawText.includes("var MAX_")) {
                const firstBracket = rawText.indexOf('{');
                if (firstBracket !== -1) return JSON.parse(rawText.substring(firstBracket));
            }
            return JSON.parse(rawText);
        },

        compactNumber: new Intl.NumberFormat('en-US', {
            notation: "compact",
            maximumFractionDigits: 1
        }),

        convSecToTime: function(totalSeconds) {
            if (totalSeconds < 0) return "";
            if (totalSeconds == 0) return "Full";

            let values = [
                Math.floor(totalSeconds / 86400),         // DAYS
                Math.floor((totalSeconds / 3600) % 24),   // HOURS
                Math.floor((totalSeconds / 60) % 60),     // MINUTES
                Math.floor(totalSeconds % 60)             // SECONDS
            ];

            let string = "";
            if (values[0] > 0) string += values[0] + "d ";
            if (values[1] > 0) string += values[1] + "h ";
            if (values[0] <= 0 && values[2] > 0) string += values[2] + "m ";
            if (values[1] <= 0) string += values[3] + "s";

            return string.trim();
        },

        parseISO8601Duration: function(duration) {
            if (!duration) return 0;
            let regex = /P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i;
            let m = duration.match(regex);
            if (!m) return 0;

            return (+(m[1]||0) * 86400) + (+(m[2]||0) * 3600) + (+(m[3]||0) * 60) + +(m[4]||0);
        },

        simulateClick: function(element) {
            if (!element) return;
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            element.dispatchEvent(clickEvent);
        },

        typeValue: function(inputElement, newValue) {
            if (!inputElement) return;
            let nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            nativeInputValueSetter.call(inputElement, newValue);
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        },

        waitForElement: function(selector) {
            return new Promise(resolve => {
                if (document.querySelector(selector)) return resolve(document.querySelector(selector));
                const observer = new MutationObserver(mutations => {
                    if (document.querySelector(selector)) {
                        observer.disconnect();
                        resolve(document.querySelector(selector));
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
            });
        },

        sleep: async function(miliseconds) {
            await new Promise(r => setTimeout(r, miliseconds));
        },

        isPage: function(URLpart) {
            const URL = gameWindow.location.href;
            if (!URL) return false;
            return URL.includes(URLpart);
        }
    };

    // --- ALERTS SCRIPT ---
    function AlertsScript(volume=0.5) {
        
        function initAudioContext() {
            if (!audioCtx) {
                const AudioContext = gameWindow.AudioContext || gameWindow.webkitAudioContext;
                audioCtx = new AudioContext();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        }
        function unlockAudio() {
            initAudioContext();
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('keydown', unlockAudio);
        }
        document.addEventListener('click', unlockAudio);
        document.addEventListener('keydown', unlockAudio);
        initAudioContext();

        function notifyUser(urgent = false) {
            if (!("Notification" in gameWindow)) {
                console.error("[-] WARNING: This browser does not support desktop notification");
                return;
            }
            if (Notification.permission === "granted") {
                createNotification(urgent);
            } else if (Notification.permission !== "denied") {
                Notification.requestPermission().then((permission) => {
                    if (permission === "granted") {
                        createNotification(urgent);
                    }
                });
            }
        }

        function createNotification(urgent) {
            const notif = new Notification((urgent) ? "ATTACK!!!!!!" : "Fleet Timer Out!", {
                body: (urgent) ? "YOU ARE BEING ATTACKED!!!!" : "Your fleet has arrived!",
                icon: "https://cdn-icons-png.flaticon.com/512/1827/1827347.png",
                requireInteraction: false
            });
            notif.onclick = function() {
                gameWindow.focus();
            };
        }

        function playBeep(frequency = 1600) {
            if (!audioCtx) return;
            const playSound = () => {
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.type = "sine";
                oscillator.frequency.value = frequency;
                gainNode.gain.value = volume;
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 0.100);
            };

            if (audioCtx.state === 'suspended') {
                audioCtx.resume().then(() => { playSound(); }).catch(err => {
                    console.warn("Audio blocked. Awaiting user interaction.", err);
                });
            } else {
                playSound();
            }
        }

        async function normalAlert(){
            playBeep(1000); await Helpers.sleep(100);
            playBeep(1200); await Helpers.sleep(100);
            playBeep(1000); await Helpers.sleep(100);
            playBeep(1600);
        }

        async function attackAlert(){
            playBeep(1000);
        }

        function checkFleetEvents() {
            const flexiblePattern = /^(?:\d+h\s*)?(?:\d+m\s*)?(?:\d+s)?$/;
            let timerElement = document.querySelector("#tempcounter");
            let attackElementOn = document.querySelector(".soon");
            if (!timerElement) return;
            let timeText = timerElement.textContent.trim();

            if(attackElementOn){
                if (!attackedState){
                    notifyUser(true);
                    attackedState = true;
                }
                attackAlert();
            } else {
                attackedState = false;
            }

            if (!flexiblePattern.test(timeText) && timeText) {
                if (!beeped){
                    console.log("Fleet Arrived! Beeping!");
                    notifyUser();
                    normalAlert();
                    beeped = true;
                }
            } else beeped = false;
        }

        MasterClockQueue.push(checkFleetEvents);
    }

    // --- RESOURCES SCRIPT ---
    function ResourcesScript() {

        let empEconomy = GameState.empireData;
        let hasScrapedThisVisit = false;

        function scrapeMineLevels() {
            if (!Helpers.isPage('component=supplies')) {
                hasScrapedThisVisit = false;
                return;
            }
            if (hasScrapedThisVisit) return;

            const metaPlanet = document.querySelector('meta[name="ogame-planet-id"]');
            if (!metaPlanet) return;

            const currentPlanetID = metaPlanet.content;

            Helpers.waitForElement('.technology[data-technology="1"] .level').then(() => {
                let m = document.querySelector('.technology[data-technology="1"] .level');
                let c = document.querySelector('.technology[data-technology="2"] .level');
                let d = document.querySelector('.technology[data-technology="3"] .level');

                if (m && c && d) {
                    if (!empEconomy[currentPlanetID]) empEconomy[currentPlanetID] = {};

                    empEconomy[currentPlanetID].mines = {
                        metal: parseInt(m.dataset.value, 10),
                        crystal: parseInt(c.dataset.value, 10),
                        deuterium: parseInt(d.dataset.value, 10)
                    };

                    localStorage.setItem("EmpireEconomy", JSON.stringify(empEconomy));
                    console.log(`[Scraper] Mine levels saved for planet ${currentPlanetID}`);
                }
            });

            hasScrapedThisVisit = true;
        }

        function getValuesByType(data, type){
            let values = data.resources[type];
            if (!values) return null;
            return {
                production: parseFloat(values.production),
                current: parseFloat(values.amount),
                max: parseFloat(values.storage)
            };
        }

        function getResourcesMissingSeconds(values){
            if (!values) return 0;
            let production = values.production;
            let current = values.current;
            let max = values.max;
            if (production <= 0) return -1;
            if (current >= max) return 0;
            return Math.floor((max - current) / production);
        }

        function updateUITimer(type, timeString) {
            let container = document.querySelector("#" + type + "_box");
            if (!container) return;
            let timerDiv = container.querySelector("#timer-" + type);
            if (!timerDiv) {
                timerDiv = document.createElement("div");
                timerDiv.id = "timer-" + type;
                timerDiv.className = "my-resource-timer";
                container.appendChild(timerDiv);
            }
            timerDiv.textContent = timeString;
            timerDiv.style.color = (timeString === "Full") ? "#d43635" : "#999";
        }

        function fetchInitialResources() {
            const url = "/game/index.php?page=fetchResources&ajax=1";
            fetch(url)
                .then(response => response.text())
                .then(text => Helpers.parseCleanJSON(text))
                .then(data => {
                    const metaPlanet = document.querySelector('meta[name="ogame-planet-id"]');
                    if (!metaPlanet) return;
                    const currentPlanetID = metaPlanet.content;
                    const types = ["metal", "crystal", "deuterium"];

                    let existingMines = empEconomy[currentPlanetID]?.mines || null;

                    let planetEconomy = {
                        timestamp: Date.now(),
                        mines: existingMines,
                        metal: getValuesByType(data, types[0]),
                        crystal: getValuesByType(data, types[1]),
                        deuterium: getValuesByType(data, types[2])
                    };

                    empEconomy[currentPlanetID] = planetEconomy;
                    localStorage.setItem("EmpireEconomy", JSON.stringify(empEconomy));
                })
                .catch(err => console.error("[!] ERROR: Resource fetch. Reason:", err));
        }

        function localResourceTick() {
            if (!GameState.currentPlanetID) return;
            let planet = empEconomy[GameState.currentPlanetID];
            if (!planet) return;

            let secondsElapsed = (Date.now() - planet.timestamp) / 1000;
            const types = ["metal", "crystal", "deuterium"];

            types.forEach(type => {
                let resData = planet[type];
                if (!resData) return;

                let extrapolated = resData.current + (resData.production * secondsElapsed);
                extrapolated = Math.min(extrapolated, resData.max);

                GameState.resources[type] = extrapolated;

                let currentVirtualState = {
                    production: resData.production,
                    current: extrapolated,
                    max: resData.max
                };

                let seconds = getResourcesMissingSeconds(currentVirtualState);
                updateUITimer(type, Helpers.convSecToTime(seconds));
            });

            // --- MASTER CLOCK UI RENDERER ---
            for (let pID in empEconomy) {
                let pData = empEconomy[pID];
                let ui = UINodes[pID];

                if (!ui || !ui.res || !ui.mines) continue;

                if (pData.timestamp) {
                    let pSecondsElapsed = (Date.now() - pData.timestamp) / 1000;

                    let getLive = (resObj) => {
                        if (!resObj) return 0;
                        let extra = resObj.current + (resObj.production * pSecondsElapsed);
                        return Math.max(Math.floor(Math.min(extra, resObj.max)), resObj.current);
                    };

                    ui.res.children[0].textContent = Helpers.compactNumber.format(getLive(pData.metal));
                    ui.res.children[1].textContent = Helpers.compactNumber.format(getLive(pData.crystal));
                    ui.res.children[2].textContent = Helpers.compactNumber.format(getLive(pData.deuterium));
                }

                if (pData.mines) {
                    ui.mines.children[0].textContent = pData.mines.metal;
                    ui.mines.children[1].textContent = pData.mines.crystal;
                    ui.mines.children[2].textContent = pData.mines.deuterium;
                }
            }
        }

        fetchInitialResources();
        MasterClockQueue.push(scrapeMineLevels);
        MasterClockQueue.push(localResourceTick);
    }

    // --- CSS ---
    function GlobalStyle() {
        let css = `
            /* --- EXPO PANEL CSS --- */

            #${PANEL_ID} {
                position: absolute;
                z-index: 99999;
                background-color: #161b23EE; border: 1px solid #455266; color: white;
                padding: 15px; width: auto; height: auto; border-radius: 4px;
                box-shadow: 4px 4px 10px rgba(0,0,0,0.8); display: none;
            }
            #${PANEL_ID} h3 {
                margin-top: 0;
                border-bottom: 1px solid #455266; padding-bottom: 5px;
                text-align: center; color: #ff9600; font-size: 14px;
            }

            #expoTable { list-style: none; padding: 0; margin: 0; }

            .expo-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }

            .compact-input { width: 40px !important; height: 22px; padding-left: 4px; padding-right: 4px; position: relative; }

            /* --- GLOBAL OGAME OVERRIDES --- */

            .planetBarSpaceObjectHighlightContainer {
                width: 23px !important;
                height: 23px !important;
                margin-left: 3.5px !important;
                margin-right: 10px !important;
            }

            .planetBarSpaceObjectContainer {
                justify-content: flex-start !important;
                height: 20px !important;
                margin-top: 10px !important;
            }

            .smallplanet {
                height: 50px !important; /* Ligeiramente maior para caber a linha extra em baixo */
                width: 140px !important;
                position: relative !important; /* CRÍTICO: Cria a caixa-limite para a tabela de minas ancorar */
            }

            .planetPic {
                width: 30px !important;
                height: 30px !important;
                padding-right: 5px;
            }

            .planet-name {
                margin-right: auto !important;
                margin-left: 0px !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                max-width: 60px !important;
            }

            .planet-koords {
                font-size: 9px !important;
            }

            a.constructionIcon {
                top: 25px !important;
                right: 113px !important;
            }

            #planetList:not(.custom-ready) {
                opacity: 0 !important;
                visibility: hidden !important;
            }

            #planetList.custom-ready {
                opacity: 1 !important;
                visibility: visible !important;
                transition: opacity 0.15s ease-in;
            }

            /* --- CSS RESOURCES --- */

            .my-resource-timer {
                position: relative;
                font-size: 9px;
                margin-top: 13px;
                pointer-events: none;
            }

            .smallplanet {
                height: 50px !important;
            }

            .custom-res-table {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                font-size: 9px;
                line-height: 11px;
                margin-left: auto !important;
                margin-right: 5px !important;
                pointer-events: none;
            }

            .res-m { color: #a4a4a4; font-weight: bold; }
            .res-c { color: #2389d7; font-weight: bold; }
            .res-d { color: #1fb37d; font-weight: bold; }

            /* --- CSS MINES LVLS --- */

            .custom-mines-table {
                display: flex;
                flex-direction: row;
                justify-content: space-between;
                width: 134px;
                font-size: 7px;
                position: absolute !important;
                bottom: -22px !important;
                left: 2px !important;
                pointer-events: none;
            }

            /* --- CSS AD BLOCKER --- */

            #bannerSkyscrapercomponent {
                display: none !important;
            }

            /* --- CSS KEYBIND HINTS --- */
            .custom-keybind-hint {
                position: absolute;
                top: -10px;
                right: 5px;
                background-color: #ff9600;
                color: #161b23;
                font-size: 8px;
                font-weight: 900;
                padding: 1px 4px;
                border-radius: 10px;
                pointer-events: none;
                z-index: 999;
                box-shadow: 1px 1px 3px rgba(0,0,0,0.8);
                text-transform: uppercase;
            }
        `;

        const injectCSS = () => {
            if (document.getElementById('custom-style')) return;
            let style = document.createElement('style');
            style.id = 'custom-style';
            style.type = 'text/css';
            style.innerHTML = css;

            const interval = setInterval(() => {
                if (document.head) {
                    document.head.appendChild(style);
                    clearInterval(interval);
                }
            }, 10);
        };

        injectCSS();
    }

    // --- FLEETSCRIPT ---
    function FleetScript(){
        document.addEventListener('focusin', (e) => {
            if (e.target && e.target.matches('.compact-input input')) e.target.select();
        });

        const handleMenuInteraction = (e) => {
            const a = e.target.closest("#" + FLEET_BTN_ID);
            const aBtn = e.target.closest("#" + FLEET_SECBTN_ID);
            const saveBtn = e.target.closest("#expoSave");
            const panel = document.getElementById(PANEL_ID);
            const shipIcon = e.target.closest(".clickable-ship");

            if (a) {
                e.preventDefault(); e.stopImmediatePropagation();
                if (panel) togglePanel(a, panel);
            }
            if (aBtn) {
                e.preventDefault(); e.stopImmediatePropagation();
                
                if (aBtn.dataset.sending === "true") return; 
                aBtn.dataset.sending = "true";
                
                sendExpos(aBtn);
            }
            if (saveBtn) {
                e.preventDefault(); e.stopImmediatePropagation();
                saveChanges();
            }

            if (shipIcon) {
                e.preventDefault(); e.stopImmediatePropagation();
                let shipID = shipIcon.getAttribute("data-ship-id");
                let inputID = shipIcon.getAttribute("data-input-id");
                let input = document.querySelector(`input[data-id="${inputID}"]`);

                if (input && gameWindow.fleetDispatcher) {
                    let currentExpos = gameWindow.fleetDispatcher.expeditionCount || 0;
                    let availableExpos = gameWindow.fleetDispatcher.maxExpeditionCount - currentExpos || 1 ;

                    availableExpos = Math.max(1, availableExpos);

                    let availableShips = 0;
                    if (gameWindow.fleetDispatcher.shipsData?.[shipID]) {
                        availableShips = gameWindow.fleetDispatcher.shipsData[shipID].number;
                    } else {
                        const shipVisual = document.querySelector(`li[data-technology="${shipID}"] .amount`);
                        if (shipVisual && shipVisual.dataset.value) availableShips = parseInt(shipVisual.dataset.value, 10);
                    }

                    input.value = Math.floor(availableShips / availableExpos);
                }
            }

            if (panel && panel.style.display === 'block') {
                const clickedInsidePanel = panel.contains(e.target);
                const clickedButton = a && a.contains(e.target);
                if (!clickedInsidePanel && !clickedButton) panel.style.display = 'none';
            }
        };

        // DESKTOP LISTENER
        document.addEventListener('click', handleMenuInteraction, true);

        // IPAD / TOUCHSCREEN LISTENER
        document.addEventListener('touchend', (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;

            if (e.target.closest("#" + FLEET_BTN_ID) || e.target.closest("#" + FLEET_SECBTN_ID) || e.target.closest("#expoSave")) {
                e.preventDefault();
                handleMenuInteraction(e);
            }
        }, { capture: true, passive: false });

        function addUIBtn(){
            const menuTable = document.querySelector("#menuTable");
            if (!menuTable || document.querySelector("#" + FLEET_BTN_ID)) return;

            const li = document.createElement("li");
            const spanBtn = document.createElement("span");
            spanBtn.id = FLEET_SECBTN_ID;
            spanBtn.className = "menu_icon";

            const aBtn = document.createElement("a"); aBtn.className = "tooltipRight js_hideTipOnMobile ";
            const divBtn = document.createElement("div"); divBtn.className = "menuImage fleet1 ipiHintable";
            divBtn.data = "Send Expos!";

            spanBtn.appendChild(aBtn); aBtn.appendChild(divBtn); li.appendChild(spanBtn);

            const a = document.createElement("a");
            a.id = FLEET_BTN_ID;
            a.href = "javascript:void(0);";
            a.className = "menubutton";

            const span = document.createElement("span");
            span.className = "textlabel"; span.textContent = "Expo Settings";
            a.appendChild(span); li.appendChild(a);

            menuTable.appendChild(li);
        }

        function togglePanel(button, panel) {
            if (panel.style.display === "block") {
                panel.style.display = "none";
                return;
            }
            const rect = button.getBoundingClientRect();
            panel.style.top = rect.top + "px";
            panel.style.left = (rect.right + 5) + "px";
            panel.style.display = "block";
        }

        // --- SEND EXPO (API FETCH DIRETO COM AUTO-HEAL) ---
        async function sendExpoAPI(){
            let currConfig = localStorage.getItem("expoFleet");
            if (!currConfig) {
                console.error("[!] ERROR: No expo fleet configured.");
                return false;
            }
            currConfig = currConfig.split(",");

            const metaCoords = document.querySelector('meta[name="ogame-planet-coordinates"]');
            if (!metaCoords) return false;
            const coordsMatch = metaCoords.content.match(/\d+/g);
            const currentGalaxy = coordsMatch[0];
            const currentSystem = coordsMatch[1];

            const payload = new URLSearchParams();
            payload.append('token', gameWindow.fleetDispatcher.token);

            let totalShipsAdded = 0;
            let totalShipsRequested = 0;
            let shipsSentThisRound = {};

            for (let i = 0; i < shipNames.length; i++){
                let shipID = shipNames[i][1];
                let requestedAmount = parseInt(currConfig[i]) || 0;

                if (requestedAmount > 0){
                    totalShipsRequested += requestedAmount;
                    let availableShips = 0;

                    if (gameWindow.fleetDispatcher?.shipsData?.[shipID]) {
                        availableShips = gameWindow.fleetDispatcher.shipsData[shipID].number;
                    } else {
                        const shipVisual = document.querySelector(`li[data-technology="${shipID}"] .amount`);
                        if (shipVisual && shipVisual.dataset.value) availableShips = parseInt(shipVisual.dataset.value, 10);
                    }

                    let actualAmountToSend = Math.min(requestedAmount, availableShips);
                    if (actualAmountToSend > 0) {
                        payload.append(`am${shipID}`, actualAmountToSend);
                        totalShipsAdded += actualAmountToSend;
                        shipsSentThisRound[shipID] = actualAmountToSend;
                    }
                }
            }

            if (totalShipsAdded < totalShipsRequested) {
                console.warn(`[!] Aborting: Missing ships. Requested ${totalShipsRequested}, but only found ${totalShipsAdded}.`);
                return false;
            }

            if (totalShipsAdded === 0) return false;

            payload.append('galaxy', currentGalaxy);
            payload.append('system', currentSystem);
            payload.append('position', 16);
            payload.append('type', 1);
            payload.append('metal', 0);
            payload.append('crystal', 0);
            payload.append('deuterium', 0);
            payload.append('food', 0);
            payload.append('prioMetal', 2);
            payload.append('prioCrystal', 3);
            payload.append('prioDeuterium', 4);
            payload.append('prioFood', 1);
            payload.append('mission', 15);
            payload.append('speed', 10);
            payload.append('retreatAfterDefenderRetreat', 0);
            payload.append('lootFoodOnAttack', 1);
            payload.append('union', 0);
            payload.append('holdingtime', 1);

            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            };

            const sendEndpoint = "/game/index.php?page=ingame&component=fleetdispatch&action=sendFleet&ajax=1&asJson=1";

            try {
                let sendRes = await fetch(sendEndpoint, { method: 'POST', headers: headers, body: payload.toString(), credentials: 'include' });
                let data = Helpers.parseCleanJSON(await sendRes.text());

                // --- TOKEN RECOVERY ---
                if (!data.success && data.newAjaxToken) {
                    payload.set('token', data.newAjaxToken);
                    gameWindow.fleetDispatcher.token = data.newAjaxToken;
                    sendRes = await fetch(sendEndpoint, { method: 'POST', headers: headers, body: payload.toString(), credentials: 'include' });
                    data = Helpers.parseCleanJSON(await sendRes.text());
                }

                if (data.success) {
                    if (data.newAjaxToken) gameWindow.fleetDispatcher.token = data.newAjaxToken;

                    for (let id in shipsSentThisRound) {
                        let sentAmount = shipsSentThisRound[id];
                        if (gameWindow.fleetDispatcher?.shipsData?.[id]) {
                            gameWindow.fleetDispatcher.shipsData[id].number -= sentAmount;
                        }
                        const visualEl = document.querySelector(`li[data-technology="${id}"] .amount`);
                        if (visualEl) {
                            let newTotal = parseInt(visualEl.dataset.value, 10) - sentAmount;
                            visualEl.dataset.value = newTotal;
                            visualEl.textContent = newTotal;
                        }
                    }
                    if (typeof gameWindow.fleetDispatcher.refresh === 'function') gameWindow.fleetDispatcher.refresh();
                    return true;
                } else {
                    let errorMsg = (data.errors && data.errors.length > 0) ? data.errors[0].message : "Unknown Send Error";
                    console.error("[!] ERROR: Server rejected the fleet permanently. Reason:", errorMsg);
                    return false;
                }
            } catch (error) {
                console.error("[!] ERROR: Network error during API sequence. Reason:", error);
                return false;
            }
        }

        // --- SEND MULTIPLE EXPOS ---
        async function sendExpos(btnElement){
            let maxExpos = gameWindow.fleetDispatcher.maxExpeditionCount || 1;
            let currentExpos = gameWindow.fleetDispatcher.expeditionCount || 0;
            let currentExposSlots = maxExpos - currentExpos;
            
            let maxFleet = gameWindow.fleetDispatcher.maxFleetCount || 1;
            let currentFleet = gameWindow.fleetDispatcher.fleetCount || 0;
            let currentFleetSlots = maxFleet - currentFleet;
            
            let maxSend = Math.min(currentFleetSlots, currentExposSlots);

            if (maxSend <= 0) {
                console.log("[-] WARNING: No fleet or expedition slots available!");
                if (btnElement) btnElement.dataset.sending = "false";
                return;
            }

            for (let i = 0; i < maxSend; i++){
                if (btnElement) {
                    btnElement.innerHTML = `<div style="color: #ff9600; font-size: 11px; line-height: 27px; font-weight: bold; text-align: center; width: 100%; height: 100%; background: rgba(0,0,0,0.5); border-radius: 3px;">${i+1}/${maxSend}</div>`;
                }

                let success = await sendExpoAPI();
                if (!success) {
                    console.warn(`[-] WARNING: Stopping multi-send loop on iteration ${i + 1} due to error or lack of ships.`);
                    break;
                }
                
                await Helpers.sleep(Math.random() * 1500 + 1500);
            }
            
            if (btnElement) {
                btnElement.innerHTML = `<div style="color: #1fb37d; font-size: 10px; line-height: 25px; font-weight: bold; text-align: center; width: 27px; height: 27px; background: rgba(0,0,0,0.5); border-radius: 3px;">OK!</div>`;
            }

            setTimeout(() => location.reload(), 1000);
        }

        function saveChanges(){
            const values = document.querySelectorAll("[data-id]");
            let storage = [];
            for (let i = 0; i < values.length; i++){
                storage[i] = (values[i].value) ? values[i].value : 0;
            }
            localStorage.setItem("expoFleet", storage);
            location.reload();
        }

        function addUIPanel(){
            if (document.querySelector("#" + PANEL_ID)) return;

            const panel = document.createElement("div");
            panel.id = PANEL_ID;
            panel.innerHTML = `<h3>Expo Fleet</h3>`;
            let rowsHTML = "";
            let currConfig = localStorage.getItem("expoFleet");
            if (currConfig) currConfig = currConfig.split(",");

            for (let i = 0, counter = 0; i < rowCount; i++) {
                rowsHTML += `
                    <li class="expo-row">
                        <technology-icon class="tooltip clickable-ship" data-ship-id="${shipNames[counter][1]}" data-input-id="${counter}" ${shipNames[counter][0]}="" regular="" style="height: 25px; width: 25px; margin-top: 5px; cursor: pointer;"></technology-icon>
                        <label class="labeled-textfield compact-input hideNumberSpin">
                            <input type="number" data-id="${counter}" placeholder="0" value="${(currConfig && currConfig[counter]) ? currConfig[counter] : ""}">
                        </label>
                `;
                counter++;
                rowsHTML += `
                        <label class="labeled-textfield compact-input hideNumberSpin ">
                            <input type="number" data-id="${counter}" placeholder="0" value="${(currConfig && currConfig[counter]) ? currConfig[counter] : ""}">
                        </label>
                        <technology-icon class="tooltip clickable-ship" data-ship-id="${shipNames[counter][1]}" data-input-id="${counter}" ${shipNames[counter][0]}="" regular="" style="height: 25px; width: 25px; margin-top: 5px; cursor: pointer;"></technology-icon>
                    </li>
                `;
                counter++;
            }

            panel.innerHTML += `
                <ul id="expoTable">
                    ${rowsHTML}
                    <li style="display:block;">
                        <a id="expoSave" class="btn_blue" style="display:block;">Save Changes!</a>
                    </li>
                </ul>
            `;
            document.body.appendChild(panel);
        }

        function addUIElements(){
            addUIBtn();
            addUIPanel();
        }

        function mainFleet(){
            if (Helpers.isPage('component=fleetdispatch')) {
                setTimeout(addUIElements, 500);
            }
        }
        mainFleet();
    }

    // --- AUCTION SCRIPT ---
    function AuctionScript() {

        function createAuctionUI() {
            let container = document.getElementById("custom-auction-panel");
            if (!container) {
                container = document.createElement("div");
                container.id = "custom-auction-panel";
                container.style = `
                    position: absolute; top: 40px; right: 15px;
                    background-color: #161b23EE; border: 1px solid #455266;
                    color: #999; padding: 5px 10px; border-radius: 4px;
                    font-size: 10px; z-index: 500; display: flex;
                    flex-direction: column; align-items: flex-end;
                    pointer-events: none; box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
                `;
                container.innerHTML = `
                    <div style="color: #ff9600; font-weight: bold; margin-bottom: 2px;">AUCTION</div>
                    <div id="auction-time">A verificar...</div>
                    <div id="auction-bid" style="color: #a4a4a4;">-</div>
                `;
                document.body.appendChild(container);
            }
            return {
                time: document.getElementById("auction-time"),
                bid: document.getElementById("auction-bid")
            };
        }

        let uiNodes = null;

        async function fetchAuctionData() {
            try {
                const url = "/game/index.php?page=ingame&component=traderAuctioneer";
                const response = await fetch(url, { credentials: 'include' });
                const htmlText = await response.text();

                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, "text/html");

                let timeElement = doc.querySelector('.auction_info');
                let sumElement = doc.querySelector('.currentSum');

                let rawText = timeElement ? timeElement.textContent.trim() : "";
                let currentSum = sumElement ? sumElement.textContent.trim() : "-";

                let currentSumText = sumElement ? sumElement.textContent.trim() : "0";
                GameState.auction.currentSum = parseInt(currentSumText.replace(/\D/g, ''), 10) || 0;

                let overlay = doc.querySelector('.noAuctionOverlay');
                let isWaitingMode = false;

                if (overlay) {
                    isWaitingMode = overlay.style.display !== "none";
                }

                if (isWaitingMode) {
                    let match = rawText.match(/\d+/);

                    if (match) {
                        let totalSeconds = parseInt(match[0], 10);
                        GameState.auction.shadowNextAuction = Date.now() + (totalSeconds * 1000);
                    }

                    GameState.auction.timeText = "Waiting";
                    GameState.auction.shadowEndTime = 0;

                } else {
                    let match = rawText.match(/\d+/);
                    let timeText = match ? `Aprox. ${match[0]}m` : rawText;

                    if (timeText.includes("Aprox. 5m") && GameState.auction.timeText !== timeText) {
                        GameState.auction.shadowEndTime = Date.now() + (5 * 60 * 1000);
                    } else if (!timeText.includes("Aprox. 5m")) {
                        GameState.auction.shadowEndTime = 0;
                    }

                    GameState.auction.timeText = timeText;
                    GameState.auction.shadowNextAuction = 0;
                }

                localStorage.setItem("AuctionState", JSON.stringify(GameState.auction));

            } catch (error) {
                console.error("[!] ERROR: [Auction] Error in Ghost Fetcher. Reason:", error);
            }
        }

        function auctionTick() {
            if (!uiNodes) uiNodes = createAuctionUI();
            let currentTime = Date.now();

            if (currentTime >= GameState.auction.nextFetch) {
                fetchAuctionData();

                if (GameState.auction.shadowNextAuction > currentTime) {
                    let timeStartAuction = GameState.auction.shadowNextAuction - currentTime;
                    GameState.auction.nextFetch = currentTime + Math.max(10000, timeStartAuction - 30000);
                }
                else if (GameState.auction.shadowEndTime > 0) {
                    GameState.auction.nextFetch = currentTime + (Math.random() * 10000 + 30000);
                } else {
                    GameState.auction.nextFetch = currentTime + (Math.random() * 60000 + 120000);
                }
            }

            uiNodes.bid.textContent = Helpers.compactNumber.format(GameState.auction.currentSum);

            // --- INTERFACE RENDERING ---
            if (GameState.auction.shadowNextAuction > currentTime) {
                let secondsLeft = Math.floor((GameState.auction.shadowNextAuction - currentTime) / 1000);

                uiNodes.time.textContent = `Waiting, ${Helpers.convSecToTime(secondsLeft)}`;
                uiNodes.time.style.color = "#2389d7";
                uiNodes.bid.textContent = "-";
            }
            else if (GameState.auction.shadowEndTime > 0 && currentTime < GameState.auction.shadowEndTime) {
                let secondsLeft = Math.max(0, Math.floor((GameState.auction.shadowEndTime - currentTime) / 1000));
                uiNodes.time.textContent = `< 0${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s`;
                uiNodes.time.style.color = "#d43635";
            }
            else {
                uiNodes.time.textContent = GameState.auction.timeText;
                uiNodes.time.style.color = "#999";
            }
        }

        MasterClockQueue.push(auctionTick);
    }

    // --- UTILITIES SCRIPT ---
    function UtilitiesScript(){
        function setupPlanetList(){
            let planetListContainer = document.querySelector("#planetList");

            if (planetListContainer && !planetListContainer.classList.contains("custom-ready")) {
                planetListContainer.classList.add("custom-ready");
            }

            let planetsNames = document.querySelectorAll(".planet-name");
            planetsNames.forEach((planet_name) => {
                let parentPlanet = planet_name.closest('.smallplanet');
                if (!parentPlanet) return;
                let pID = parentPlanet.id.split("-")[1];

                if (!document.getElementById("resTable-" + pID)){
                    let sibling = planet_name.previousElementSibling;
                    if (sibling && !sibling.classList.contains("custom-mines-table") && !sibling.classList.contains("custom-res-table")) {
                        sibling.append(planet_name);
                    }

                    UINodes[pID] = { res: null, mines: null };

                    let minesContainer = document.createElement("div");
                    UINodes[pID].mines = minesContainer;
                    minesContainer.className = "custom-mines-table";
                    minesContainer.id = "minesTable-" + pID;
                    minesContainer.innerHTML = `
                        <span class="res-m">-</span>
                        <span class="res-c">-</span>
                        <span class="res-d">-</span>
                    `;

                    let resContainer = document.createElement("div");
                    UINodes[pID].res = resContainer;
                    resContainer.className = "custom-res-table";
                    resContainer.id = "resTable-" + pID;
                    resContainer.innerHTML = `
                        <span class="res-m">0</span>
                        <span class="res-c">0</span>
                        <span class="res-d">0</span>
                    `;

                    let targetWrapper = planet_name.parentElement;
                    if (targetWrapper) {
                        targetWrapper.append(minesContainer);
                        targetWrapper.append(resContainer);
                    }
                }
            });
        }

        function reloadPage(){
            let nextReloadTime = Date.now() + (Math.random() * 600000 + 300000);

            function checkAutoReload() {
                if (Date.now() >= nextReloadTime) {
                    console.log("[Master Clock] A iniciar auto-reload de segurança...");
                    location.reload();
                }
            }

            MasterClockQueue.push(checkAutoReload);
        }

        function waitForDrawerAndInjectValues() {
            const drawerID = "technologydetails";
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.addedNodes.length) {
                        mutation.addedNodes.forEach((node) => {
                            if (node.id === drawerID || (node.querySelector && node.querySelector(`#${drawerID}`))) {
                                handleEnergy();
                            }
                        });
                    }
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        function handleEnergy(){
            let energy = document.querySelector(".additional_energy_consumption");
            let current_energy = document.querySelector("#resources_energy");

            if (!energy || !current_energy) return;

            let span = document.querySelector("#bonusEnergy");
            let missingEnergy = current_energy.dataset.raw - energy.children[1].dataset.value;

            if (!span){
                span = document.createElement("span");
                span.id = "bonusEnergy"
                span.className = "bonus";
                span.textContent = "(" + ((missingEnergy > 0) ? ("+" + missingEnergy) : missingEnergy) + ")"
                span.style = (missingEnergy < 0) ? "color: #D43635; font-weight: bold;" : "font-weight: bold;";
                energy.appendChild(span);
            }
        }

        function updateValues() {
            let input = document.querySelector('#build_amount');
            let amount = input ? parseInt(input.value) || 1 : 1;

            // --- ENERGY LOGIC ---
            let energyEle = document.querySelector(".energy_production");
            if (energyEle && input) {
                let bonus = energyEle.children[1].children[0];
                if (bonus && bonus.dataset.value) {
                    bonus.textContent = "(+" + (bonus.dataset.value * amount) + ")";
                }
            }

            // --- TIME LOGIC ---
            let timeEle = document.querySelector("time.build_duration") || document.querySelector(".build_duration time") || document.querySelector("time[datetime]");

            if (timeEle) {
                if (!timeEle.dataset.baseSeconds) {
                    let isoFormat = timeEle.getAttribute("datetime");
                    timeEle.dataset.baseSeconds = Helpers.parseISO8601Duration(isoFormat);
                }

                let baseSeconds = parseInt(timeEle.dataset.baseSeconds, 10);

                if (baseSeconds > 0) {
                    let totalSeconds = baseSeconds * amount;
                    timeEle.textContent = Helpers.convSecToTime(totalSeconds);
                    timeEle.style.color = amount > 1 ? "#ff9600" : "";
                }
            }
        }

        if(Helpers.isPage('component=shipyard') || Helpers.isPage('component=supplies')){
            document.addEventListener('input', function(event){ updateValues(); });
        }

        setupPlanetList()
        waitForDrawerAndInjectValues();
        reloadPage();
        MasterClockQueue.push(setupPlanetList);
    }

    // --- KEYBINDS SCRIPT ---
    function KeybindsScript() {

        document.addEventListener('keydown', function(event) {
            const isTyping = event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA';

            // --- SEND EXPOS ---
            if (event.key === Config.keybinds.sendExpos && Helpers.isPage('component=fleetdispatch') && !isTyping) {
                let sendExpoBtn = document.querySelector('#customExpoSecBtn');
                if (sendExpoBtn) Helpers.simulateClick(sendExpoBtn);
            }

            // --- START BUILDING ---
            if (event.key === Config.keybinds.upgradeItem) {
                const upgradeBtn = document.querySelector(".upgrade") || document.querySelector(".pay");
                if (upgradeBtn && !upgradeBtn.disabled) {
                    Helpers.simulateClick(upgradeBtn);
                }
            }

            // --- AUCTION SCRIPT ---
            if (event.key === Config.keybinds.clearBids && Helpers.isPage('component=traderAuctioneer') && !isTyping) {
                const btns = document.querySelectorAll(".resourceAmount");
                btns.forEach(btn => {
                    Helpers.typeValue(btn, 0);
                });
            }

            if (Config.keybinds.maxBids.includes(event.key) && Helpers.isPage('component=traderAuctioneer') && !isTyping) {
                switch (event.key) {
                    case Config.keybinds.maxBids[0]: {
                        let btn = document.querySelector(".js_sliderMetalMax");
                        if (btn) btn.click();
                        break;
                    }
                    case Config.keybinds.maxBids[1]: {
                        let btn = document.querySelector(".js_sliderCrystalMax");
                        if (btn) btn.click();
                        break;
                    }
                    case Config.keybinds.maxBids[2]: {
                        let btn = document.querySelector(".js_sliderDeuteriumMax");
                        if (btn) btn.click();
                        break;
                    }
                }
            }

            if (Config.keybinds.smallBids.includes(event.key) && Helpers.isPage('component=traderAuctioneer') && !isTyping) {
                switch (event.key) {
                    case Config.keybinds.smallBids[0]: {
                        let btn = document.querySelector(".js_sliderMetalMore");
                        if (btn) btn.click();
                        break;
                    }
                    case Config.keybinds.smallBids[1]: {
                        let btn = document.querySelector(".js_sliderCrystalMore");
                        if (btn) btn.click();
                        break;
                    }
                    case Config.keybinds.smallBids[2]: {
                        let btn = document.querySelector(".js_sliderDeuteriumMore");
                        if (btn) btn.click();
                        break;
                    }
                }
            }
        });

        // --- UI PAINTER ---
        function renderKeybindHints() {
            if (!Helpers.isPage('page=traderAuctioneer')) return;

            const hints = [
                { selector: ".js_sliderMetalMax", key: Config.keybinds.maxBids[0] },
                { selector: ".js_sliderCrystalMax", key: Config.keybinds.maxBids[1] },
                { selector: ".js_sliderDeuteriumMax", key: Config.keybinds.maxBids[2] },
                { selector: ".js_sliderMetalMore", key: Config.keybinds.smallBids[0] },
                { selector: ".js_sliderCrystalMore", key: Config.keybinds.smallBids[1] },
                { selector: ".js_sliderDeuteriumMore", key: Config.keybinds.smallBids[2] }
            ];

            hints.forEach(hint => {
                let element = document.querySelector(hint.selector);
                if (!element) return;

                let btn = element.parentElement;
                if (btn && !btn.querySelector('.custom-keybind-hint')) {
                    if (window.getComputedStyle(btn).position === 'static') {
                        btn.style.position = 'relative';
                    }
                    let badge = document.createElement("div");
                    badge.className = "custom-keybind-hint";
                    badge.textContent = hint.key;
                    btn.appendChild(badge);
                }
            });

            const inputWrappers = document.querySelectorAll(".resourceAmount");
            inputWrappers.forEach(input => {
                let wrapper = input.parentElement;
                if (wrapper && !wrapper.querySelector('.custom-keybind-hint')) {
                    if (window.getComputedStyle(wrapper).position === 'static') {
                        wrapper.style.position = 'relative';
                    }
                    let badge = document.createElement("div");
                    badge.className = "custom-keybind-hint";
                    badge.style.backgroundColor = "#d43635";
                    badge.style.color = "white";
                    badge.textContent = Config.keybinds.clearBids;
                    wrapper.appendChild(badge);
                }
            });
        }

        MasterClockQueue.push(renderKeybindHints);
    }

    // --- INITIALIZE ALL MODULES ---
    function Main(){
        GlobalStyle();

        function StartMasterClock() {
            setInterval(() => {
                for (let i = 0; i < MasterClockQueue.length; i++) {
                    try {
                        MasterClockQueue[i]();
                    } catch(error) {
                        console.error(`[!] ERROR: [Master Clock] Error in task with index ${i}. Reason:`, error);
                    }
                }
            }, 1000);
        }

        function BootSequence() {
            const metaPlanet = document.querySelector('meta[name="ogame-planet-id"]');
            if (metaPlanet) GameState.currentPlanetID = metaPlanet.content;

            GameState.empireData = JSON.parse(localStorage.getItem("EmpireEconomy") || "{}");

            let savedAuction = localStorage.getItem("AuctionState");
            if (savedAuction) {
                GameState.auction = JSON.parse(savedAuction);
                GameState.auction.nextFetch = 0;
            }

            AlertsScript();
            ResourcesScript();
            FleetScript();
            UtilitiesScript();
            AuctionScript();
            KeybindsScript();

            StartMasterClock();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', BootSequence);
        } else {
            BootSequence();
        }
    }

    Main();
})();