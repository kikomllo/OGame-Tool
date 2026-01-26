// ==UserScript==
// @name         OGame Tool
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  My First Script, hope you enjoy!
// @author       You
// @match        *.ogame.gameforge.com/game/index.php*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- GLOBALS ---
    const FLEET_BTN_ID = "customExpoBtn";
    const FLEET_SECBTN_ID = "customExpoSecBtn";
    const PANEL_ID = "customPanel";
    const rowCount = 6;
    let audioCtx = null;
    let beeped = false;

    const shipNames = [
                ["fighterlight", 204], ["fighterheavy", 205],
                ["cruiser", 206], ["battleship", 207],
                ["interceptor", 215], ["bomber", 211],
                ["destroyer", 213], ["reaper", 218],
                ["explorer", 219], ["transportersmall", 202],
                ["transporterlarge", 203], ["espionageprobe", 210]
            ]

    // --- HELPER: WAITER ---
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

    // --- HELPER: SLEEP ---
    async function sleep(miliseconds){
        await new Promise(r => setTimeout(r, miliseconds));
    }

    // --- HELPER: PAGE CHECKER ---
    function isPage(URLpart){
        const URL = window.location.href;
        if (!URL) return;

        return URL.includes(URLpart);
    }

    // --- SETUP AUDIO ---
    function initAudioContext() {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    initAudioContext();

    // --- ALERTS SCRIPT ---
    function AlertsScript(volume=0.5) {

        // Function to trigger the notification logic
        function notifyUser(urgent = false) {
            if (!("Notification" in window)) {
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

        // Helper function to create the actual notification object
        function createNotification(urgent) {
            const notif = new Notification((urgent) ? "ATTACK!!!!!!" : "Fleet Timer Out!", {
                body: (urgent) ? "YOU ARE BEING ATTACKED!!!!" : "Your fleet has arrived!",
                icon: "https://cdn-icons-png.flaticon.com/512/1827/1827347.png",
                requireInteraction: false // If true, it stays until user clicks it
            });

            notif.onclick = function() {
                console.log("User clicked the notification");
                window.focus();
            };
        }

        // --- BEEP FUNCTION ---
        function playBeep(frequency = 1600) {
            if (!audioCtx) return;

            const playSound = () => {
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);

                oscillator.type = "linear";
                oscillator.frequency.value = frequency;
                gainNode.gain.value = volume;

                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 0.100);
            };

            if (audioCtx.state === 'suspended') {

                audioCtx.resume().then(() => {
                    playSound();
                });

            } else {
                playSound();
            }
        }

        async function normalAlert(){
            playBeep(1000);
            await sleep(100);
            playBeep(1200);
            await sleep(100);
            playBeep(1000);
            await sleep(100);
            playBeep(1600);
        }

        async function attackAlert(){
            playBeep(1000);
            await sleep(500);
        }

        // --- CHECK FLEET DONE ---
        function checkFleetEvents() {
            let timerElement = document.querySelector("#tempcounter");
            let attackElementOn = document.querySelector(".soon");

            if (!timerElement) return;

            let timeText = timerElement.textContent.trim();

            if(attackElementOn){
                notifyUser(true);
                attackAlert();
            }

            if (timeText === "done") {
                if (!beeped){
                    console.log("Fleet Arrived! Beeping!");
                    notifyUser();
                    normalAlert();
                    beeped = true;
                }
            } else beeped = false;
        }

        // --- MAIN ALERT ---
        function mainAlert(){

            waitForElement('#tempcounter').then((element) => {
                console.log("OGame Monitor Started");
                let beeped = false
                setInterval(checkFleetEvents, 1000);
            });
        }

        mainAlert();
    }


    // --- RESOURCES SCRIPT ---
    function ResourcesScript() {

        // --- HELPER ---
        function getValuesByType(data, type){
            let values = data.resources[type];

            if (!values) return null;

            return {
                production: parseFloat(values.production),
                current: parseFloat(values.amount),
                max: parseFloat(values.storage)
            };
        }

        // --- MATH ---
        function getResourcesMissingSeconds(values){
            if (!values) return 0;

            let production = values.production;
            let current = values.current;
            let max = values.max;

            if (production <= 0) return -1;
            if (current >= max) return 0;

            let missing = max - current;

            return Math.floor(missing / production);
        }

        // --- FORMATTER ---
        function convSecToTime(totalSeconds){
            if (totalSeconds < 0) return "∞";
            if (totalSeconds == 0) return "Full";

            let hours = Math.floor(totalSeconds / 3600);
            let minutes = Math.floor((totalSeconds % 3600) / 60);
            let seconds = Math.floor(totalSeconds % 60);

            let string = "";
            if (hours > 0) string += hours + "h ";
            if (minutes > 0) string += minutes + "m ";
            string += seconds + "s";

            return string.trim();
        }

        // --- UI MANIPULATION ---
        function updateUITimer(type, timeString) {
            let container = document.getElementsByClassName("resourceIcon " + type)[0];
            if (!container) return;


            let timerDiv = container.querySelector("#timer-" + type);

            if (!timerDiv) {
                container.style.position = "relative";
                container.style.overflow = "visible";


                timerDiv = document.createElement("div");
                timerDiv.id = "timer-" + type;
                timerDiv.className = "my-resource-timer";

                timerDiv.style.position = "absolute";
                timerDiv.style.bottom = "-25px";
                timerDiv.style.left = "-10%";
                timerDiv.style.width = "120%";
                timerDiv.style.textAlign = "center";
                timerDiv.style.fontSize = "9px";
                timerDiv.style.color = "#ff9600";
                timerDiv.style.zIndex = "10";
                timerDiv.style.pointerEvents = "none";

                container.appendChild(timerDiv);
            }

            timerDiv.textContent = timeString;

            if (timeString === "Full") {
                 timerDiv.style.color = "#d43635"; // RED
            } else {
                 timerDiv.style.color = "#999"; // GREY/WHITE
            }
        }

        // --- MAIN FETCH ---
        function getResources() {
            const url = "/game/index.php?page=fetchResources&ajax=1";

            fetch(url)
                .then(response => response.json())
                .then(data => {
                    const types = ["metal", "crystal", "deuterium"];

                    types.forEach(type => {
                        let vals = getValuesByType(data, type);
                        let seconds = getResourcesMissingSeconds(vals);
                        let timeStr = convSecToTime(seconds);

                        updateUITimer(type, timeStr);
                    });
                })
                .catch(err => console.error("Resource fetch error:", err));
        }

        // --- MAIN RESOURCES---
        function mainResources(){
            getResources();

            setInterval(getResources, 1000);
        }

        mainResources();
    }

    // --- CSS ---
    function addGlobalStyle(css) {
        let head = document.getElementsByTagName('head')[0];
        if (!head) return;
        let style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = css;
        head.appendChild(style);
    }

    // CSS for the Panel and the Button hover effects

    addGlobalStyle(`
        #${PANEL_ID} {
            position: absolute;
            z-index: 99999;
            background-color: #161b23EE;
            border: 1px solid #455266;
            color: white;
            padding: 15px;
            width: auto;
            height: auto;
            border-radius: 4px;
            box-shadow: 4px 4px 10px rgba(0,0,0,0.8);
            display: none;
        }
        #${PANEL_ID} h3 {
            margin-top: 0;
            border-bottom: 1px solid #455266;
            padding-bottom: 5px;
            text-align: center;
            color: #ff9600;
            font-size: 14px;
        }

        /* --- NEW CSS STARTS HERE --- */
        #expoTable {
            list-style: none; /* Removes the bullet points */
            padding: 0;       /* Removes default left padding */
            margin: 0;
        }

        .expo-row {
            display: flex;       /* Forces children (Icon + Inputs) to sit side-by-side */
            align-items: center; /* Centers them vertically */
            justify-content: space-between; /* Spreads them out nicely */
            margin-bottom: 8px;  /* Adds space between rows */
        }
        /* --- NEW CSS ENDS HERE --- */

        .compact-input{
            width: 40px;
            height: 22px;
            padding-left: 4px;
            padding-right: 4px;
            position: relative;
        }
    `);

    // --- --- ---

    function FleetScript(){

        // --- ADD BUTTONS ---
        function addUIBtn(){
            const menuTable = document.querySelector("#menuTable");
            if (!menuTable) return;

            if (document.querySelector(FLEET_BTN_ID)) return;

            const li = document.createElement("li");

            // --- SIDE BUTTON ---
            const spanBtn = document.createElement("span");
            spanBtn.id = FLEET_SECBTN_ID;
            spanBtn.className = "menu_icon";

            const aBtn = document.createElement("a");
            aBtn.className = "tooltipRight js_hideTipOnMobile ";

            const divBtn = document.createElement("div");
            divBtn.className = "menuImage defense";

            li.appendChild(spanBtn);
            spanBtn.appendChild(aBtn);
            aBtn.appendChild(divBtn);

            // --- --- ---

            // --- MAIN BUTTON ---
            const a = document.createElement("a");
            a.id = FLEET_BTN_ID;
            a.href = "";
            a.className = "menubutton ipiHintable";

            const span = document.createElement("span");
            span.className = "textlabel";
            span.textContent = "Expo Settings";

            li.appendChild(a);
            a.appendChild(span);

            // --- --- ---

            menuTable.appendChild(li);
        }

        // --- TOGGLE PANEL ---
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

        // --- SEND EXPO ---
        async function sendExpo(){
            let currConfig = localStorage.getItem("expoFleet");
            if (!currConfig) return;

            currConfig = currConfig.split(",");

            for (let i = 0; i < shipNames.length; i++){
                if (currConfig[i] != 0){
                    window.fleetDispatcher.selectShip(shipNames[i][1], currConfig[i]);
                }
            }

            window.fleetDispatcher.trySubmitFleet1();

            window.fleetDispatcher.targetPlanet.position = 16;

            window.fleetDispatcher.refresh();
            window.fleetDispatcher.updateTarget();

            await sleep(300);

            window.fleetDispatcher.selectMission(15);

            await sleep(800);

            window.fleetDispatcher.trySubmitFleet2();
        }

        // --- SEND MULTIPLE EXPOS TODO!!!!!!
        async function sendExpos(){
            const expeditionSlots = window.fleetDispatcher.maxExpeditionCount;
            let currentExpos = window.fleetDispatcher.expeditionCount;

            sendExpo();
        }

        // --- SAVE FLEET SCRIPT ---
        function saveChanges(){
            //get value by id of input
            //put every value in localstorage
            const values = document.querySelectorAll("[data-id]");
            let storage = [];

            for (let i = 0; i < values.length; i++){
                storage[i] = (values[i].value) ? values[i].value : 0;
            }

            localStorage.setItem("expoFleet", storage);

            location.reload();
        }

        // --- ADD PANEL ---
        function addUIPanel(){

            if (document.querySelector(PANEL_ID)) return;

            const panel = document.createElement("div");
            panel.id = PANEL_ID;
            panel.innerHTML = `
                <h3>Expo Fleet</h3>
            `

            let rowsHTML = "";
            let currConfig = localStorage.getItem("expoFleet");
            if (currConfig) {
                currConfig = currConfig.split(",");
            }

            for (let i = 0, counter = 0; i < rowCount; i++) {
                rowsHTML += `
                <li class="expo-row">
                    <technology-icon class="tooltip" ${shipNames[counter][0]}="" regular="" style="height: 25px; width: 25px; margin-top: 5px"></technology-icon>
                    <label class="labeled-textfield compact-input hideNumberSpin">
                        <input type="number" data-id="${counter}" placeholder="0" value="${(currConfig[counter]) ? currConfig[counter++] : ""}"></input>
                    </label>
                    <label class="labeled-textfield compact-input hideNumberSpin ">
                        <input type="number" data-id="${counter}" placeholder="0" value="${(currConfig[counter]) ? currConfig[counter] : ""}"></input>
                    </label>
                    <technology-icon class="tooltip" ${shipNames[counter++][0]}="" regular="" style="height: 25px; width: 25px; margin-top: 5px"></technology-icon>
                </li>
            `;
            }

            // Combine it into the container
            panel.innerHTML += `
                <ul id="expoTable">
                    ${rowsHTML}
                    <li style="display:block;">
                        <a id="expoSave" class="btn_blue" style="display:block;">
                            Save Changes!
                        </a>
                    </li>
                </ul>
                `;

            document.body.appendChild(panel);

            const a = document.querySelector("#" + FLEET_BTN_ID);
            if (!a) return;

            a.addEventListener('click', (e) => {
                e.preventDefault();
                togglePanel(a, panel);
            });

            const aBtn = document.querySelector("#" + FLEET_SECBTN_ID);
            if (!aBtn) return;

            aBtn.addEventListener('click', (e) => {
                e.preventDefault();
                sendExpos();
            });

            const saveBtn = document.querySelector("#expoSave");
            if (!saveBtn) return;

            saveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                saveChanges();
            });

            // --- GLOBAL CLICK CHECKER FOR EXPO PANEL ---
            document.addEventListener('click', function(event) {
                // If panel is already closed, stop checking
                if (panel.style.display === 'none') return;

                const target = event.target;

                // CHECK: Is the click INSIDE the panel?
                const clickedInsidePanel = panel.contains(target);

                // CHECK: Is the click ON the button? (We handle that separately)
                const clickedButton = a.contains(target);

                // If we clicked OUTSIDE panel AND OUTSIDE button -> Close it
                if (!clickedInsidePanel && !clickedButton) {
                    panel.style.display = 'none';
                }
            });

            document.addEventListener('keydown', function(event){
                let sendExpoBtn = document.querySelector('#customExpoSecBtn');
                if (event.key === 'e' && sendExpoBtn) {
                    sendExpoBtn.click();
                }
            })
        }

        // --- UI CREATION ---
        function addUIElements(){
            addUIBtn();
            addUIPanel();
        }

        // --- MAIN FLEET ---
        function mainFleet(){
            if (isPage('component=fleetdispatch')) {
                console.log("Fleet Page Detected: Injecting UI");
                setTimeout(addUIElements, 500);
            }
        }

        mainFleet();
    }


    // --- UTILITIES SCRIPT ---
    function UtilitiesScript(){

        function waitForDrawerAndInjectEnergy() {
            // 1. SELECTOR: The container OGame uses for the tech drawer
            // In most views, this is #technology_details or #detail
            const drawerID = "technologydetails";

            // 2. THE OBSERVER LOGIC
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    // Check if nodes were added
                    if (mutation.addedNodes.length) {
                        mutation.addedNodes.forEach((node) => {
                            // Check if the added node is our target or contains it
                            if (node.id === drawerID || (node.querySelector && node.querySelector(`#${drawerID}`))) {

                                // Drawer found! Inject your element.
                                handleEnergy();
                            }
                        });
                    }
                });
            });

            // 3. START WATCHING
            // We watch the 'body' or a specific main container for added children
            const targetNode = document.body;
            observer.observe(targetNode, { childList: true, subtree: true });
        }

        function handleEnergy(){
            let energy = document.querySelector(".additional_energy_consumption")
            if (!energy){
                return;
            }

            let current_energy = document.querySelector("#resources_energy");
            if (!current_energy){
                return;
            }

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

        // --- UPDATE VALUES IN SHIPS ---
        function updateValues(){
            let input = document.querySelector('#build_amount');
            if (input){

                // --- HANDLE BONUS ---
                let bonus = document.querySelector(".bonus");
                if (bonus){
                    bonus.textContent = "(+" + bonus.dataset.value * input.value + ")";
                }

            }
        }

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && !document.getElementsByClassName("upgrade")[0].disabled) {
                document.getElementsByClassName("upgrade")[0].click();
            }
        });

        if(isPage('component=shipyard') || isPage('component=supplies')){
            document.addEventListener('input', function(event){
                updateValues();
            });
            document.querySelector("#technologies").addEventListener('click', function(event){
                waitForDrawerAndInjectEnergy();
            });
        }
    }

    AlertsScript();
    ResourcesScript();
    FleetScript();
    UtilitiesScript();

})();


//TODO:
// - TIMER MISSING RES FOR BUILDING
// - HARCORE ALARM FOR ATTACKS AND AUTO CHECK
// - SEMI AUTO EXPO SENDER
// - AUTO EXPO SENDER
// - (HARDER) OBJECTIVE TAB WITH TRACING OF TECH TREE AND RES MANAGEMENT
// -

// id:attack_alert