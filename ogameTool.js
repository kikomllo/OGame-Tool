// ==UserScript==
// @name         OGame Tool
// @namespace    http://tampermonkey.net/
// @version      1.33
// @description  My First Script, hope you enjoy!
// @author       You
// @match        *://*.ogame.gameforge.com/game/*
// @include      *://*.ogame.gameforge.com/game/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://update.greasyfork.org/scripts/572555/OGame%20Tool.user.js
// @updateURL    https://update.greasyfork.org/scripts/572555/OGame%20Tool.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // --- CROSS-BROWSER BRIDGE & STORAGE PREFIX ---
    const gameWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const PREF = gameWindow.location.host + "_";

    // --- SCRIPT CONFIGURATION (KEYBINDS) ---
    const Config = {
        keybinds: {
            sendExpos: 'e',
            upgradeItem: 'Enter',
            maxBids: ['w', 's', 'x'],
            smallBids: ['q', 'a', 'z'],
            clearBids: 'd',
            refreshPage: 'r',
        }
    };

    // --- GLOBAL GAME STATE ---
    const GameState = {
        currentPlanetID: null,
        planetCount: 1,
        maxPlanets: 1,
        serverData: {
            speedFleetPeaceful: 1,
            speedFleetWar: 1,
            speedFleetHolding: 1,
            donutGalaxy: 1,
            donutSystem: 1,
            galaxies: 9
        },
        research: {
            combustion: 0,
            impulse: 0,
            hyperspaceDrive: 0,
            hyperspace: 0,
            astrophysics: 0,
            lastUpdated: 0
        },
        resources: {
            metal: 0,
            crystal: 0,
            deuterium: 0,
            energy: 0
        },
        fleet: {
            current: 0,
            max: 0,
            expos: 0,
            maxExpos: 0
        },
        empireData: {},
        settings: {
            sound_fleet: true,
            notify_fleet: true,
            sound_attack: true,
            notify_attack: true,
            sound_auction: true,
            notify_auction: true,
            volume: 0.5
        },
        auction: {
            active: false,
            timeText: "Unknown",
            shadowEndTime: 0,
            shadowNextAuction: 0,
            currentSum: "0",
            nextFetch: 0,
            hasBeeped: false,
            imageSrc: "",
            itemName: ""
        },
        audioCtx: null,
        beeped: false,
        attackedState: false,
        UINodes: {}
    };

    // --- SHIP DICT ---
    const shipNames = [
        ["fighterlight", 204], ["fighterheavy", 205], ["cruiser", 206], ["battleship", 207],
        ["interceptor", 215], ["bomber", 211], ["destroyer", 213], ["reaper", 218],
        ["explorer", 219], ["transportersmall", 202], ["transporterlarge", 203], ["espionageprobe", 210]
    ];

    // --- MODULE: CORE HELPERS & API (Helpers) ---
    const Helpers = {
        parseCleanJSON: (rawText) => {
            try {
                if (rawText.includes("var MAX_")) {
                    const firstBracket = rawText.indexOf('{');
                    if (firstBracket !== -1) return JSON.parse(rawText.substring(firstBracket));
                }
                return JSON.parse(rawText);
            } catch (e) {
                console.error("[-] WARNING: Invalid JSON format. ", e);
                return {
                    success: false,
                    error: "Invalid Server Response"
                };
            }
        },

        compactNumber: new Intl.NumberFormat('en-US', {
            notation: "compact",
            maximumFractionDigits: 1
        }),

        convSecToTime: (s) => {
            if (s < 0) return "";
            if (s == 0) return "Full";
            let d = Math.floor(s / 86400),
                h = Math.floor((s / 3600) % 24),
                m = Math.floor((s / 60) % 60),
                sec = Math.floor(s % 60);
            let str = "";
            if (d > 0) str += d + "d ";
            if (h > 0) str += h + "h ";
            if (d <= 0 && m > 0) str += m + "m ";
            if (h <= 0) str += sec + "s";
            return str.trim();
        },

        parseISO8601Duration: (dur) => {
            if (!dur) return 0;
            let m = dur.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
            if (!m) return 0;
            return (+(m[1] || 0) * 86400) + (+(m[2] || 0) * 3600) + (+(m[3] || 0) * 60) + +(m[4] || 0);
        },

        simulateClick: (el) => {
            if (el) el.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            }));
        },

        typeValue: (el, val) => {
            if (!el) return;
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, val);
            ['input', 'change', 'keyup'].forEach(e => el.dispatchEvent(new Event(e, {
                bubbles: true
            })));
        },

        waitForElement: (sel) => new Promise(res => {
            if (document.querySelector(sel)) return res(document.querySelector(sel));
            const obs = new MutationObserver(() => {
                if (document.querySelector(sel)) {
                    obs.disconnect();
                    res(document.querySelector(sel));
                }
            });
            obs.observe(document.body, {
                childList: true,
                subtree: true
            });
        }),

        sleep: (ms) => new Promise(r => setTimeout(r, ms)),

        isPage: (part) => gameWindow.location.href && gameWindow.location.href.includes(part),

        notifyNative: (msg, isError = false) => {
            if (typeof gameWindow.fadeBox === 'function') gameWindow.fadeBox(msg, isError);
            else console.log((isError ? "[!] ERROR: " : "[.] INFO: ") + msg);
        }
    };

    // --- MODULE: UIHELPERS (UIHelpers) ---
    const UIHelpers = {
        flashBtn: (btn, text, color, originalHtml, resetTime = 2500) => {
            if (!btn) return;
            btn.innerHTML = `<div style="color: ${color}; font-size: 10px; line-height: 25px; font-weight: bold; text-align: center; width: 27px; height: 27px; background: rgba(0,0,0,0.5); border-radius: 3px;">${text}</div>`;
            if (originalHtml) {
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                }, resetTime);
            }
        }
    };

    // --- MODULE: COREAPI (CoreAPI) ---
    const CoreAPI = {
        async getFleetState() {
            let state = {
                token: gameWindow.fleetDispatcher?.token,
                ships: {}
            };

            if (gameWindow.fleetDispatcher?.shipsData && state.token) {
                for (let id in gameWindow.fleetDispatcher.shipsData) {
                    state.ships[id] = gameWindow.fleetDispatcher.shipsData[id].number;
                }
                return state;
            }

            try {
                const res = await fetch("/game/index.php?page=ingame&component=fleetdispatch", {
                    credentials: 'include'
                });
                const htmlText = await res.text();

                const tokenRegex = /token\s*=\s*["']([^"'\s><]{20,})["']/i;
                const match = htmlText.match(tokenRegex);
                
                if (match && match[1]) {
                    state.token = match[1];
                } else {
                    console.error("[!] ERROR: Could not extract the Token from the background page.");
                }

                const doc = new DOMParser().parseFromString(htmlText, "text/html");
                doc.querySelectorAll('.technology').forEach(node => {
                    let id = node.dataset.technology;
                    let amountNode = node.querySelector('.amount');
                    if (id && amountNode) state.ships[id] = parseInt(amountNode.dataset.value, 10) || 0;
                });
            } catch (err) {
                console.error("[!] CoreAPI: Background sync completely failed.", err);
            }

            return state;
        },

        async dispatchFleet(payloadObj) {
            const sendEndpoint = "/game/index.php?page=ingame&component=fleetdispatch&action=sendFleet&ajax=1&asJson=1";
            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            };
            const payload = new URLSearchParams();
            for (let key in payloadObj) payload.append(key, payloadObj[key]);

            let res = await fetch(sendEndpoint, {
                method: 'POST',
                headers,
                body: payload.toString(),
                credentials: 'include'
            });
            let data = Helpers.parseCleanJSON(await res.text());

            // Token Retry Mechanism
            if (!data.success && data.newAjaxToken) {
                payload.set('token', data.newAjaxToken);
                if (gameWindow.fleetDispatcher) gameWindow.fleetDispatcher.token = data.newAjaxToken;
                res = await fetch(sendEndpoint, {
                    method: 'POST',
                    headers,
                    body: payload.toString(),
                    credentials: 'include'
                });
                data = Helpers.parseCleanJSON(await res.text());
            }

            return data;
        }
    };

    // --- MODULE: ASTRO MATH ENGINE (AstroMath) ---
    const AstroMath = {
        shipSpecs: {
            202: { name: "Small Cargo", base: 5000, cargo: 5000, drive: "combustion", upgrade: { type: "impulse", level: 5, newBase: 10000 } },
            203: { name: "Large Cargo", base: 7500, cargo: 25000, drive: "combustion" },
            204: { name: "Light Fighter", base: 12500, cargo: 50, drive: "combustion" },
            205: { name: "Heavy Fighter", base: 10000, cargo: 100, drive: "impulse" },
            206: { name: "Cruiser", base: 15000, cargo: 800, drive: "impulse" },
            207: { name: "Battleship", base: 10000, cargo: 1500, drive: "hyperspaceDrive" },
            208: { name: "Colony Ship", base: 2500, cargo: 7500, drive: "impulse" },
            209: { name: "Recycler", base: 2000, cargo: 20000, drive: "combustion", upgrade1: { type: "impulse", level: 17, newBase: 4000 }, upgrade2: { type: "hyperspaceDrive", level: 15, newBase: 6000 } },
            210: { name: "Espionage Probe", base: 100000000, cargo: 5, drive: "combustion" }, 
            211: { name: "Bomber", base: 4000, cargo: 500, drive: "impulse", upgrade: { type: "hyperspaceDrive", level: 8, newBase: 5000 } },
            213: { name: "Destroyer", base: 5000, cargo: 2000, drive: "hyperspaceDrive" },
            214: { name: "Deathstar", base: 100, cargo: 1000000, drive: "hyperspaceDrive" },
            215: { name: "Interceptor", base: 10000, cargo: 750, drive: "hyperspaceDrive" },
            218: { name: "Reaper", base: 7000, cargo: 10000, drive: "hyperspaceDrive" },
            219: { name: "Explorer", base: 12000, cargo: 10000, drive: "hyperspaceDrive" }
        },

        calcStorageSpace: function(shipsObj) {
            let totalCargo = 0;
            let hyperLevel = GameState.research.hyperspace || 0;
            let multiplier = 1 + (hyperLevel * 0.05);

            for (let id in shipsObj) {
                let count = shipsObj[id];
                let spec = this.shipSpecs[id];
                if (spec && count > 0) {
                    let baseCargo = (id === "210" || id === 210) ? 0 : spec.cargo;
                    totalCargo += Math.floor(baseCargo * multiplier) * count;
                }
            }
            return totalCargo;
        },

        getMaxRes: function(totalCargo) {
            let res = {
                metal: parseInt(document.querySelector('#resources_metal')?.dataset.raw || 0, 10),
                crystal: parseInt(document.querySelector('#resources_crystal')?.dataset.raw || 0, 10),
                deuterium: parseInt(document.querySelector('#resources_deuterium')?.dataset.raw || 0, 10)
            };

            // Leave a 10k Deuterium buffer on the planet to ensure the fleet has fuel to launch
            res.deuterium = Math.max(0, res.deuterium - 10000);

            let results = { metal: 0, crystal: 0, deuterium: 0 };
            const priority = ['deuterium', 'crystal', 'metal'];

            for (const type of priority) {
                let amountToTake = Math.min(res[type], totalCargo);
                results[type] = amountToTake;
                totalCargo -= amountToTake;
            }

            return results;
        },

        getShipSpeed: function(shipID) {
            let spec = this.shipSpecs[shipID];
            if (!spec) return 0;
            let currentDrive = spec.drive,
                currentBase = spec.base,
                res = GameState.research;

            if (shipID == 209) {
                if (res.hyperspaceDrive >= spec.upgrade2.level) {
                    currentDrive = spec.upgrade2.type;
                    currentBase = spec.upgrade2.newBase;
                } else if (res.impulse >= spec.upgrade1.level) {
                    currentDrive = spec.upgrade1.type;
                    currentBase = spec.upgrade1.newBase;
                }
            } else if (spec.upgrade && res[spec.upgrade.type] >= spec.upgrade.level) {
                currentDrive = spec.upgrade.type;
                currentBase = spec.upgrade.newBase;
            }

            let mult = 0;
            if (currentDrive === "combustion") mult = 0.1 * res.combustion;
            if (currentDrive === "impulse") mult = 0.2 * res.impulse;
            if (currentDrive === "hyperspaceDrive") mult = 0.3 * res.hyperspaceDrive;

            return Math.floor(currentBase * (1 + mult));
        },

        getDistance: function(origin, target) {
            let g1 = parseInt(origin.g),
                s1 = parseInt(origin.s),
                p1 = parseInt(origin.p);
            let g2 = parseInt(target.g),
                s2 = parseInt(target.s),
                p2 = parseInt(target.p);

            if (g1 === g2 && s1 === s2 && p1 === p2) return 5;
            if (g1 === g2 && s1 === s2) return 1000 + (5 * Math.abs(p2 - p1));

            if (g1 === g2) {
                let sysDiff = Math.abs(s2 - s1);
                if (GameState.serverData.donutSystem === 1) sysDiff = Math.min(sysDiff, 499 - sysDiff);
                return 2700 + (95 * sysDiff);
            }

            let galDiff = Math.abs(g2 - g1);
            if (GameState.serverData.donutGalaxy === 1) galDiff = Math.min(galDiff, GameState.serverData.galaxies - galDiff);

            return 20000 * galDiff;
        },

        getFlightTime: function(distance, slowestShipSpeed, speedPercent, fleetSpeedType = 'peaceful') {
            if (!slowestShipSpeed || slowestShipSpeed === 0) return 0;
            let pFact = speedPercent / 10,
                sMult = 1;
            if (fleetSpeedType === 'peaceful') sMult = GameState.serverData.speedFleetPeaceful;
            if (fleetSpeedType === 'war') sMult = GameState.serverData.speedFleetWar;
            if (fleetSpeedType === 'holding') sMult = GameState.serverData.speedFleetHolding;

            return Math.floor((10 + (35000 / pFact) * Math.sqrt((distance * 10) / slowestShipSpeed)) / sMult);
        },

        calculateFS: function(targetTimeSeconds, origin, slowestShipSpeed, missionType) {
            let pTarget = (missionType === '7') ? 15 : 16;

            let speedType = 'peaceful';
            if (missionType === '6' || missionType === '1' || missionType === '2' || missionType === '9') speedType = 'war';
            else if (missionType === '5') speedType = 'holding';

            let tType = 1;
            let targets = [];

            targets.push({ g: origin.g, s: origin.s, p: pTarget });

            let maxSysDiff = (GameState.serverData.donutSystem === 1) ? Math.floor(499 / 2) : 498;
            for (let d = 1; d <= maxSysDiff; d++) {
                let sUp = origin.s + d;
                if (sUp > 499) {
                    if (GameState.serverData.donutSystem === 1) sUp -= 499;
                    else sUp = null;
                }
                if (sUp !== null) targets.push({ g: origin.g, s: sUp, p: pTarget });

                let sDown = origin.s - d;
                if (sDown < 1) {
                    if (GameState.serverData.donutSystem === 1) sDown += 499;
                    else sDown = null;
                }
                if (sDown !== null) targets.push({ g: origin.g, s: sDown, p: pTarget });
            }

            let maxGalDiff = (GameState.serverData.donutGalaxy === 1) ? Math.floor(GameState.serverData.galaxies / 2) : (GameState.serverData.galaxies - 1);
            for (let d = 1; d <= maxGalDiff; d++) {
                let gUp = origin.g + d;
                if (gUp > GameState.serverData.galaxies) {
                    if (GameState.serverData.donutGalaxy === 1) gUp -= GameState.serverData.galaxies;
                    else gUp = null;
                }
                if (gUp !== null) targets.push({ g: gUp, s: origin.s, p: pTarget });

                let gDown = origin.g - d;
                if (gDown < 1) {
                    if (GameState.serverData.donutGalaxy === 1) gDown += GameState.serverData.galaxies;
                    else gDown = null;
                }
                if (gDown !== null) targets.push({ g: gDown, s: origin.s, p: pTarget });
            }

            targets.forEach(t => {
                t.dist = this.getDistance(origin, t);
            });
            targets.sort((a, b) => a.dist - b.dist);

            let bestResult = { time: Infinity, g: origin.g, s: origin.s, p: pTarget, speed: 10, type: tType };
            let perfectMatchFound = false;

            for (let speed = 10; speed <= 100; speed += 10) {
                for (let t of targets) {
                    let roundTrip = this.getFlightTime(t.dist, slowestShipSpeed, speed, speedType) * 2;
                    
                    if (roundTrip >= targetTimeSeconds) {
                        if (roundTrip < bestResult.time) {
                            bestResult = { time: roundTrip, g: t.g, s: t.s, p: t.p, speed: speed, type: tType };
                        }
                        
                        if (roundTrip - targetTimeSeconds <= 60) {
                            perfectMatchFound = true;
                        }
                        
                        break;
                    }
                }
                if (perfectMatchFound) break; 
            }

            if (!perfectMatchFound && bestResult.time === Infinity) {
                let longest = targets[targets.length - 1];
                return {
                    time: this.getFlightTime(longest.dist, slowestShipSpeed, 10, speedType) * 2,
                    g: longest.g, s: longest.s, p: longest.p, speed: 10, type: tType
                };
            }

            return bestResult;
        }
    };

    const MasterClockQueue = [];

    // --- MODULE: GLOBAL CSS (injectGlobalCSS) ---
    const injectGlobalCSS = () => {
        let css = `
            /* --- FLEET PANEL --- */
            #customPanel, #fsPanel { position: absolute; z-index: 99999; background-color: #161b23EE; border: 1px solid #455266; color: white; padding: 15px; width: auto; height: auto; border-radius: 4px; box-shadow: 4px 4px 10px rgba(0,0,0,0.8); display: none; }
            #customPanel h3, #fsPanel h3 { margin-top: 0; border-bottom: 1px solid #455266; padding-bottom: 5px; text-align: center; color: #ff9600; font-size: 14px; }
            #expoTable { list-style: none; padding: 0; margin: 0; }
            .expo-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
            .compact-input { width: 40px !important; height: 22px; padding-left: 4px; padding-right: 4px; position: relative; }

            /* --- FS SPECIFIC INPUTS --- */
            .fs-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 15px; }
            .fs-input { width: 65px; height: 22px; background: #11141a; color: white; border: 1px solid #455266; border-radius: 3px; text-align: center; font-family: monospace; font-size: 13px; letter-spacing: 1px; margin-top: 5px; margin-right: 2px; }
            .fs-mission-container { display: flex; justify-content: center; gap: 15px; margin: 0 auto; width: 100%; }
            .fs-mission-btn { width: 24px; height: 24px; border: 1px solid #455266; border-radius: 3px; background-color: #11141a; background-image: url('https://gf2.geo.gfsrv.net/cdn14/f45a18b5e55d2d38e7bdc3151b1fee.jpg'); background-size: 345px 105px; cursor: pointer; opacity: 0.5; transition: all 0.2s; }
            .fs-mission-btn:hover { opacity: 0.8; border-color: #8496b0; background-position-y: -1px;}
            .fs-mission-btn.selected { opacity: 1; border-color: #ff9600; box-shadow: 0 0 5px rgba(255,150,0,0.5); background-position-y: -1px;}
            .fs-icon-spy { background-position: -192px -54px; } .fs-icon-colo { background-position: -66px -54px; }

            /* --- GLOBAL OGAME OVERRIDES --- */
            .planetBarSpaceObjectHighlightContainer { width: 23px !important; height: 23px !important; margin-left: 3.5px !important; margin-right: 10px !important; }
            .planetBarSpaceObjectContainer { justify-content: flex-start !important; height: 20px !important; margin-top: 10px !important; }
            .smallplanet { height: 50px !important; width: 140px !important; position: relative !important; }
            .planet-name { margin-right: auto !important; margin-left: 5px !important; text-align: left !important; display: inline-block !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; max-width: 60px !important; }
            
            /* Planet & Moon Z-Index and Sizing Fixes */
            a.planetlink { position: relative !important; z-index: 5 !important; }
            .planetPic { width: 30px !important; height: 30px !important; padding-right: 5px; }
            
            /* Pop the moon link out of flow and REMOVE NATIVE PADDING */
            a.moonlink { width: 18px !important; height: 18px !important; padding: 0 !important; position: absolute !important; top: 27px !important; left: 15px !important; z-index: 10 !important; }
            
            /* Prevent the global container override from breaking the moon's inner container */
            a.moonlink .planetBarSpaceObjectContainer { margin-top: 0px !important; height: 14px !important; }
            
            /* Size the actual moon image */
            .icon-moon { width: 18px !important; height: 18px !important; margin-left: -8px; }

            /* --- RESTORED: Construction Icon & Planet List Fade-in --- */
            a.constructionIcon { top: 29px !important; left: -2px !important; z-index: 20;}
            #planetList:not(.custom-ready) { opacity: 0 !important; visibility: hidden !important; }
            #planetList.custom-ready { opacity: 1 !important; visibility: visible !important; transition: opacity 0.15s ease-in; }

            /* --- CSS RESOURCES --- */
            .my-resource-timer { position: relative; font-size: 9px; margin-top: 13px; pointer-events: none; }
            .custom-res-table { display: flex; flex-direction: column; align-items: flex-end; font-size: 9px; line-height: 11px; margin-left: auto !important; margin-right: 5px !important; pointer-events: none; }
            .res-m { color: #a4a4a4; font-weight: bold; } .res-c { color: #2389d7; font-weight: bold; } .res-d { color: #1fb37d; font-weight: bold; }
            .custom-mines-table { display: flex; flex-direction: row; justify-content: space-between; width: 134px; font-size: 7px; position: absolute !important; bottom: -22px !important; left: 2px !important; pointer-events: none; }

            #bannerSkyscrapercomponent { display: none !important; }
            .custom-keybind-hint { position: absolute; top: -10px; right: 5px; background-color: #ff9600; color: #161b23; font-size: 8px; font-weight: 900; padding: 1px 4px; border-radius: 10px; pointer-events: none; z-index: 999; box-shadow: 1px 1px 3px rgba(0,0,0,0.8); text-transform: uppercase; }

            /* --- CSS ALERT SETTINGS --- */
            #custom-settings-panel { background-color: #161b23EE; border: 1px solid #455266; color: #999; padding: 10px; margin-left: 5px; margin-top: 5px; border-radius: 11px; width: 132px; height: 85px; font-size: 9px; box-shadow: 2px 2px 5px rgba(0,0,0,0.5); }
            #custom-settings-panel h4 { color: #ff9600; margin: 0 0 8px 0; text-align: center; font-size: 11px; border-bottom: 1px solid #455266; padding-bottom: 4px; }
            .setting-row { display: grid; grid-template-columns: 40px 1fr 1fr 1fr; align-items: center; margin-bottom: 6px; text-align: center; }
            .setting-row label { text-align: left; color: #8496b0; }
            .ui-chip { cursor: pointer; padding: 2px 0; border-radius: 2px; transition: all 0.1s; user-select: none; }
            .vol-row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 6px; border-top: 1px dashed #344054; }
            .vol-btn { background: #2b3441; border: 1px solid #455266; color: white; cursor: pointer; width: 20px; height: 15px; line-height: 15px; text-align: center; border-radius: 3px; font-weight: bold; user-select: none; }
            .vol-btn:hover { background: #ff9600; border-color: #ff9600; color: black; }

            /* --- CSS AUCTION PANEL --- */
            #custom-auction-panel { position: fixed; top: 40px; right: 15px; background-color: #161b23EE; border: 1px solid #455266; color: #999; padding: 6px 10px; border-radius: 4px; font-size: 10px; z-index: 500; display: flex; align-items: center; gap: 10px; pointer-events: auto; box-shadow: 2px 2px 5px rgba(0,0,0,0.5); cursor: pointer; user-select: none; transition: border-color 0.2s ease-in-out; }
            #custom-auction-panel:hover { border-color: #ff9600; }
            #custom-auction-panel img { width: 32px; height: 32px; border-radius: 3px; display: none; border: 1px solid #455266; pointer-events: auto; }
            .auction-info-col { display: flex; flex-direction: column; align-items: flex-end; }
            .auction-title { color: #ff9600; font-weight: bold; margin-bottom: 2px; }
            .auction-bid-text { color: #a4a4a4; }
        `;
        let style = document.createElement('style');
        style.id = 'custom-style';
        style.type = 'text/css';
        style.innerHTML = css;
        (document.head || document.documentElement).appendChild(style);
    };

    injectGlobalCSS();

    //  --- MODULE: ALERTS (AlertsScript) --- 
    function AlertsScript() {
        function initAudioContext() {
            if (!GameState.audioCtx) GameState.audioCtx = new(gameWindow.AudioContext || gameWindow.webkitAudioContext)();
            if (GameState.audioCtx.state === 'suspended') GameState.audioCtx.resume();
        }

        function unlockAudio() {
            initAudioContext();
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('keydown', unlockAudio);
        }

        document.addEventListener('click', unlockAudio);
        document.addEventListener('keydown', unlockAudio);
        initAudioContext();

        function notifyUser(header = null, message = null) {
            if (!message || !("Notification" in gameWindow)) return;
            if (Notification.permission === "granted") createNotification(header, message);
            else if (Notification.permission !== "denied") Notification.requestPermission().then((p) => {
                if (p === "granted") createNotification(header, message);
            });
        }

        function createNotification(header = null, message = null) {
            let notif = new Notification(header || "", {
                body: message || "",
                icon: "https://cdn-icons-png.flaticon.com/512/1827/1827347.png",
                requireInteraction: false
            });
            notif.onclick = () => gameWindow.focus();
        }

        function playBeep(freq = 1600) {
            if (!GameState.audioCtx) return;
            const play = () => {
                const osc = GameState.audioCtx.createOscillator(),
                    gain = GameState.audioCtx.createGain();
                osc.connect(gain);
                gain.connect(GameState.audioCtx.destination);
                osc.type = "sine";
                osc.frequency.value = freq;
                gain.gain.value = GameState.settings.volume;
                osc.start();
                osc.stop(GameState.audioCtx.currentTime + 0.100);
            };
            if (GameState.audioCtx.state === 'suspended') GameState.audioCtx.resume().then(play).catch(err => console.warn("Audio blocked.", err));
            else play();
        }

        async function fleetAlert() {
            if (GameState.beeped) return;
            if (GameState.settings.notify_fleet) notifyUser("Fleet Timer Out!", "Your fleet has arrived!");
            if (!GameState.settings.sound_fleet) return;
            playBeep(1000);
            await Helpers.sleep(100);
            playBeep(1200);
            await Helpers.sleep(100);
            playBeep(1000);
            await Helpers.sleep(100);
            playBeep(1600);
        }

        function attackAlert() {
            if (GameState.settings.notify_attack && !GameState.attackedState) notifyUser("ATTACK!", "YOU ARE BEING ATTACKED!");
            if (GameState.settings.sound_attack) playBeep(1000);
        }

        async function auctionAlert() {
            if (GameState.settings.notify_auction) notifyUser("Auction Info:", "Auction will end in aprox: 2m30s.");
            if (!GameState.settings.sound_auction) return;
            playBeep(600);
            await Helpers.sleep(150);
            playBeep(800);
            await Helpers.sleep(150);
            playBeep(1200);
        }

        function checkFleetEvents() {
            let timerElement = document.querySelector("#tempcounter");
            if (!timerElement) return;
            if (document.querySelector(".soon")) {
                attackAlert();
                if (!GameState.attackedState) GameState.attackedState = true;
            } else GameState.attackedState = false;

            let timeText = timerElement.textContent.trim();
            if (!/^(?:\d+h\s*)?(?:\d+m\s*)?(?:\d+s)?$/.test(timeText) && timeText) {
                fleetAlert();
                if (!GameState.beeped) GameState.beeped = true;
            } else GameState.beeped = false;
        }

        function checkAuctionEvents() {
            let now = Date.now();

            if (GameState.auction.shadowEndTime > 0){
                let s = Math.max(0, Math.floor((GameState.auction.shadowEndTime - now) / 1000));
                
                if (s <= 150) {
                    if (!GameState.auction.hasBeeped) {
                        auctionAlert();
                        GameState.auction.hasBeeped = true;
                        localStorage.setItem(PREF + "AuctionState", JSON.stringify(GameState.auction));
                    }
                }
            } else {
                if (GameState.auction.timeText !== "Aprox. 5m" && GameState.auction.shadowEndTime === 0 && GameState.auction.hasBeeped) {
                    GameState.auction.hasBeeped = false;
                    localStorage.setItem(PREF + "AuctionState", JSON.stringify(GameState.auction));
                }
            }
        }

        function injectSettingsPanel() {
            const muteElements = [
                "sound_fleet", "sound_attack", "sound_auction",
                "notify_fleet", "notify_attack", "notify_auction"
            ];

            if (document.getElementById("custom-settings-panel")) return;
            const menuTable = document.querySelector("#menuTable");
            if (!menuTable) return;
            const panel = document.createElement("div");
            panel.id = "custom-settings-panel";
            panel.innerHTML = `
                <h4>Alert Settings</h4>
                <div class="setting-row">
                    <label>Sound:</label>
                    <a id="sound_fleet" class="ui-chip" style="${GameState.settings.sound_fleet ? "color:#9c0; font-weight:bold;" : "color:#666;"}">Fleet</a>
                    <a id="sound_attack" class="ui-chip" style="${GameState.settings.sound_attack ? "color:#d43635; font-weight:bold;" : "color:#666;"}">Atk</a>
                    <a id="sound_auction" class="ui-chip" style="${GameState.settings.sound_auction ? "color:#2389d7; font-weight:bold;" : "color:#666;"}">Auct</a>
                </div>
                <div class="setting-row">
                    <label>Notifs:</label>
                    <a id="notify_fleet" class="ui-chip" style="${GameState.settings.notify_fleet ? "color:#9c0; font-weight:bold;" : "color:#666;"}">Fleet</a>
                    <a id="notify_attack" class="ui-chip" style="${GameState.settings.notify_attack ? "color:#d43635; font-weight:bold;" : "color:#666;"}">Atk</a>
                    <a id="notify_auction" class="ui-chip" style="${GameState.settings.notify_auction ? "color:#2389d7; font-weight:bold;" : "color:#666;"}">Auct</a>
                </div>
                <div class="vol-row">
                    <label>Volume:</label><div style="display:flex; align-items:center; gap:8px;"><div id="vol_down" class="vol-btn">-</div><span id="vol_display" style="color:white; width:25px; text-align:center;">${Math.round(GameState.settings.volume * 100)}%</span><div id="vol_up" class="vol-btn">+</div></div>
                </div>`;
            menuTable.parentNode.append(panel, menuTable.nextSibling);

            muteElements.forEach(el => {
                document.getElementById(el).addEventListener("click", (e) => {
                    GameState.settings[el] = !GameState.settings[el];
                    let ac = "#9c0";
                    if (el.includes("attack")) ac = "#d43635";
                    if (el.includes("auction")) ac = "#2389d7";
                    e.target.style.color = GameState.settings[el] ? ac : "#666";
                    e.target.style.fontWeight = GameState.settings[el] ? "bold" : "normal";
                    if (el.includes("notify_") && GameState.settings[el] && "Notification" in gameWindow && Notification.permission !== "granted")
                        Notification.requestPermission();
                    localStorage.setItem(PREF + "OgameSettings", JSON.stringify(GameState.settings));
                });
            });

            const updateVol = (change) => {
                GameState.settings.volume = parseFloat(Math.max(0.0, Math.min(1.0, GameState.settings.volume + change)).toFixed(1));
                document.getElementById("vol_display").textContent = Math.round(GameState.settings.volume * 100) + "%";
                localStorage.setItem(PREF + "OgameSettings", JSON.stringify(GameState.settings));
                playBeep(1000);
            };

            document.getElementById("vol_down").addEventListener("click", () => updateVol(-0.1));
            document.getElementById("vol_up").addEventListener("click", () => updateVol(0.1));
        }

        injectSettingsPanel();
        MasterClockQueue.push(checkFleetEvents, checkAuctionEvents);
    }

    // --- MODULE: DATA SCRAPERS (Resources, Research, Server) ---
    function ResourcesScript() {
        let empEconomy = GameState.empireData,
            hasScraped = false;

        function scrapeMineLevels() {
            if (!Helpers.isPage('supplies')) {
                hasScraped = false;
                return;
            }
            if (hasScraped) return;
            const pid = document.querySelector('meta[name="ogame-planet-id"]')?.content;
            if (!pid) return;

            Helpers.waitForElement('.technology[data-technology="1"] .level').then(() => {
                let m = document.querySelector('.technology[data-technology="1"] .level'),
                    c = document.querySelector('.technology[data-technology="2"] .level'),
                    d = document.querySelector('.technology[data-technology="3"] .level');
                if (m && c && d) {
                    if (!empEconomy[pid]) empEconomy[pid] = {};
                    empEconomy[pid].mines = {
                        metal: parseInt(m.dataset.value, 10),
                        crystal: parseInt(c.dataset.value, 10),
                        deuterium: parseInt(d.dataset.value, 10)
                    };
                    localStorage.setItem(PREF + "EmpireEconomy", JSON.stringify(empEconomy));
                }
            });
            hasScraped = true;
        }

        function getResObj(data, type) {
            let v = data.resources[type];
            if (!v) return null;
            return {
                production: parseFloat(v.production),
                current: parseFloat(v.amount),
                max: parseFloat(v.storage)
            };
        }

        function fetchInitialResources() {
            fetch("/game/index.php?page=fetchResources&ajax=1").then(r => r.text()).then(Helpers.parseCleanJSON).then(data => {
                const pid = document.querySelector('meta[name="ogame-planet-id"]')?.content;
                if (!pid) return;
                empEconomy[pid] = {
                    timestamp: Date.now(),
                    mines: empEconomy[pid]?.mines || null,
                    metal: getResObj(data, "metal"),
                    crystal: getResObj(data, "crystal"),
                    deuterium: getResObj(data, "deuterium")
                };
                localStorage.setItem(PREF + "EmpireEconomy", JSON.stringify(empEconomy));
            }).catch(e => {
                if (!(e.name === 'TypeError' && e.message.includes('NetworkError'))) console.error("[!] Resource fetch error", e);
            });
        }

        function localResourceTick() {
            if (!GameState.currentPlanetID || !empEconomy[GameState.currentPlanetID]) return;
            let planet = empEconomy[GameState.currentPlanetID],
                sec = (Date.now() - planet.timestamp) / 1000;

            ["metal", "crystal", "deuterium"].forEach(type => {
                let r = planet[type];
                if (!r) return;
                let ex = Math.min(r.current + (r.production * sec), r.max);
                GameState.resources[type] = ex;
                let missingSec = (r.production <= 0) ? -1 : (ex >= r.max) ? 0 : Math.floor((r.max - ex) / r.production);

                let container = document.querySelector("#" + type + "_box");
                if (container) {
                    let div = container.querySelector("#timer-" + type) || Object.assign(document.createElement("div"), {
                        id: "timer-" + type,
                        className: "my-resource-timer"
                    });
                    if (!div.parentNode) container.appendChild(div);
                    div.textContent = Helpers.convSecToTime(missingSec);
                    div.style.color = (div.textContent === "Full") ? "#d43635" : "#999";
                }
            });

            for (let pID in empEconomy) {
                let pData = empEconomy[pID],
                    ui = GameState.UINodes[pID];
                if (!ui || !ui.res || !ui.mines) continue;
                if (pData.timestamp) {
                    let ps = (Date.now() - pData.timestamp) / 1000;
                    let live = (obj) => obj ? Math.max(Math.floor(Math.min(obj.current + (obj.production * ps), obj.max)), obj.current) : 0;
                    ui.res.children[0].textContent = Helpers.compactNumber.format(live(pData.metal));
                    ui.res.children[1].textContent = Helpers.compactNumber.format(live(pData.crystal));
                    ui.res.children[2].textContent = Helpers.compactNumber.format(live(pData.deuterium));
                }
                if (pData.mines) {
                    ui.mines.children[0].textContent = pData.mines.metal;
                    ui.mines.children[1].textContent = pData.mines.crystal;
                    ui.mines.children[2].textContent = pData.mines.deuterium;
                }
            }
        }
        fetchInitialResources();
        MasterClockQueue.push(scrapeMineLevels, localResourceTick);
    }

    function ResearchScript() {
        let saved = localStorage.getItem(PREF + "PlayerResearch");
        if (saved) GameState.research = JSON.parse(saved);

        function extractResearch(doc) {
            let updated = false,
                map = {
                    115: 'combustion',
                    117: 'impulse',
                    118: 'hyperspaceDrive',
                    114: 'hyperspace',
                    124: 'astrophysics'
                };
            for (let id in map) {
                let n = doc.querySelector(`.technology[data-technology="${id}"] .level`);
                if (n && n.dataset.value) {
                    GameState.research[map[id]] = parseInt(n.dataset.value, 10);
                    updated = true;
                }
            }
            if (updated) {
                GameState.research.lastUpdated = Date.now();
                localStorage.setItem(PREF + "PlayerResearch", JSON.stringify(GameState.research));
            }
        }

        async function fetchResearch() {
            if (GameState.research.combustion === 0 || (Date.now() - (GameState.research.lastUpdated || 0)) / 3600000 > 24) {
                try {
                    let html = await (await fetch("/game/index.php?page=ingame&component=research", {
                        credentials: 'include'
                    })).text();
                    extractResearch(new DOMParser().parseFromString(html, "text/html"));
                } catch (e) {
                    if (!e.message.includes('NetworkError')) console.error("Research fetch error", e);
                }
            }
        }
        if (Helpers.isPage('component=research')) Helpers.waitForElement('.technology[data-technology="115"] .level').then(() => extractResearch(document));
        fetchResearch();
    }

    function ServerDataScript() {
        let col = document.querySelector('#countColonies');
        if (col) {
            let m = col.textContent.match(/(\d+)\s*\/\s*(\d+)/);
            if (m) {
                GameState.planetCount = parseInt(m[1], 10);
                GameState.maxPlanets = parseInt(m[2], 10);
            }
        }
        let saved = localStorage.getItem(PREF + "OGameServerData");
        if (saved) GameState.serverData = JSON.parse(saved);
        if (!saved) {
            fetch('/api/serverData.xml').then(r => r.text()).then(txt => {
                let xml = new DOMParser().parseFromString(txt, "text/xml");
                let getVal = (t, fb) => xml.getElementsByTagName(t)[0] && !isNaN(parseFloat(xml.getElementsByTagName(t)[0].textContent)) ? parseFloat(xml.getElementsByTagName(t)[0].textContent) : fb;
                let b = getVal('speedFleet', 1);
                GameState.serverData = {
                    speedFleetPeaceful: getVal('speedFleetPeaceful', b),
                    speedFleetWar: getVal('speedFleetWar', b),
                    speedFleetHolding: getVal('speedFleetHolding', b),
                    donutGalaxy: getVal('donutGalaxy', 1),
                    donutSystem: getVal('donutSystem', 1),
                    galaxies: getVal('galaxies', 9)
                };
                localStorage.setItem(PREF + "OGameServerData", JSON.stringify(GameState.serverData));
            }).catch(e => console.error("Server data error", e));
        }
    }

    // --- MODULE: EXPO SENDER (ExpoScript) ---
    function ExpoScript() {
        const FLEET_BTN_ID = "customExpoBtn",
            FLEET_SECBTN_ID = "customExpoSecBtn",
            PANEL_ID = "customPanel";
        let abortExpos = false;
        if (!localStorage.getItem(PREF + "expoFleet")) localStorage.setItem(PREF + "expoFleet", "");

        const handleMenuInteraction = (e) => {
            const a = e.target.closest("#" + FLEET_BTN_ID),
                aBtn = e.target.closest("#" + FLEET_SECBTN_ID),
                saveBtn = e.target.closest("#expoSave"),
                panel = document.getElementById(PANEL_ID),
                shipIcon = e.target.closest(".clickable-ship");
            if (a) {
                e.preventDefault();
                let fsPanel = document.getElementById("fsPanel");
                if (fsPanel) fsPanel.style.display = 'none';
                if (panel) panel.style.display = panel.style.display === "block" ? "none" : (panel.style.top = a.getBoundingClientRect().top + "px", panel.style.left = (a.getBoundingClientRect().right + 5) + "px", "block");
            }
            if (aBtn) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (aBtn.dataset.sending === "true") {
                    abortExpos = true;
                    UIHelpers.flashBtn(aBtn, "STP!", "#b41414");
                    return;
                }
                abortExpos = false;
                aBtn.dataset.sending = "true";
                sendExpos(aBtn);
            }
            if (saveBtn) {
                e.preventDefault();
                e.stopImmediatePropagation();
                localStorage.setItem(PREF + "expoFleet", Array.from(document.querySelectorAll("[data-id]")).map(el => el.value || 0));
                location.reload();
            }
            if (shipIcon && gameWindow.fleetDispatcher) {
                e.preventDefault();
                e.stopImmediatePropagation();
                let id = shipIcon.getAttribute("data-ship-id"),
                    inEl = document.querySelector(`input[data-id="${shipIcon.getAttribute("data-input-id")}"]`);
                if (inEl) {
                    let avExp = Math.max(1, gameWindow.fleetDispatcher.maxExpeditionCount - (gameWindow.fleetDispatcher.expeditionCount || 0));
                    let avShip = gameWindow.fleetDispatcher.shipsData?.[id] ? gameWindow.fleetDispatcher.shipsData[id].number : (parseInt(document.querySelector(`li[data-technology="${id}"] .amount`)?.dataset.value, 10) || 0);
                    inEl.value = Math.floor(avShip / avExp);
                }
            }
            if (panel && panel.style.display === 'block' && !panel.contains(e.target) && (!a || !a.contains(e.target))) panel.style.display = 'none';
        };

        document.addEventListener('click', handleMenuInteraction, true);
        document.addEventListener('focusin', (e) => {
            if (e.target && e.target.matches('.compact-input input')) e.target.select();
        });

        function injectUI() {
            if (!document.querySelector("#menuTable") || document.querySelector("#" + FLEET_BTN_ID)) return;
            const li = document.createElement("li"),
                sBtn = document.createElement("span");
            sBtn.id = FLEET_SECBTN_ID;
            sBtn.className = "menu_icon";
            sBtn.innerHTML = `<a class="tooltipRight js_hideTipOnMobile"><div class="menuImage fleet1 ipiHintable" data="Send Expos!"></div></a>`;
            li.appendChild(sBtn);
            const a = document.createElement("a");
            a.id = FLEET_BTN_ID;
            a.className = "menubutton";
            a.href = "javascript:void(0);";
            a.innerHTML = `<span class="textlabel">Expo Settings</span>`;
            li.appendChild(a);
            document.querySelector("#menuTable").appendChild(li);

            const p = document.createElement("div");
            p.id = PANEL_ID;
            let rowsHTML = "",
                conf = (localStorage.getItem(PREF + "expoFleet") || "").split(",");
            for (let i = 0, c = 0; i < 6; i++) {
                rowsHTML += `<li class="expo-row"><technology-icon class="tooltip clickable-ship" data-ship-id="${shipNames[c][1]}" data-input-id="${c}" ${shipNames[c][0]}="" regular="" style="height: 25px; width: 25px; cursor: pointer;"></technology-icon><label class="labeled-textfield compact-input hideNumberSpin"><input type="number" data-id="${c}" value="${conf[c]||""}"></label>`;
                c++;
                rowsHTML += `<label class="labeled-textfield compact-input hideNumberSpin"><input type="number" data-id="${c}" value="${conf[c]||""}"></label><technology-icon class="tooltip clickable-ship" data-ship-id="${shipNames[c][1]}" data-input-id="${c}" ${shipNames[c][0]}="" regular="" style="height: 25px; width: 25px; cursor: pointer;"></technology-icon></li>`;
                c++;
            }
            p.innerHTML = `<h3>Expo Fleet</h3><ul id="expoTable">${rowsHTML}<li style="display:block;"><a id="expoSave" class="btn_blue" style="display:block;">Save Changes!</a></li></ul>`;
            document.body.appendChild(p);
        }

        async function sendExpoAPI(state) {
            let conf = localStorage.getItem(PREF + "expoFleet").split(",");
            let cMatch = document.querySelector('meta[name="ogame-planet-coordinates"]')?.content.match(/\d+/g);
            if (!cMatch) return false;

            let payloadShips = {},
                totalReq = 0,
                totalAdd = 0;
            for (let i = 0; i < shipNames.length; i++) {
                let id = shipNames[i][1],
                    req = parseInt(conf[i]) || 0;
                if (req > 0) {
                    totalReq += req;
                    let avail = state.ships[id] || 0,
                        send = Math.min(req, avail);
                    if (send > 0) {
                        payloadShips[`am${id}`] = send;
                        totalAdd += send;
                    } else if (i > 0 && i < 8) {
                        for (let j = i - 1; j >= 0; j--) {
                            let fID = shipNames[j][1],
                                fAvail = state.ships[fID] || 0,
                                fSend = Math.min(req, fAvail);
                            if (fSend > 0) {
                                payloadShips[`am${fID}`] = fSend;
                                totalAdd += fSend;
                                break;
                            }
                        }
                    }
                }
            }
            if (totalAdd < totalReq || totalAdd === 0) return false;

            let payloadObj = {
                galaxy: cMatch[0],
                system: cMatch[1],
                position: 16,
                type: 1,
                metal: 0,
                crystal: 0,
                deuterium: 0,
                food: 0,
                prioMetal: 2,
                prioCrystal: 3,
                prioDeuterium: 4,
                prioFood: 1,
                mission: 15,
                speed: 10,
                retreatAfterDefenderRetreat: 0,
                lootFoodOnAttack: 1,
                union: 0,
                holdingtime: 1
            };
            Object.assign(payloadObj, payloadShips);

            let data = await CoreAPI.dispatchFleet(payloadObj);
            if (data.success) {
                for (let k in payloadShips) {
                    let id = k.replace('am', '');
                    state.ships[id] -= payloadShips[k]; // update local state
                    if (gameWindow.fleetDispatcher?.shipsData?.[id]) gameWindow.fleetDispatcher.shipsData[id].number -= payloadShips[k];
                    let v = document.querySelector(`li[data-technology="${id}"] .amount`);
                    if (v) {
                        v.dataset.value = state.ships[id];
                        v.textContent = state.ships[id];
                    }
                }
                if (gameWindow.fleetDispatcher?.refresh) gameWindow.fleetDispatcher.refresh();
                return true;
            }
            return false;
        }

        async function sendExpos(btn) {
            let state = await CoreAPI.getFleetState();
            let maxSend = Math.min((gameWindow.fleetDispatcher?.maxFleetCount || 1) - (gameWindow.fleetDispatcher?.fleetCount || 0), Math.max(1, (gameWindow.fleetDispatcher?.maxExpeditionCount || 1)) - (gameWindow.fleetDispatcher?.expeditionCount || 0));
            if (maxSend <= 0) {
                btn.dataset.sending = "false";
                return;
            }

            let fullSuccess = true;
            for (let i = 0; i < maxSend; i++) {
                if (abortExpos) {
                    fullSuccess = false;
                    break;
                }
                UIHelpers.flashBtn(btn, `${i+1}/${maxSend}`, "#ff9600", null, 0);
                if (!(await sendExpoAPI(state))) {
                    fullSuccess = false;
                    UIHelpers.flashBtn(btn, "ERR!", "#b41414");
                    setTimeout(() => location.reload(), 1500);
                    return;
                }
                await Helpers.sleep(Math.random() * 1500 + 1500);
            }
            if (fullSuccess) UIHelpers.flashBtn(btn, "OK!", "#1fb37d");
            setTimeout(() => location.reload(), 1000);
        }
        if (Helpers.isPage('fleetdispatch')) setTimeout(injectUI, 500);
    }

    // --- MODULE: QUICK FLEETSAVE (FSScript) ---
    function FSScript() {
        const FS_BTN_ID = "customFSBtn",
            FS_SECBTN_ID = "customFSSecBtn",
            FS_PANEL_ID = "fsPanel";

        let rawConf = localStorage.getItem(PREF + "fsConfig");
        if (!rawConf) localStorage.setItem(PREF + "fsConfig", JSON.stringify({
            h: 8,
            m: 0,
            mission: "6"
        }));
        else {
            let p = JSON.parse(rawConf);
            if (p.time !== undefined) {
                p.h = Math.floor(p.time);
                p.m = Math.round((p.time - p.h) * 60);
                delete p.time;
            }
            localStorage.setItem(PREF + "fsConfig", JSON.stringify(p));
        }

        document.addEventListener('focusin', (e) => {
            if (e.target && e.target.id === 'fsTimeInput') e.target.select();
        });
        document.addEventListener('input', (e) => {
            if (e.target?.id === 'fsTimeInput') {
                let d = e.target.value.replace(/\D/g, '').padStart(4, '0').slice(-4);
                let f = d.slice(0, 2) + ":" + d.slice(2, 4);
                if (e.target.value !== f) e.target.value = f;
            }
        });

        function injectUI() {
            if (!document.querySelector("#menuTable") || document.querySelector("#" + FS_BTN_ID)) return;
            const li = document.createElement("li"),
                sBtn = document.createElement("span");
            sBtn.id = FS_SECBTN_ID;
            sBtn.className = "menu_icon";
            sBtn.innerHTML = `<a class="tooltipRight js_hideTipOnMobile"><div class="menuImage fleetmovement ipiHintable" style="filter: hue-rotate(90deg);" data="Quick FS!"></div></a>`;
            li.appendChild(sBtn);
            const a = document.createElement("a");
            a.id = FS_BTN_ID;
            a.className = "menubutton";
            a.href = "javascript:void(0);";
            a.innerHTML = `<span class="textlabel">FS Settings</span>`;
            li.appendChild(a);
            document.querySelector("#menuTable").appendChild(li);

            const p = document.createElement("div");
            p.id = FS_PANEL_ID;
            let c = JSON.parse(localStorage.getItem(PREF + "fsConfig")),
                pad = n => n.toString().padStart(2, '0');
            
            if (c.mission === '8') {
                c.mission = '6';
                localStorage.setItem(PREF + "fsConfig", JSON.stringify(c));
            }
            
            p.innerHTML = `
                <h3>Quick Fleetsave</h3>
                <div class="fs-row"><label>Target Time:</label><input type="tel" id="fsTimeInput" class="fs-input" value="${pad(c.h)}:${pad(c.m)}" maxlength="6"></div>
                <div class="fs-row" style="justify-content: center; flex-direction: row; gap: 6px; margin-top: 15px;">
                    <label style="margin-bottom: 2px;">Mission:</label>
                    <div class="fs-mission-container" id="fsMissionSelector" data-selected="${c.mission}">
                        <div class="fs-mission-btn fs-icon-spy tooltip ${c.mission === '6' ? 'selected' : ''}" data-mission="6" title="Espionage (Slot 16)"></div>
                        <div class="fs-mission-btn fs-icon-colo tooltip ${c.mission === '7' ? 'selected' : ''}" data-mission="7" title="Colonization"></div>
                    </div>
                </div><a id="fsSaveBtn" class="btn_blue" style="display:block; text-align:center; margin-top:8px;">Save Config!</a>`;
            document.body.appendChild(p);
        }

        document.addEventListener('click', async (e) => {
            const a = e.target.closest("#" + FS_BTN_ID),
                aBtn = e.target.closest("#" + FS_SECBTN_ID),
                sBtn = e.target.closest("#fsSaveBtn"),
                mBtn = e.target.closest(".fs-mission-btn"),
                p = document.getElementById(FS_PANEL_ID);

            if (a) {
                e.preventDefault();
                let x = document.getElementById("customPanel");
                if (x) x.style.display = 'none';
                if (p) p.style.display = p.style.display === "block" ? "none" : (p.style.top = a.getBoundingClientRect().top + "px", p.style.left = (a.getBoundingClientRect().right + 5) + "px", "block");
            }
            if (mBtn) {
                e.preventDefault();
                document.querySelectorAll(".fs-mission-btn").forEach(b => b.classList.remove("selected"));
                mBtn.classList.add("selected");
                document.getElementById("fsMissionSelector").dataset.selected = mBtn.dataset.mission;
            }
            if (sBtn) {
                e.preventDefault();
                let pts = (document.getElementById("fsTimeInput").value || "00:00").split(":");
                let tm = (parseInt(pts[0], 10) || 0) * 60 + (parseInt(pts[1], 10) || 0);
                if (isNaN(tm)) tm = 0;
                let fh = Math.min(99, Math.floor(tm / 60)),
                    fm = tm % 60;
                document.getElementById("fsTimeInput").value = fh.toString().padStart(2, '0') + ":" + fm.toString().padStart(2, '0');
                localStorage.setItem(PREF + "fsConfig", JSON.stringify({
                    h: fh,
                    m: fm,
                    mission: document.getElementById("fsMissionSelector").dataset.selected
                }));
                sBtn.innerHTML = `<span style="color: #1fb37d;">Saved!</span>`;
                setTimeout(() => sBtn.textContent = "Save Config!", 1500);
            }
            if (p && p.style.display === 'block' && !p.contains(e.target) && (!a || !a.contains(e.target))) p.style.display = 'none';

            if (aBtn) {
                e.preventDefault();
                
                const resetHtml = `<a class="tooltipRight js_hideTipOnMobile"><div class="menuImage fleetmovement ipiHintable" style="filter: hue-rotate(90deg);" data="Quick FS!"></div></a>`;
                
                let conf = JSON.parse(localStorage.getItem(PREF + "fsConfig"));

                UIHelpers.flashBtn(aBtn, "LOAD", "#ff9600");
                let state = await CoreAPI.getFleetState();
                if (!state.token || Object.keys(state.ships).length === 0) {
                    Helpers.notifyNative("Fleetsave canceled: Failed to sync background fleet data.", true);
                    UIHelpers.flashBtn(aBtn, "ERR!", "#b41414", resetHtml);
                    return;
                }

                let getShip = id => state.ships[id] || 0;
                let isValid = true,
                    eName = "";
                
                if (conf.mission === '7' && getShip(208) <= 0) {
                    isValid = false;
                    eName = "Colony Ship";
                } else if (conf.mission === '6' && getShip(210) <= 0) {
                    isValid = false;
                    eName = "Espionage Probe";
                }

                if (!isValid) {
                    Helpers.notifyNative(`Fleetsave canceled: Missing required ship (${eName}).`, true);
                    UIHelpers.flashBtn(aBtn, "ERR!", "#b41414", resetHtml);
                    return;
                }

                UIHelpers.flashBtn(aBtn, "CALC", "#ff9600");
                const cMatch = document.querySelector('meta[name="ogame-planet-coordinates"]')?.content.match(/\d+/g);
                if (!cMatch) {
                    UIHelpers.flashBtn(aBtn, "ERR!", "#b41414", resetHtml);
                    return;
                }
                let origin = {
                    g: parseInt(cMatch[0], 10),
                    s: parseInt(cMatch[1], 10),
                    p: parseInt(cMatch[2], 10)
                };

                let slowSpd = Infinity,
                    pShips = {},
                    tShips = 0;
                shipNames.forEach(s => {
                    let c = getShip(s[1]);
                    if (c > 0) {
                        pShips[s[1]] = c;
                        tShips += c;
                        let sp = AstroMath.getShipSpeed(s[1]);
                        if (sp > 0 && sp < slowSpd) slowSpd = sp;
                    }
                });
                if (tShips === 0) {
                    Helpers.notifyNative("Fleetsave canceled: No ships on planet.", true);
                    UIHelpers.flashBtn(aBtn, "ERR!", "#b41414", resetHtml);
                    return;
                }

                let targetData = AstroMath.calculateFS((conf.h * 3600) + (conf.m * 60), origin, slowSpd, conf.mission);

                const cargoCap = AstroMath.calcStorageSpace(pShips);
                const { metal, crystal, deuterium } = AstroMath.getMaxRes(cargoCap);

                let plObj = {
                    galaxy: targetData.g,
                    system: targetData.s,
                    position: targetData.p,
                    type: targetData.type,
                    metal: metal,
                    crystal: crystal,
                    deuterium: deuterium,
                    food: 0,
                    prioMetal: 1,
                    prioCrystal: 2,
                    prioDeuterium: 3,
                    prioFood: 4,
                    mission: conf.mission,
                    speed: targetData.speed / 10,
                    retreatAfterDefenderRetreat: 0,
                    lootFoodOnAttack: 0,
                    union: 0,
                    holdingtime: 0
                };
                for (let id in pShips) plObj[`am${id}`] = pShips[id];

                try {
                    let data = await CoreAPI.dispatchFleet(plObj);
                    if (data.success) {
                        Helpers.notifyNative(`Fleet dispatched to [${targetData.g}:${targetData.s}:${targetData.p}] at ${targetData.speed}% speed.`, false);
                        UIHelpers.flashBtn(aBtn, "OK!", "#1fb37d");
                        setTimeout(() => location.reload(), 1500);
                    } else {
                        Helpers.notifyNative(`Fleetsave failed: ${(data.errors?.[0]?.message || "Server rejected request.")}`, true);
                        UIHelpers.flashBtn(aBtn, "ERR!", "#b41414", resetHtml);
                    }
                } catch (err) {
                    Helpers.notifyNative("Fleetsave failed: Network error.", true);
                    UIHelpers.flashBtn(aBtn, "ERR!", "#b41414", resetHtml);
                }
            }
        }, true);
        setTimeout(injectUI, 500);
    }

    // --- MODULE: AUCTION (AuctionScript) ---
    function AuctionScript() {
        let uiNodes = null;

        function createUI() {
            let container = document.getElementById("custom-auction-panel");
            if (!container) {
                container = Object.assign(document.createElement("div"), {
                    id: "custom-auction-panel",
                    innerHTML: `<img id="auction-img" src="" title=""><div class="auction-info-col"><div class="auction-title">AUCTION</div><div id="auction-time">Fetching...</div><div id="auction-bid" class="auction-bid-text">-</div></div>`
                });
                document.body.appendChild(container);
                container.addEventListener("click", () => window.location.href = "/game/index.php?page=ingame&component=traderOverview#animation=false&page=traderAuctioneer");
            }
            return {
                img: document.getElementById("auction-img"),
                time: document.getElementById("auction-time"),
                bid: document.getElementById("auction-bid")
            };
        }

        async function fetchAuction() {
            try {
                let html = await (await fetch("/game/index.php?page=ingame&component=traderAuctioneer", {
                    credentials: 'include'
                })).text();
                let doc = new DOMParser().parseFromString(html, "text/html"),
                    rawT = doc.querySelector('.auction_info')?.textContent.trim() || "";
                GameState.auction.currentSum = parseInt((doc.querySelector('.currentSum')?.textContent.trim() || "0").replace(/\D/g, ''), 10) || 0;

                let imgN = doc.querySelector('img[src*="item-images"], img[src*="/items/"], .auction_item img');
                if (imgN && imgN.hasAttribute('src')) {
                    GameState.auction.imageSrc = imgN.getAttribute('src');
                    GameState.auction.itemName = imgN.getAttribute('alt') || imgN.getAttribute('title') || "Unknown Item";
                } else {
                    let bgM = (doc.querySelector('.auction_item, .image_120x120, .item_icon')?.getAttribute('style') || "").match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
                    if (bgM) GameState.auction.imageSrc = bgM[1];
                }
                if (!GameState.auction.imageSrc) {
                    let rm = html.match(/src=["']([^"']*(?:\/items\/|\/item-images\/)[^"']*\.(?:png|jpg|gif))["']/i);
                    if (rm) GameState.auction.imageSrc = rm[1];
                }
                if (GameState.auction.imageSrc) GameState.auction.imageSrc = GameState.auction.imageSrc.startsWith('//') ? 'https:' + GameState.auction.imageSrc : (GameState.auction.imageSrc.startsWith('/') ? gameWindow.location.origin + GameState.auction.imageSrc : GameState.auction.imageSrc);

                if (doc.querySelector('.noAuctionOverlay')?.style.display !== "none") {
                    let m = rawT.match(/\d+/);
                    if (m) GameState.auction.shadowNextAuction = Date.now() + (parseInt(m[0], 10) * 1000);
                    GameState.auction.timeText = "Waiting";
                    GameState.auction.shadowEndTime = 0;
                } else {
                    let m = rawT.match(/\d+/),
                        tTxt = m ? `Aprox. ${m[0]}m` : rawT;
                    if (tTxt.includes("Aprox. 5m") && GameState.auction.timeText !== tTxt) GameState.auction.shadowEndTime = Date.now() + 300000;
                    else if (!tTxt.includes("Aprox. 5m")) GameState.auction.shadowEndTime = 0;
                    GameState.auction.timeText = tTxt;
                    GameState.auction.shadowNextAuction = 0;
                }
                localStorage.setItem(PREF + "AuctionState", JSON.stringify(GameState.auction));
            } catch (e) {
                if (!(e.name === 'TypeError' && e.message.includes('NetworkError'))) console.error("Auction fetch error", e);
            }
        }

        function tick() {
            if (!uiNodes) uiNodes = createUI();
            let now = Date.now();
            if (now >= GameState.auction.nextFetch) {
                fetchAuction();
                if (GameState.auction.shadowNextAuction > now) GameState.auction.nextFetch = now + Math.max(10000, (GameState.auction.shadowNextAuction - now) - 30000);
                else if (GameState.auction.shadowEndTime > 0) GameState.auction.nextFetch = now + (Math.random() * 10000 + 30000);
                else GameState.auction.nextFetch = now + (Math.random() * 60000 + 120000);
            }
            uiNodes.bid.textContent = Helpers.compactNumber.format(GameState.auction.currentSum);
            let wait = GameState.auction.shadowNextAuction > now;
            if (GameState.auction.imageSrc && !wait) {
                if (!uiNodes.img.src.includes(GameState.auction.imageSrc.split('/').pop())) {
                    uiNodes.img.src = GameState.auction.imageSrc;
                    uiNodes.img.style.display = "block";
                }
                uiNodes.img.title = GameState.auction.itemName || "";
            } else {
                uiNodes.img.style.display = "none";
                uiNodes.img.title = "";
            }

            if (wait) {
                let s = Math.floor((GameState.auction.shadowNextAuction - now) / 1000);
                uiNodes.time.textContent = `Waiting, ${Helpers.convSecToTime(s)}`;
                uiNodes.time.style.color = "#2389d7";
                uiNodes.bid.textContent = "-";
            } else if (GameState.auction.shadowEndTime > 0 && now < GameState.auction.shadowEndTime) {
                let s = Math.max(0, Math.floor((GameState.auction.shadowEndTime - now) / 1000));
                uiNodes.time.textContent = `< 0${Math.floor(s / 60)}m ${s % 60}s`;
                uiNodes.time.style.color = "#d43635";
            } else {
                uiNodes.time.textContent = GameState.auction.timeText;
                uiNodes.time.style.color = "#999";
            }
        }
        MasterClockQueue.push(tick);
    }

    // --- MODULE: UTILITIES (UtilitiesScript) ---
    function UtilitiesScript() {
        function setupPlanetList() {
            let pList = document.querySelector("#planetList");
            if (pList && !pList.classList.contains("custom-ready")) pList.classList.add("custom-ready");
            document.querySelectorAll(".planet-name").forEach(pn => {
                let p = pn.closest('.smallplanet');
                if (!p) return;
                let id = p.id.split("-")[1];
                if (!document.getElementById("resTable-" + id)) {
                    let sib = pn.previousElementSibling;
                    if (sib && !sib.classList.contains("custom-mines-table") && !sib.classList.contains("custom-res-table")) sib.append(pn);
                    GameState.UINodes[id] = {
                        mines: Object.assign(document.createElement("div"), {
                            id: "minesTable-" + id,
                            className: "custom-mines-table",
                            innerHTML: `<span class="res-m">-</span><span class="res-c">-</span><span class="res-d">-</span>`
                        }),
                        res: Object.assign(document.createElement("div"), {
                            id: "resTable-" + id,
                            className: "custom-res-table",
                            innerHTML: `<span class="res-m">0</span><span class="res-c">0</span><span class="res-d">0</span>`
                        })
                    };
                    let tw = pn.parentElement;
                    if (tw) {
                        tw.append(GameState.UINodes[id].mines);
                        tw.append(GameState.UINodes[id].res);
                    }
                }
            });
        }

        function observePlanetList() {
            let pList = document.querySelector("#planetList");
            if (!pList || !pList.parentNode) return;
            
            let timer;
            new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    let c = document.querySelector("#planetList");
                    if (c && !c.classList.contains("custom-ready")) {
                        setupPlanetList();
                    }
                }, 50);
            }).observe(pList.parentNode, { 
                childList: true, 
                subtree: true, 
                attributes: true, 
                attributeFilter: ['class'] 
            });
        }

        function updateValues() {
            let input = document.querySelector('#build_amount'),
                amt = input ? parseInt(input.value) || 1 : 1;
            let eng = document.querySelector(".energy_production");
            if (eng && input) {
                let b = eng.children[1].children[0];
                if (b && b.dataset.value) b.textContent = "(+" + (b.dataset.value * amt) + ")";
            }
            let tEl = document.querySelector("time.build_duration") || document.querySelector(".build_duration time") || document.querySelector("time[datetime]");
            if (tEl) {
                if (!tEl.dataset.baseSeconds) tEl.dataset.baseSeconds = Helpers.parseISO8601Duration(tEl.getAttribute("datetime"));
                let bs = parseInt(tEl.dataset.baseSeconds, 10);
                if (bs > 0) {
                    tEl.textContent = Helpers.convSecToTime(bs * amt);
                    tEl.style.color = amt > 1 ? "#ff9600" : "";
                }
            }
        }

        function handleEnergy() {
            let e = document.querySelector(".additional_energy_consumption"),
                ce = document.querySelector("#resources_energy");
            if (!e || !ce) return;
            let span = document.querySelector("#bonusEnergy"),
                miss = ce.dataset.raw - e.children[1].dataset.value;
            if (!span) {
                span = Object.assign(document.createElement("span"), {
                    id: "bonusEnergy",
                    className: "bonus",
                    textContent: "(" + ((miss > 0) ? ("+" + miss) : miss) + ")",
                    style: (miss < 0) ? "color: #D43635; font-weight: bold;" : "font-weight: bold;"
                });
                e.appendChild(span);
            }
        }

        function waitForDrawer() {
            new MutationObserver(muts => {
                for (let m of muts) {
                    if (m.addedNodes.length) {
                        for (let n of m.addedNodes) {
                            if (n.id === "technologydetails" || (n.querySelector && n.querySelector(`#technologydetails`))) handleEnergy();
                        }
                    }
                }
            }).observe(document.querySelector('#inhalt') || document.body, {
                childList: true,
                subtree: true
            });
        }

        function keepAlive() {
            let last = Date.now(),
                det = false,
                update = () => {
                    if (det) return;
                    last = Date.now();
                    det = true;
                    setTimeout(() => det = false, 5000);
                };
            ['mousemove', 'keydown', 'click', 'touchstart'].forEach(e => document.addEventListener(e, update));
            MasterClockQueue.push(() => {
                if (Date.now() - last > 50 * 60 * 1000 + (Math.random() * 300000)) {
                    console.log("[.] INFO: Keep-Alive Ping.");
                    fetch("/game/index.php?page=ingame&component=overview", {
                        credentials: 'include'
                    }).then(r => {
                        if (r.ok) last = Date.now();
                    }).catch(e => console.warn("Ping fail", e));
                }
            });
        }
        if (Helpers.isPage('shipyard') || Helpers.isPage('supplies')) document.addEventListener('input', updateValues);
        keepAlive();
        setupPlanetList();
        observePlanetList();
        waitForDrawer();
        MasterClockQueue.push(setupPlanetList);
    }

    // --- MODULE: KEYBINDS (KeybindsScript) ---
    function KeybindsScript() {
        document.addEventListener('keydown', e => {
            const isT = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable,
                isA = Helpers.isPage('traderAuctioneer'),
                isF = Helpers.isPage('fleetdispatch');
                
            if (e.key === Config.keybinds.sendExpos && isF && !isT) Helpers.simulateClick(document.querySelector('#customExpoSecBtn'));
            if (e.key === Config.keybinds.upgradeItem && !isT) {
                let btn = document.querySelector(".upgrade") || document.querySelector(".pay");
                if (btn && !btn.disabled) Helpers.simulateClick(btn);
            }
            if (e.key === Config.keybinds.refreshPage && !isT) location.reload();
            if (e.key === Config.keybinds.clearBids && isA && !isT) document.querySelectorAll(".resourceAmount").forEach(b => Helpers.typeValue(b, 0));
            if (Config.keybinds.maxBids.includes(e.key) && isA && !isT) {
                let idx = Config.keybinds.maxBids.indexOf(e.key);
                Helpers.simulateClick(document.querySelector([".js_sliderMetalMax", ".js_sliderCrystalMax", ".js_sliderDeuteriumMax"][idx]));
            }
            if (Config.keybinds.smallBids.includes(e.key) && isA && !isT) {
                let idx = Config.keybinds.smallBids.indexOf(e.key);
                Helpers.simulateClick(document.querySelector([".js_sliderMetalMore", ".js_sliderCrystalMore", ".js_sliderDeuteriumMore"][idx]));
            }
        });

        MasterClockQueue.push(() => {
            if (!Helpers.isPage('traderAuctioneer')) return;
            const h = [{
                s: ".js_sliderMetalMax",
                k: Config.keybinds.maxBids[0]
            }, {
                s: ".js_sliderCrystalMax",
                k: Config.keybinds.maxBids[1]
            }, {
                s: ".js_sliderDeuteriumMax",
                k: Config.keybinds.maxBids[2]
            }, {
                s: ".js_sliderMetalMore",
                k: Config.keybinds.smallBids[0]
            }, {
                s: ".js_sliderCrystalMore",
                k: Config.keybinds.smallBids[1]
            }, {
                s: ".js_sliderDeuteriumMore",
                k: Config.keybinds.smallBids[2]
            }];
            h.forEach(x => {
                let el = document.querySelector(x.s)?.parentElement;
                if (el && !el.querySelector('.custom-keybind-hint')) {
                    if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';
                    el.appendChild(Object.assign(document.createElement("div"), {
                        className: "custom-keybind-hint",
                        textContent: x.k
                    }));
                }
            });
            document.querySelectorAll(".resourceAmount").forEach(inEl => {
                let w = inEl.parentElement;
                if (w && !w.querySelector('.custom-keybind-hint')) {
                    if (window.getComputedStyle(w).position === 'static') w.style.position = 'relative';
                    w.appendChild(Object.assign(document.createElement("div"), {
                        className: "custom-keybind-hint",
                        textContent: Config.keybinds.clearBids,
                        style: "background-color:#d43635; color:white;"
                    }));
                }
            });
        });
    }

    // --- MAIN ---
    function Main() {
        function BootSequence() {
            let pid = document.querySelector('meta[name="ogame-planet-id"]');
            if (pid) GameState.currentPlanetID = pid.content;
            let stg = localStorage.getItem(PREF + "OgameSettings");
            if (stg) Object.assign(GameState.settings, JSON.parse(stg));
            GameState.empireData = JSON.parse(localStorage.getItem(PREF + "EmpireEconomy") || "{}");
            let auc = localStorage.getItem(PREF + "AuctionState");
            if (auc) {
                GameState.auction = JSON.parse(auc);
                GameState.auction.nextFetch = 0;
            }

            AlertsScript();
            ResourcesScript();
            ResearchScript();
            ServerDataScript();
            ExpoScript();
            FSScript();
            UtilitiesScript();
            AuctionScript();
            KeybindsScript();

            setInterval(() => {
                for (let i = 0; i < MasterClockQueue.length; i++) {
                    try {
                        MasterClockQueue[i]();
                    } catch (err) {
                        console.error(`[!] ERROR: Clock task ${i}:`, err);
                    }
                }
            }, 1000);
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', BootSequence);
        else BootSequence();
    }
    Main();

})();