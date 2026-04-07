// ==UserScript==
// @name         OGame Tool
// @namespace    http://tampermonkey.net/
// @version      1.11
// @description  My First Script, hope you enjoy!
// @author       You
// @match        *://*.ogame.gameforge.com/*
// @include      *://*.ogame.gameforge.com/*
// @grant        none
// @run-at       document-start
// @downloadURL https://update.greasyfork.org/scripts/572555/OGame%20Tool.user.js
// @updateURL https://update.greasyfork.org/scripts/572555/OGame%20Tool.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // --- CROSS-BROWSER BRIDGE ---
    const gameWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // --- GLOBAL GAME STATE ---
    const GameState = {
        resources: { metal: 0, crystal: 0, deuterium: 0, energy: 0 },
        fleet: { current: 0, max: 0, expos: 0, maxExpos: 0 },
        empireData: {}
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

    let UINodes = {}

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
    function parseCleanJSON(rawText) {
        if (rawText.includes("var MAX_")) {
            const firstBracket = rawText.indexOf('{');
            if (firstBracket !== -1) return JSON.parse(rawText.substring(firstBracket));
        }
        return JSON.parse(rawText);
    }

    const compactNumber = new Intl.NumberFormat('en-US', {
        notation: "compact",
        maximumFractionDigits: 1
    });

    function convSecToTime(totalSeconds){
        if (totalSeconds < 0) return "";
        if (totalSeconds == 0) return "Full";

        let values = [
            Math.floor(totalSeconds / 86400),         // DAYS
            Math.floor((totalSeconds / 3600) % 24),   // HOURS
            Math.floor((totalSeconds / 60) % 60),     // MINUTES
            Math.floor(totalSeconds % 60)             // SECONDS
        ];

        let string = "";
        if (values[0] > 0) string += values[0] + "d "
        if (values[1] > 0) string += values[1] + "h ";
        if (values[0] <= 0 && values[2] > 0) string += values[2] + "m ";
        if (values[1] <= 0) string += values[3] + "s";

        return string.trim();
    }

    function waitForElement(selector) {
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
    }

    async function sleep(miliseconds){
        await new Promise(r => setTimeout(r, miliseconds));
    }

    function isPage(URLpart){
        const URL = gameWindow.location.href; // gameWindow mantido apenas para ler o href nativo
        if (!URL) return;
        return URL.includes(URLpart);
    }

    // --- SETUP AUDIO ---
    function SetupAudio(){
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
    }

    // --- ALERTS SCRIPT ---
    function AlertsScript(volume=0.5) {
        function notifyUser(urgent = false) {
            if (!("Notification" in gameWindow)) {
                console.error("This browser does not support desktop notification");
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
            playBeep(1000); await gameWindow.sleep(100);
            playBeep(1200); await gameWindow.sleep(100);
            playBeep(1000); await gameWindow.sleep(100);
            playBeep(1600);
        }

        async function attackAlert(){
            playBeep(1000); await gameWindow.sleep(500);
        }

        function checkFleetEvents() {
            const flexiblePattern = /^(?:\d+h\s*)?(?:\d+m\s*)?(?:\d+s)?$/;
            let timerElement = document.querySelector("#tempcounter");
            let attackElementOn = document.querySelector(".soon");
            if (!timerElement) return;
            let timeText = timerElement.textContent.trim();

            if(attackElementOn){
                notifyUser(true);
                attackAlert();
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
                .then(text => parseCleanJSON(text))
                .then(data => {
                    const metaPlanet = document.querySelector('meta[name="ogame-planet-id"]');
                    if (!metaPlanet) return;
                    const currentPlanetID = metaPlanet.content;
                    const types = ["metal", "crystal", "deuterium"];

                    let planetEconomy = {
                        timestamp: Date.now(),
                        metal: getValuesByType(data, types[0]),
                        crystal: getValuesByType(data, types[1]),
                        deuterium: getValuesByType(data, types[2])
                    };

                    empEconomy[currentPlanetID] = planetEconomy;
                    
                    // 2. Atualiza o Disco (Apenas esta vez)
                    localStorage.setItem("EmpireEconomy", JSON.stringify(empEconomy));

                })
                .catch(err => console.error("Resource fetch error:", err));
        }

        function localResourceTick() {
            const metaPlanet = document.querySelector('meta[name="ogame-planet-id"]');
            if (!metaPlanet) return;
            const currentPlanetID = metaPlanet.content;

            let planet = empEconomy[currentPlanetID];

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
                updateUITimer(type, convSecToTime(seconds)); // Agora chama diretamente
            });

            for (let pID in empEconomy) {
                let pData = empEconomy[pID];
                let tableUI = UINodes[pID];

                if (!tableUI) continue; 
                
                let pSecondsElapsed = (Date.now() - pData.timestamp) / 1000;
                
                let getLive = (resObj) => {
                    if (!resObj) return 0;
                    let extra = resObj.current + (resObj.production * pSecondsElapsed);
                    return Math.max(Math.floor(Math.min(extra, resObj.max)), resObj.current);
                };

                let liveM = compactNumber.format(getLive(pData.metal));
                let liveC = compactNumber.format(getLive(pData.crystal));
                let liveD = compactNumber.format(getLive(pData.deuterium));

                tableUI.children[0].textContent = liveM;
                tableUI.children[1].textContent = liveC;
                tableUI.children[2].textContent = liveD;
            }
        }

        fetchInitialResources();
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

            .compact-input { width: 40px; height: 22px; padding-left: 4px; padding-right: 4px; position: relative; }

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
                height: 40px !important;
                width: 140px !important;
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
                height: 40px !important; 
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

            /* --- CSS AD BLOCKER --- */

            #bannerSkyscrapercomponent {
                display: none !important;
            }
        `;

        const injectCSS = () => {
            if (document.getElementById('custom-style')) return;
            let style = document.createElement('style');
            style.id = 'custom-style';
            style.type = 'text/css';
            style.innerHTML = css;

            (document.head || document.documentElement).appendChild(style);
        };

        if (document.head || document.documentElement) {
            injectCSS();
        } else {
            document.addEventListener('DOMContentLoaded', injectCSS);
        }
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

            if (a) {
                e.preventDefault(); e.stopImmediatePropagation();
                if (panel) togglePanel(a, panel);
            }
            if (aBtn) {
                e.preventDefault(); e.stopImmediatePropagation();
                sendExpos();
            }
            if (saveBtn) {
                e.preventDefault(); e.stopImmediatePropagation();
                saveChanges();
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

        document.addEventListener('keydown', function(event){
            let sendExpoBtn = document.querySelector('#customExpoSecBtn');
            if (event.key === 'e' && sendExpoBtn) sendExpoBtn.click();
        });

        function addUIBtn(){
            const menuTable = document.querySelector("#menuTable");
            if (!menuTable || document.querySelector("#" + FLEET_BTN_ID)) return;

            const li = document.createElement("li");
            const spanBtn = document.createElement("span");
            spanBtn.id = FLEET_SECBTN_ID;
            spanBtn.className = "menu_icon";

            const aBtn = document.createElement("a"); aBtn.className = "tooltipRight js_hideTipOnMobile ";
            const divBtn = document.createElement("div"); divBtn.className = "menuImage defense";
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
                let data = parseCleanJSON(await sendRes.text());

                // --- TOKEN RECOVERY ---
                if (!data.success && data.newAjaxToken) {
                    payload.set('token', data.newAjaxToken);
                    gameWindow.fleetDispatcher.token = data.newAjaxToken;
                    sendRes = await fetch(sendEndpoint, { method: 'POST', headers: headers, body: payload.toString(), credentials: 'include' });
                    data = parseCleanJSON(await sendRes.text());
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
                console.error("[!] ERROR: Network error during API sequence:", error);
                return false;
            }
        }

        // --- SEND MULTIPLE EXPOS ---
        async function sendExpos(){
            let currentExposSlots = gameWindow.fleetDispatcher.maxExpeditionCount - gameWindow.fleetDispatcher.expeditionCount;
            let currentFleetSlots = gameWindow.fleetDispatcher.maxFleetCount - gameWindow.fleetDispatcher.fleetCount;
            let maxSend = Math.min(currentFleetSlots, currentExposSlots);

            if (maxSend <= 0) {
                console.log("No fleet or expedition slots available!");
                return;
            }


            for (let i = 0; i < maxSend; i++){
                let success = await sendExpoAPI();
                if (!success) {
                    console.warn(`[!] Stopping multi-send loop on iteration ${i + 1} due to error or lack of ships.`);
                    break;
                }
                await gameWindow.sleep(Math.random() * 1500 + 1500);
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
                        <technology-icon class="tooltip" ${shipNames[counter][0]}="" regular="" style="height: 25px; width: 25px; margin-top: 5px"></technology-icon>
                        <label class="labeled-textfield compact-input hideNumberSpin">
                            <input type="number" data-id="${counter}" placeholder="0" value="${(currConfig && currConfig[counter]) ? currConfig[counter] : ""}">
                        </label>
                `;
                counter++;
                rowsHTML += `
                        <label class="labeled-textfield compact-input hideNumberSpin ">
                            <input type="number" data-id="${counter}" placeholder="0" value="${(currConfig && currConfig[counter]) ? currConfig[counter] : ""}">
                        </label>
                        <technology-icon class="tooltip" ${shipNames[counter][0]}="" regular="" style="height: 25px; width: 25px; margin-top: 5px"></technology-icon>
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
            if (isPage('component=fleetdispatch')) {
                setTimeout(addUIElements, 500);
            }
        }
        mainFleet();
    }

    // --- UTILITIES SCRIPT ---
    function UtilitiesScript(){

        function setupPlanetList(){
            let planetListContainer = document.querySelector("#planetList");
            if (planetListContainer) {
                planetListContainer.classList.add("custom-ready");
            }

            let planetsNames = document.querySelectorAll(".planet-name");
            planetsNames.forEach((planet_name) => {
               let sibling = planet_name.previousElementSibling;
               if (sibling) sibling.append(planet_name);

               let parentPlanet = planet_name.closest('.smallplanet');
               if (!parentPlanet) return;
               let pID = parentPlanet.id.split("-")[1];

               if (!UINodes[pID]){
                    let resContainer = document.createElement("div");
                    UINodes[pID] = resContainer; // Map it instantly
                    resContainer.className = "custom-res-table";
                    resContainer.id = "resTable-" + pID;

                    resContainer.innerHTML = `
                        <span class="res-m">0</span>
                        <span class="res-c">0</span>
                        <span class="res-d">0</span>
                    `;

                    if (sibling) sibling.append(resContainer);
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

        function waitForDrawerAndInjectEnergy() {
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

        function updateValues(){
            let input = document.querySelector('#build_amount');
            let bonus = document.querySelector(".bonus");
            if (input && bonus) {
                bonus.textContent = "(+" + bonus.dataset.value * input.value + ")";
            }
        }

        document.addEventListener('keydown', function(event) {
            const upgradeBtn = document.querySelector(".upgrade");
            if (event.key === 'Enter' && upgradeBtn && !upgradeBtn.disabled) {
                upgradeBtn.click();
            }
        });

        if(isPage('component=shipyard') || isPage('component=supplies')){
            document.addEventListener('input', function(event){ updateValues(); });
        }

        setupPlanetList();
        waitForDrawerAndInjectEnergy();
        reloadPage();
    }

    // --- INITIALIZE ALL MODULES ---
    GlobalStyle(); 

    function StartMasterClock() {
        setInterval(() => {
            // O ciclo for é mais rápido que o .forEach() para jogos de alta performance
            for (let i = 0; i < MasterClockQueue.length; i++) {
                try {
                    MasterClockQueue[i]();
                } catch(error) {
                    console.error(`[Master Clock] Erro na tarefa índice ${i}:`, error);
                }
            }
        }, 1000);
    }

    function BootSequence() {
        GameState.empireData = JSON.parse(localStorage.getItem("EmpireEconomy") || "{}");
        
        SetupAudio();
        AlertsScript();
        ResourcesScript();
        FleetScript();
        UtilitiesScript();
        
        StartMasterClock(); 
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', BootSequence);
    } else {
        BootSequence();
    }

})();
