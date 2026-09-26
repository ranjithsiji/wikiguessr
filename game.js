$(document).ready(function() {
    // Tracks item IDs seen across all games in this browser session to avoid repeats.
    const seenItems = new Set();

    // Pre-fetched location pool. Filled in the background while the player is guessing
    // so that the next round starts instantly without waiting on a SPARQL round-trip.
    const locationPool = {
        items: [],      // validated location objects ready to use
        filling: false, // true while a batch SPARQL request is in flight
        TARGET: 3,      // keep at least this many ready
        BATCH: 10       // candidates fetched per SPARQL request
    };
    let locationPoll = null; // active getNextLocation() wait-poll, if any

    // Game state
    const gameState = {
        currentLocation: null,
        userGuess: null,
        images: [],
        currentImageIndex: 0,
        score: 0,
        map: null,
        round: 1,
        maxRounds: 5,
        currentViewMode: 'gallery', // 'gallery' or 'slideshow'
        slideshowInterval: null,
        slideshowPaused: false,
        activeTab: 'images'         // 'images' or 'map'
    };

    // Hardcoded fallback pool — used only when the Wikidata pool is empty at round start.
    // Geographically diverse: spread across continents, mix of natural and urban.
    // Each entry uses a synthetic item ID so seenItems deduplication works normally.
    const FALLBACK_LOCATIONS = [
        { item: 'fallback:iguazu',       itemLabel: 'Iguazu Falls',            itemDescription: 'Waterfalls on the border of Argentina and Brazil', lat: -25.6953, lon: -54.4366 },
        { item: 'fallback:capetown',     itemLabel: 'Cape Town',               itemDescription: 'City at the southern tip of Africa', lat: -33.9249, lon: 18.4241 },
        { item: 'fallback:hokkaido',     itemLabel: 'Hokkaido',                itemDescription: 'Northernmost main island of Japan', lat: 43.2203, lon: 142.8635 },
        { item: 'fallback:patagonia',    itemLabel: 'Patagonia',               itemDescription: 'Vast wilderness region at the southern tip of South America', lat: -50.9423, lon: -72.9019 },
        { item: 'fallback:varanasi',     itemLabel: 'Varanasi',                itemDescription: 'Ancient city on the Ganges river in northern India', lat: 25.3176, lon: 82.9739 },
        { item: 'fallback:kilimanjaro',  itemLabel: 'Mount Kilimanjaro',       itemDescription: "Africa's highest peak in Tanzania", lat: -3.0674, lon: 37.3556 },
        { item: 'fallback:marrakech',    itemLabel: 'Marrakech',               itemDescription: 'Imperial city in Morocco at the foot of the Atlas Mountains', lat: 31.6295, lon: -7.9811 },
        { item: 'fallback:luangprabang', itemLabel: 'Luang Prabang',           itemDescription: 'Ancient royal capital on the Mekong River in Laos', lat: 19.8845, lon: 102.1347 },
        { item: 'fallback:georgia',      itemLabel: 'Kazbegi',                 itemDescription: 'Mountain town in the Greater Caucasus, Georgia', lat: 42.6512, lon: 44.6374 },
        { item: 'fallback:azores',       itemLabel: 'Azores',                  itemDescription: 'Volcanic archipelago in the mid-Atlantic', lat: 37.7412, lon: -25.6756 },
        { item: 'fallback:queenstown',   itemLabel: 'Queenstown',              itemDescription: 'Town on the shores of Lake Wakatipu, New Zealand', lat: -45.0312, lon: 168.6626 },
        { item: 'fallback:cappadocia',   itemLabel: 'Cappadocia',              itemDescription: 'Region in central Turkey known for its volcanic landscape', lat: 38.6431, lon: 34.8289 },
        { item: 'fallback:banff',        itemLabel: 'Banff National Park',     itemDescription: 'Mountain park in the Canadian Rockies', lat: 51.4968, lon: -115.9281 },
        { item: 'fallback:fjordnorway',  itemLabel: 'Geirangerfjord',          itemDescription: 'UNESCO-listed fjord in western Norway', lat: 62.1002, lon: 7.2059 },
        { item: 'fallback:zanzibar',     itemLabel: 'Zanzibar',                itemDescription: 'Coral island off the coast of Tanzania', lat: -6.1659, lon: 39.2026 },
        { item: 'fallback:antelope',     itemLabel: 'Antelope Canyon',         itemDescription: 'Slot canyon on Navajo land in Arizona, USA', lat: 36.8619, lon: -111.3743 },
        { item: 'fallback:kerala',       itemLabel: 'Kerala Backwaters',       itemDescription: 'Network of canals, lakes and lagoons in southern India', lat: 9.4981, lon: 76.3388 },
        { item: 'fallback:iceland',      itemLabel: 'Þingvellir',              itemDescription: 'Rift valley where the North American and Eurasian plates meet, Iceland', lat: 64.2559, lon: -21.1302 },
        { item: 'fallback:mekong',       itemLabel: 'Mekong Delta',            itemDescription: 'River delta in southern Vietnam', lat: 10.0452, lon: 105.7469 },
        { item: 'fallback:sahara',       itemLabel: 'Sahara Desert',           itemDescription: 'Vast hot desert spanning northern Africa', lat: 23.4162, lon: 25.6628 }
    ];

    // Pristine game-area markup, captured before the first round touches the DOM.
    // Reused verbatim when the player restarts, instead of duplicating the HTML here.
    const GAME_AREA_TEMPLATE = $('.game-area').html();

    initGame();

    // ---------------------------------------------------------------------------
    // Guided tour (first-time players)
    // ---------------------------------------------------------------------------

    const TOUR_KEY = 'wikiguessr_tour_done';

    // Each step highlights one element and explains it. `tab` forces the game
    // onto that panel first, so a step never points at something hidden behind
    // the other tab. A null element centres the popover (intro/outro steps).
    const TOUR_STEPS = [
        {
            el: null,
            title: 'Welcome to Wiki Guessr',
            body: 'You get a set of photos of a real place somewhere on Earth. Work out where they were taken, drop a pin on the map, and score points for getting close. Five rounds per game.'
        },
        {
            el: '#panelImages',
            tab: 'images',
            title: '1. Study the photos',
            body: 'Look for clues: landscape, architecture, road signs, vegetation, the language on any text. Tap a photo to see it full size.'
        },
        {
            el: '.image-nav',
            tab: 'images',
            title: 'Browse the photos',
            body: 'Step through the images here, or switch between grid and slideshow. In slideshow view you can swipe left and right, or use the arrows on the picture.'
        },
        {
            el: '#switchBtn',
            title: '2. Put the pin',
            body: 'When you have a guess, this opens the map. You can come back to the photos at any time — nothing is locked in yet.'
        },
        {
            el: '#panelMap',
            tab: 'map',
            title: 'Drop your pin',
            body: 'Click or tap anywhere on the map to place your pin. Click again somewhere else to move it.'
        },
        {
            el: '#guessBtn',
            title: '3. Make a guess',
            body: 'This submits your pin and ends the round. It stays greyed out until a pin is placed. The closer you are, the more points you score.'
        },
        {
            el: '.step-tabs',
            tab: 'images',
            title: 'Where you are',
            body: 'These three steps track the round. Step 3 turns green once your pin is down and you are ready to submit.'
        },
        {
            el: '.header-meter',
            title: 'Rounds and score',
            body: 'The dots show your progress: green for rounds played, blue for the current one. Your running score sits to the right.'
        },
        {
            el: null,
            title: 'That is everything',
            body: 'Good luck! You can reopen this walkthrough any time with the ? button in the header.'
        }
    ];

    const tour = { step: 0, active: false };

    function tourSeen() {
        try { return localStorage.getItem(TOUR_KEY) === '1'; } catch (e) { return true; }
    }

    function markTourSeen() {
        try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) {}
    }

    function startTour() {
        tour.step = 0;
        tour.active = true;
        $('#tour').addClass('active').attr('aria-hidden', 'false');
        showTourStep(0);
    }

    function endTour() {
        tour.active = false;
        markTourSeen();
        $('#tour').removeClass('active').attr('aria-hidden', 'true');
    }

    function showTourStep(i) {
        if (i < 0 || i >= TOUR_STEPS.length) return endTour();
        tour.step = i;
        const step = TOUR_STEPS[i];

        // Bring the right panel forward before measuring, or the target may be
        // the off-stage copy with a meaningless position.
        if (step.tab && gameState.activeTab !== step.tab) switchTab(step.tab);

        $('#tourProgress').text(`Step ${i + 1} of ${TOUR_STEPS.length}`);
        $('#tourTitle').text(step.title);
        $('#tourBody').text(step.body);
        $('#tourPrev').prop('disabled', i === 0);
        $('#tourNext').text(i === TOUR_STEPS.length - 1 ? 'Got it' : 'Next');
        $('#tourSkip').toggle(i < TOUR_STEPS.length - 1);

        // A tab switch changes layout, so measure only after the browser has
        // laid the new panel out — one frame is not always enough, since the
        // panel swap and the popover's own text change both reflow.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => positionTour(step));
        });
    }

    function positionTour(step) {
        const $spot = $('#tourSpotlight');
        const $pop = $('#tourPopover');
        const $arrow = $('#tourArrow');
        const $el = step.el ? $(step.el) : $();
        const margin = 8;

        if (!$el.length || !$el.is(':visible')) {
            // Centre the popover and shrink the spotlight to nothing.
            $spot.addClass('tour-centred').css({
                top: window.scrollY + window.innerHeight / 2,
                left: window.innerWidth / 2
            });
            $arrow.addClass('hidden');
            // outerWidth() reads 0 until the element has been laid out, which
            // would pin the popover to the left edge, so fall back to the
            // stylesheet width when the measurement is not ready yet.
            const w = $pop.outerWidth() || 310;
            const h = $pop.outerHeight() || 180;
            $pop.css({
                top: window.scrollY + Math.max(20, (window.innerHeight - h) / 2),
                left: Math.max(16, (window.innerWidth - w) / 2)
            });
            return;
        }

        const r = $el[0].getBoundingClientRect();
        const top = r.top + window.scrollY;
        const left = r.left + window.scrollX;

        $spot.removeClass('tour-centred').css({
            top: top - margin,
            left: left - margin,
            width: r.width + margin * 2,
            height: r.height + margin * 2
        });

        // Prefer below the target; flip above when there isn't room.
        const popH = $pop.outerHeight() || 180;
        const popW = $pop.outerWidth() || 310;
        const below = r.bottom + 14;
        const fitsBelow = below + popH < window.innerHeight;

        let popTop = fitsBelow ? below : r.top - popH - 14;
        popTop = Math.max(10, popTop) + window.scrollY;

        let popLeft = r.left + r.width / 2 - popW / 2;
        popLeft = Math.min(Math.max(12, popLeft), window.innerWidth - popW - 12) + window.scrollX;

        $pop.css({ top: popTop, left: popLeft });

        $arrow.removeClass('hidden top bottom').addClass(fitsBelow ? 'top' : 'bottom');
        const arrowLeft = Math.min(
            Math.max(14, r.left + r.width / 2 - popLeft + window.scrollX - 6),
            popW - 26
        );
        $arrow.css('left', arrowLeft);

        // Scroll the target into view if it sits outside the viewport.
        if (r.top < 0 || r.bottom > window.innerHeight) {
            window.scrollTo({
                top: top - window.innerHeight / 3,
                behavior: 'smooth'
            });
        }
    }

    function setupTourListeners() {
        $('#tourNext').on('click', () => showTourStep(tour.step + 1));
        $('#tourPrev').on('click', () => showTourStep(tour.step - 1));
        $('#tourSkip').on('click', endTour);
        $('#helpBtn').on('click', startTour);

        $(document).on('keydown.tour', function(e) {
            if (!tour.active) return;
            if (e.key === 'Escape')      endTour();
            else if (e.key === 'ArrowRight') showTourStep(tour.step + 1);
            else if (e.key === 'ArrowLeft')  showTourStep(tour.step - 1);
        });

        // Keep the highlight on target when the layout moves.
        let resizeTimer = null;
        $(window).on('resize.tour scroll.tour', function() {
            if (!tour.active) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => positionTour(TOUR_STEPS[tour.step]), 80);
        });
    }

    setupTourListeners();

    // First-time players get the walkthrough automatically. Deferred so it
    // measures the finished layout rather than the loading state.
    if (!tourSeen()) {
        setTimeout(function() {
            if (!tour.active) startTour();
        }, 600);
    }

    // ---------------------------------------------------------------------------
    // Theme (light / dark)
    // ---------------------------------------------------------------------------

    // Three states: no stored value means "follow the OS", while an explicit
    // 'light'/'dark' overrides it. The inline script in index.html applies the
    // stored value before first paint; this only handles toggling afterwards.
    const THEME_KEY = 'wikiguessr_theme';

    function storedTheme() {
        try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
    }

    function systemPrefersDark() {
        return window.matchMedia &&
               window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function activeTheme() {
        return storedTheme() || (systemPrefersDark() ? 'dark' : 'light');
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
        updateThemeToggle(theme);
    }

    // The icon shows what a click will switch *to*, which is the convention
    // players expect from a single-button toggle.
    function updateThemeToggle(theme) {
        const dark = theme === 'dark';
        $('#themeToggle')
            .attr('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode')
            .attr('title', dark ? 'Switch to light mode' : 'Switch to dark mode')
            .html(dark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>');
    }

    function initTheme() {
        updateThemeToggle(activeTheme());

        $('#themeToggle').on('click', function() {
            applyTheme(activeTheme() === 'dark' ? 'light' : 'dark');
        });

        // Follow the OS while the player has not made an explicit choice.
        if (window.matchMedia) {
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            const onChange = () => {
                if (!storedTheme()) updateThemeToggle(activeTheme());
            };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        }
    }

    initTheme();

    // ---------------------------------------------------------------------------
    // Score history (localStorage)
    // ---------------------------------------------------------------------------

    const SCORES_KEY = 'wikiguessr_scores';
    const MAX_SCORES = 20;

    function saveScore(score) {
        const history = loadScores();
        history.unshift({ score: score, date: Date.now(), rounds: gameState.maxRounds });
        if (history.length > MAX_SCORES) history.length = MAX_SCORES;
        try { localStorage.setItem(SCORES_KEY, JSON.stringify(history)); } catch(e) {}
    }

    function loadScores() {
        try { return JSON.parse(localStorage.getItem(SCORES_KEY) || '[]'); } catch(e) { return []; }
    }

    function clearScores() {
        try { localStorage.removeItem(SCORES_KEY); } catch(e) {}
    }

    function formatDate(ts) {
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function renderScoresPanel() {
        const history = loadScores();
        const $list = $('#scoresList').empty();

        if (history.length === 0) {
            $list.html('<p class="scores-empty">No games played yet.<br>Finish a game to record your score!</p>');
            return;
        }

        // Sort by score descending to assign medals, but display in chronological reverse order (already is)
        const sorted = history.slice().sort((a, b) => b.score - a.score);
        const topThree = sorted.slice(0, 3).map(e => e.date);
        const medals = ['🥇', '🥈', '🥉'];
        const medalClass = ['gold', 'silver', 'bronze'];

        history.forEach((entry, i) => {
            const rank = topThree.indexOf(entry.date);
            const medal = rank >= 0 ? medals[rank] : `#${i + 1}`;
            const cls = rank >= 0 ? medalClass[rank] : '';
            const $entry = $(`<div class="score-entry ${cls}"></div>`);
            $entry.append($('<div class="score-rank"></div>').text(medal));
            const $details = $('<div class="score-details"></div>');
            $details.append($('<div class="score-value"></div>').text(`${entry.score.toLocaleString()} pts`));
            $details.append($('<div class="score-date"></div>').text(formatDate(entry.date)));
            $entry.append($details);
            $list.append($entry);
        });
    }

    function openScoresPanel() {
        renderScoresPanel();
        $('#scoresPanel').addClass('open').attr('aria-hidden', 'false');
        $('#scoresOverlay').addClass('active');
    }

    function closeScoresPanel() {
        $('#scoresPanel').removeClass('open').attr('aria-hidden', 'true');
        $('#scoresOverlay').removeClass('active');
    }

    $('#scoresBtn').on('click', openScoresPanel);
    $('#scoresPanelClose').on('click', closeScoresPanel);
    $('#scoresOverlay').on('click', closeScoresPanel);
    $('#scoresClear').on('click', function() {
        if (confirm('Clear all score history?')) {
            clearScores();
            renderScoresPanel();
        }
    });

    // ---------------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------------

    function initGame() {
        gameState.score = 0;
        gameState.round = 1;
        gameState.currentLocation = null;
        gameState.userGuess = null;
        gameState.images = [];
        gameState.currentImageIndex = 0;
        gameState.currentViewMode = 'gallery';
        gameState.slideshowPaused = false;
        gameState.activeTab = 'images';

        stopSlideshow();
        $("#resultModal").removeClass('active');

        renderRoundDots();
        updateScoreDisplay();

        // Bind delegated event listeners ONCE before kicking off the first round.
        setupEventListeners();

        initMap();
        switchTab('images');
        startNewRound();
    }

    function initMap() {
        if (gameState.map) {
            gameState.map.remove();
        }

        gameState.map = L.map('map').setView([0, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(gameState.map);

        gameState.map.on('click', function(e) {
            if (gameState.userGuess) {
                gameState.map.removeLayer(gameState.userGuess);
            }
            gameState.userGuess = L.marker(e.latlng, {
                icon: L.divIcon({
                    className: 'guess-marker',
                    html: '<i class="fas fa-map-marker-alt" style="color: red; font-size: 24px;"></i>',
                    iconSize: [24, 24],
                    iconAnchor: [12, 24]
                })
            }).addTo(gameState.map);
            setPinPlaced(true);
        });
    }

    // ---------------------------------------------------------------------------
    // Tab panel (1 Images / 2 Map / 3 Guess)
    // ---------------------------------------------------------------------------

    // Show one stage panel and sync the tabs, the switch button and step 3.
    function switchTab(tab) {
        gameState.activeTab = tab;
        const onMap = tab === 'map';

        $('#panelImages').toggleClass('active', !onMap);
        $('#panelMap').toggleClass('active', onMap);

        $('#tabImages').toggleClass('active', !onMap).attr('aria-selected', String(!onMap));
        $('#tabMap').toggleClass('active', onMap).attr('aria-selected', String(onMap));

        // The switch button always offers the *other* panel.
        $('#switchBtnLabel').text(onMap ? 'Back to Images' : 'Put the Pin');
        $('#switchBtn i').attr('class', onMap ? 'fas fa-images' : 'fas fa-map-location-dot');

        if (onMap) {
            // Leaflet sizes itself on creation; the panel was off-stage then, so
            // re-measure now that it is visible or tiles/clicks land wrong.
            if (gameState.map) gameState.map.invalidateSize();
            stopSlideshow();
        } else if (gameState.currentViewMode === 'slideshow' &&
                   gameState.images.length > 1 &&
                   !gameState.slideshowPaused &&
                   $('#imageContainer .slideshow-container').length) {
            // Coming back to the images: resume the slideshow where it left off.
            // The DOM check skips this when the container is still loading/empty.
            startSlideshowTimer();
        }
    }

    // Single place that knows what "a pin is down" looks like across the UI.
    function setPinPlaced(placed) {
        $('#guessBtn').prop('disabled', !placed);
        $('#stepGuess').toggleClass('ready', placed);
        $('#stepGuessHint').text(placed ? 'Ready to submit' : 'Pin required');
        $('#mapHint').toggleClass('placed', placed)
            .find('span').text(placed
                ? 'Pin placed. Click elsewhere to move it, or make your guess.'
                : 'Click anywhere on the map to place your pin.');
        $('#mapHint i').attr('class', placed ? 'fas fa-map-pin' : 'fas fa-hand-pointer');
    }

    // One dot per round in the header: green = played, blue = current,
    // grey = not reached yet. Pass 'complete' to mark every round done.
    function renderRoundDots(complete) {
        const $dots = $('#roundDots').empty();
        for (let i = 1; i <= gameState.maxRounds; i++) {
            const $dot = $('<span class="round-dot"></span>');
            if (complete || i < gameState.round) {
                $dot.addClass('done');
            } else if (i === gameState.round) {
                $dot.addClass('active');
            }
            $dots.append($dot);
        }
        $('#roundDisplay').text(complete
            ? `${gameState.maxRounds}/${gameState.maxRounds}`
            : `${gameState.round}/${gameState.maxRounds}`);
    }

    function updateScoreDisplay() {
        $('#scoreDisplay').text(`${gameState.score.toLocaleString()} pts`);
    }

    function stopSlideshow() {
        if (gameState.slideshowInterval) {
            clearInterval(gameState.slideshowInterval);
            gameState.slideshowInterval = null;
        }
        gameState.slideshowPaused = false;
        $('.slideshow-progress-bar').css('animation', 'none');
    }

    // ---------------------------------------------------------------------------
    // Location pool — async pre-fetch
    // ---------------------------------------------------------------------------

    // Fetch a batch of SPARQL candidates and push valid, unseen ones into the pool.
    // Does nothing if a fill is already in flight or the pool is already at target.
    function refillLocationPool() {
        if (locationPool.filling || locationPool.items.length >= locationPool.TARGET) return;
        locationPool.filling = true;

        const offset = Math.floor(Math.random() * 500000);
        const query = `
            SELECT ?item ?itemLabel ?itemDescription ?lat ?lon WHERE {
                {
                    SELECT ?item ?lat ?lon
                    WHERE {
                        ?item wdt:P18 [] .
                        ?item p:P625 ?statement .
                        ?statement psv:P625 ?coords .
                        ?coords wikibase:geoLatitude ?lat .
                        ?coords wikibase:geoLongitude ?lon .
                        FILTER(ABS(?lat) < 70)
                    } LIMIT ${locationPool.BATCH} OFFSET ${offset}
                }
                SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
            }`;

        $.ajax({
            url: `proxy.php?endpoint=wikidata&q=${encodeURIComponent('query=' + encodeURIComponent(query) + '&format=json')}`,
            method: 'GET',
            dataType: 'json',
            success: function(data) {
                locationPool.filling = false;
                if (!data.results || !data.results.bindings.length) {
                    setTimeout(refillLocationPool, 2000);
                    return;
                }
                for (const result of data.results.bindings) {
                    const lat = parseFloat(result.lat.value);
                    const lon = parseFloat(result.lon.value);
                    const itemId = result.item.value;
                    if (isNaN(lat) || isNaN(lon)) continue;
                    if (seenItems.has(itemId)) continue;
                    locationPool.items.push({
                        item: itemId,
                        itemLabel: result.itemLabel ? result.itemLabel.value : 'Unknown Location',
                        itemDescription: result.itemDescription ? result.itemDescription.value : '',
                        lat: lat,
                        lon: lon
                    });
                }
                if (locationPool.items.length < locationPool.TARGET) {
                    setTimeout(refillLocationPool, 500);
                }
            },
            error: function() {
                locationPool.filling = false;
                setTimeout(refillLocationPool, 3000);
            }
        });
    }

    // Fallback locations already played are remembered in localStorage so a
    // page reload doesn't restart the list from the top (Iguazu every time).
    const USED_FALLBACKS_KEY = 'wikiguessr_used_fallbacks';

    function loadUsedFallbacks() {
        try { return new Set(JSON.parse(localStorage.getItem(USED_FALLBACKS_KEY) || '[]')); }
        catch (e) { return new Set(); }
    }

    function markFallbackUsed(item) {
        const used = loadUsedFallbacks();
        used.add(item);
        // All entries played — reset so the rotation starts over next time.
        if (used.size >= FALLBACK_LOCATIONS.length) used.clear();
        try { localStorage.setItem(USED_FALLBACKS_KEY, JSON.stringify([...used])); }
        catch (e) {}
    }

    // Pop from pool immediately if available; fall back to hardcoded list if Wikidata
    // pool is still empty (e.g. on first round before SPARQL returns); poll otherwise.
    function getNextLocation(onReady) {
        if (locationPool.items.length > 0) {
            const loc = locationPool.items.shift();
            seenItems.add(loc.item);
            refillLocationPool();
            onReady(loc);
            return;
        }

        // Wikidata pool empty — pick a RANDOM fallback not yet played this
        // session nor in previous sessions (localStorage), so the first round
        // varies between visits instead of always being the list's first entry.
        const usedFallbacks = loadUsedFallbacks();
        let candidates = FALLBACK_LOCATIONS.filter(
            loc => !seenItems.has(loc.item) && !usedFallbacks.has(loc.item)
        );
        // Every fallback used across sessions: allow ones unseen this session.
        if (candidates.length === 0) {
            candidates = FALLBACK_LOCATIONS.filter(loc => !seenItems.has(loc.item));
        }
        if (candidates.length > 0) {
            const fallback = candidates[Math.floor(Math.random() * candidates.length)];
            seenItems.add(fallback.item);
            markFallbackUsed(fallback.item);
            refillLocationPool();
            onReady(fallback);
            return;
        }

        // All fallbacks exhausted too — poll for the Wikidata pool to fill.
        // Clear any poll left over from a previous round so two polls never
        // race and deliver two locations for the same round.
        refillLocationPool();
        if (locationPoll) clearInterval(locationPoll);
        locationPoll = setInterval(function() {
            if (locationPool.items.length > 0) {
                clearInterval(locationPoll);
                locationPoll = null;
                const loc = locationPool.items.shift();
                seenItems.add(loc.item);
                refillLocationPool();
                onReady(loc);
            }
        }, 300);
    }

    // ---------------------------------------------------------------------------
    // Round management
    // ---------------------------------------------------------------------------

    // isRetry is set by the image-loading failure path, which re-enters this
    // function for the *same* round. A retry must not yank the player back to
    // the images tab or clear a pin they have already placed.
    function startNewRound(isRetry) {
        stopSlideshow();

        gameState.images = [];
        gameState.currentImageIndex = 0;

        if (!isRetry) {
            gameState.userGuess = null;

            gameState.map.eachLayer(layer => {
                if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                    gameState.map.removeLayer(layer);
                }
            });

            setPinPlaced(false);
            switchTab('images');
        }

        renderRoundDots();
        $("#imageCounter").text("Loading...");

        if (locationPool.items.length > 0) {
            showLoadingMessage("Loading images...");
        } else {
            showLoadingMessage("Finding an interesting location...");
        }

        getNextLocation(function(locationData) {
            gameState.currentLocation = {
                lat: locationData.lat,
                lon: locationData.lon,
                name: locationData.itemLabel,
                description: locationData.itemDescription,
                item: locationData.item
            };

            showLoadingMessage("Loading images from Wikimedia Commons...");

            getImagesFromCommons(
                gameState.currentLocation.lat,
                gameState.currentLocation.lon,
                function(images) {
                    gameState.images = images;
                    displayImage(0);
                },
                function() {
                    showLoadingMessage("Loading images from Wikidata...");
                    getImagesFromWikidata(
                        locationData.item,
                        function(images) {
                            if (images.length === 0) {
                                showError("No images found. Trying again...");
                                setTimeout(() => startNewRound(true), 1500);
                                return;
                            }
                            gameState.images = images;
                            displayImage(0);
                        },
                        function(error) {
                            showError("Failed to load images. Trying again...");
                            console.error("Image loading error:", error);
                            setTimeout(() => startNewRound(true), 1500);
                        }
                    );
                }
            );
        });
    }

    // ---------------------------------------------------------------------------
    // Image fetching
    // ---------------------------------------------------------------------------

    // Terms identifying imagery shot from orbit — excluded outright. Kept
    // multi-word/specific so ground-level photos are never caught by accident
    // (plain "iss" would match "Mississippi").
    const SPACE_TERMS = [
        'satellite image', 'satellite view', 'satellite photo', 'satellite picture',
        'from space', 'seen from orbit', 'landsat', 'sentinel-2', 'copernicus',
        'earth observatory', 'international space station', 'space station',
        'astronaut photograph', 'spot image', 'worldview-'
    ];

    // Terms whose presence in Commons metadata suggests geographic/landscape content.
    const GEO_TERMS = [
        'landscape', 'panorama', 'aerial', 'mountain', 'river', 'lake', 'coast',
        'valley', 'forest', 'desert', 'glacier', 'waterfall', 'canyon', 'plain',
        'island', 'bay', 'cape', 'beach', 'cliff', 'hill', 'volcano', 'geography',
        'natural', 'scenery', 'terrain', 'vegetation', 'wetland', 'estuary'
    ];

    function geoRelevanceScore(image) {
        const text = [image.title, image.description, image.categories].join(' ').toLowerCase();
        let score = 0;
        for (const term of GEO_TERMS) {
            if (text.includes(term)) score++;
        }
        return score;
    }

    function getImagesFromCommons(lat, lon, successCallback, errorCallback) {
        // 10 km radius, 50 candidates — wide enough to find landscape shots.
        const commonsParams = [
            'action=query&format=json',
            '&generator=geosearch',
            '&ggsprimary=all&ggsnamespace=6',
            '&ggsradius=10000',
            `&ggscoord=${lat}|${lon}`,
            '&ggslimit=50',
            '&prop=imageinfo',
            '&iiprop=url|extmetadata|mediatype',
            '&iiurlwidth=800'
        ].join('');

        $.ajax({
            url: `proxy.php?endpoint=commons&q=${encodeURIComponent(commonsParams)}`,
            dataType: 'json',
            success: function(data) {
                if (!data.query || !data.query.pages) {
                    errorCallback();
                    return;
                }

                const candidates = [];
                for (const pageId in data.query.pages) {
                    const page = data.query.pages[pageId];
                    if (!page.imageinfo || !page.imageinfo[0]) continue;

                    const info = page.imageinfo[0];

                    // Skip non-photographic files (SVG, PDF, audio, video, etc.)
                    if (info.mediatype && info.mediatype !== 'BITMAP') continue;

                    const metadata = info.extmetadata || {};
                    const categories = metadata.Categories ? metadata.Categories.value : '';
                    const description = metadata.ImageDescription ? metadata.ImageDescription.value : '';
                    const lowerCats = categories.toLowerCase();

                    // Skip portraits, logos, flags — not useful for guessing geography.
                    if (lowerCats.includes('portrait') || lowerCats.includes('logo') ||
                        lowerCats.includes('coat of arms') || lowerCats.includes('flag of')) {
                        continue;
                    }

                    // Skip photos taken from space (satellite/ISS imagery) — they
                    // show the location from orbit, not what it looks like on the ground.
                    const searchText = `${page.title} ${description} ${categories}`.toLowerCase();
                    if (SPACE_TERMS.some(term => searchText.includes(term))) continue;

                    candidates.push({
                        url: info.url,
                        thumbUrl: info.thumburl || info.url,
                        title: page.title.replace('File:', ''),
                        description: description,
                        license: metadata.LicenseShortName ? metadata.LicenseShortName.value : '',
                        categories: categories
                    });
                }

                if (candidates.length === 0) {
                    errorCallback();
                    return;
                }

                // Sort by geographic relevance, take top 20. Score each image
                // once up front — the sort comparator would otherwise recompute
                // the keyword scan O(n log n) times.
                candidates.forEach(c => { c.geoScore = geoRelevanceScore(c); });
                candidates.sort((a, b) => b.geoScore - a.geoScore);
                successCallback(candidates.slice(0, 20));
            },
            error: function() {
                errorCallback();
            }
        });
    }

    function getImagesFromWikidata(itemId, successCallback, errorCallback) {
        const query = `SELECT ?image WHERE { <${itemId}> wdt:P18 ?image. } LIMIT 10`;
        $.ajax({
            url: `proxy.php?endpoint=wikidata&q=${encodeURIComponent('query=' + encodeURIComponent(query) + '&format=json')}`,
            dataType: 'json',
            success: function(data) {
                if (!data.results || !data.results.bindings || !data.results.bindings.length) {
                    successCallback([]);
                    return;
                }
                const images = data.results.bindings.map(item => ({
                    url: item.image.value.replace(/^http:/, 'https:'),
                    thumbUrl: item.image.value.replace(/^http:/, 'https:'),
                    title: item.image.value.split('/').pop(),
                    source: 'wikidata'
                }));
                successCallback(images);
            },
            error: function(xhr, status, error) {
                errorCallback(new Error(`SPARQL query failed: ${status}`));
            }
        });
    }

    // ---------------------------------------------------------------------------
    // Display
    // ---------------------------------------------------------------------------

    function showLoadingMessage(message) {
        $("#imageContainer")
            .addClass("loading")
            .html(`
                <div class="loading-content">
                    <i class="fa-solid fa-map-location-dot loading-spinner"></i>
                    <div>${message}</div>
                    <div class="loading-progress">
                        <div class="loading-progress-bar"></div>
                    </div>
                </div>
            `);
    }

    function updateImageCounter() {
        $("#imageCounter").text(`${gameState.currentImageIndex + 1} / ${gameState.images.length}`);
    }

    // Step forward (+1) or back (-1) through the images, wrapping at both ends.
    function navigateImage(delta) {
        const count = gameState.images.length;
        if (count === 0) return;
        gameState.currentImageIndex = (gameState.currentImageIndex + delta + count) % count;
        if (gameState.currentViewMode === 'slideshow') {
            updateSlideshowImage();
        } else {
            $("#imageContainer .gallery-thumbnail").removeClass('active')
                .eq(gameState.currentImageIndex).addClass('active');
        }
        updateImageCounter();
    }

    function displayImage(index) {
        if (gameState.images.length === 0) {
            $("#imageCounter").text("0 / 0");
            return;
        }
        gameState.currentImageIndex = Math.max(0, Math.min(index, gameState.images.length - 1));
        stopSlideshow();

        const $imageContainer = $("#imageContainer").removeClass("loading").empty();
        updateViewModeToggle();

        if (gameState.currentViewMode === 'slideshow') {
            setupSlideshow($imageContainer);
        } else {
            setupGallery($imageContainer);
        }
        updateImageCounter();
    }

    // Deliberately generic: Commons filenames usually contain the location name,
    // so echoing the title into alt text would reveal the answer whenever an
    // image fails to load. Only the license is surfaced to the player.
    const IMAGE_ALT = 'Photo of the mystery location';

    const SLIDESHOW_INTERVAL_MS = 4000;

    function setupSlideshow($container) {
        if (gameState.images.length === 0) {
            $container.html('<div class="no-images">No images available</div>');
            return;
        }

        const $slideshow = $('<div class="slideshow-container"></div>');
        const $slide = $('<div class="slideshow-slide"></div>');
        const currentImage = gameState.images[gameState.currentImageIndex];

        // Orientation class comes from the element's own load event — no second
        // detached Image() download. Handler bound before src so it always fires,
        // and persists for later src swaps by updateSlideshowImage().
        const $img = $('<img>')
            .attr('alt', IMAGE_ALT)
            .on('load', function() {
                $(this).removeClass('landscape portrait')
                    .addClass(this.naturalWidth > this.naturalHeight ? 'landscape' : 'portrait');
            })
            .attr('src', currentImage.thumbUrl || currentImage.url);

        if (currentImage.license) {
            $slide.append(
                $('<div class="image-attribution"></div>').text(`License: ${currentImage.license}`)
            );
        }

        // Progress bar strip at the bottom of the slide
        const $progressWrap = $('<div class="slideshow-progress"></div>');
        const $progressBar = $('<div class="slideshow-progress-bar"></div>');
        $progressWrap.append($progressBar);

        // Pause / resume button overlaid on the slide
        const $pauseBtn = $('<button class="slideshow-pause-btn" aria-label="Pause slideshow"></button>')
            .html('<i class="fas fa-pause"></i>');

        $slide.append($img);
        $slideshow.append($slide);
        $slideshow.append($progressWrap);
        $slideshow.append($pauseBtn);

        // Prev/next arrows overlaid on the image itself, for touch and mouse.
        if (gameState.images.length > 1) {
            $slideshow.append(
                $('<button class="slideshow-arrow slideshow-arrow-prev" aria-label="Previous image"></button>')
                    .html('<i class="fas fa-chevron-left"></i>'),
                $('<button class="slideshow-arrow slideshow-arrow-next" aria-label="Next image"></button>')
                    .html('<i class="fas fa-chevron-right"></i>')
            );
        }

        $container.append($slideshow);

        $pauseBtn.on('click', function() {
            if (gameState.slideshowPaused) {
                resumeSlideshow();
            } else {
                pauseSlideshow();
            }
        });

        attachSwipe($slideshow);

        if (gameState.images.length > 1) {
            startSlideshowTimer();
        }
    }

    // Manual navigation restarts the auto-advance timer so the player gets a
    // full interval to look at the image they just chose, rather than having it
    // flip away mid-glance.
    function slideshowStep(delta) {
        if (gameState.images.length < 2) return;
        navigateImage(delta);
        if (!gameState.slideshowPaused) {
            startSlideshowTimer();
        } else {
            restartProgressAnimation();
            pauseSlideshow();
        }
    }

    // Horizontal swipe over the slide. Uses Pointer Events, which cover touch,
    // pen and mouse in one path; the thresholds reject vertical scrolls and
    // stray taps so page scrolling still works over the image.
    const SWIPE_MIN_PX = 45;   // shorter drags are treated as a tap
    const SWIPE_MAX_OFF = 60;  // more vertical travel than this means scrolling

    function attachSwipe($el) {
        let startX = 0, startY = 0, tracking = false;

        $el.on('pointerdown', function(e) {
            if (e.button != null && e.button !== 0) return; // ignore right/middle click
            tracking = true;
            startX = e.clientX;
            startY = e.clientY;
        });

        $el.on('pointerup pointercancel', function(e) {
            if (!tracking) return;
            tracking = false;
            if (e.type === 'pointercancel') return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > SWIPE_MAX_OFF) return;

            // Swiping left moves forward, matching native photo viewers.
            slideshowStep(dx < 0 ? 1 : -1);
        });
    }

    // Restart the CSS progress animation from 0. Clearing the inline width also
    // undoes the freeze applied by pauseSlideshow().
    function restartProgressAnimation() {
        const $bar = $('.slideshow-progress-bar');
        if (!$bar.length) return;
        $bar.css({ animation: 'none', width: '' });
        void $bar[0].offsetWidth; // force reflow so the animation actually restarts
        $bar.css('animation', `slideshow-tick ${SLIDESHOW_INTERVAL_MS}ms linear forwards`);
    }

    function startSlideshowTimer() {
        if (gameState.slideshowInterval) clearInterval(gameState.slideshowInterval);
        restartProgressAnimation();
        gameState.slideshowInterval = setInterval(() => {
            gameState.currentImageIndex = (gameState.currentImageIndex + 1) % gameState.images.length;
            updateSlideshowImage();
            restartProgressAnimation();
        }, SLIDESHOW_INTERVAL_MS);
    }

    function pauseSlideshow() {
        if (!gameState.slideshowInterval) return;
        clearInterval(gameState.slideshowInterval);
        gameState.slideshowInterval = null;
        gameState.slideshowPaused = true;
        // Freeze the progress bar in place
        const $bar = $('.slideshow-progress-bar');
        const computed = window.getComputedStyle($bar[0]);
        $bar.css({ animation: 'none', width: computed.width });
        $('.slideshow-pause-btn').html('<i class="fas fa-play"></i>').attr('aria-label', 'Resume slideshow');
    }

    function resumeSlideshow() {
        if (!gameState.slideshowPaused || gameState.images.length <= 1) return;
        gameState.slideshowPaused = false;
        $('.slideshow-pause-btn').html('<i class="fas fa-pause"></i>').attr('aria-label', 'Pause slideshow');
        startSlideshowTimer();
    }

    function updateSlideshowImage() {
        if (gameState.images.length === 0) return;

        const currentImage = gameState.images[gameState.currentImageIndex];

        // The load handler bound in setupSlideshow() re-fires on src change and
        // reapplies the landscape/portrait class.
        $("#imageContainer .slideshow-container img").attr({
            src: currentImage.thumbUrl || currentImage.url,
            alt: IMAGE_ALT
        });

        const $attribution = $("#imageContainer .slideshow-container .image-attribution");
        if (currentImage.license) {
            $attribution.text(`License: ${currentImage.license}`).show();
        } else {
            $attribution.hide();
        }
        updateImageCounter();
    }

    function setupGallery($container) {
        if (gameState.images.length === 0) {
            $container.html('<div class="no-images">No images available</div>');
            return;
        }

        const $gallery = $('<div class="gallery-container"></div>');

        gameState.images.forEach((image, index) => {
            const $thumbnail = $('<div class="gallery-thumbnail"></div>')
                .toggleClass('active', index === gameState.currentImageIndex);

            const $img = $('<img>')
                .attr('src', image.thumbUrl || image.url)
                .attr('alt', IMAGE_ALT)
                .on('error', function() {
                    $(this).attr('src', image.url);
                });

            $thumbnail.append($img);
            // Tapping a thumbnail opens that image full-size in slideshow view,
            // where the arrows and swipe navigation live.
            $thumbnail.click(() => {
                gameState.currentViewMode = 'slideshow';
                displayImage(index);
            });
            $gallery.append($thumbnail);
        });

        $container.append($gallery);
    }

    function updateViewModeToggle() {
        const $toggle = $("#viewModeToggle");
        if (gameState.currentViewMode === 'slideshow') {
            $toggle.html('<i class="fas fa-th"></i> Gallery View');
        } else {
            $toggle.html('<i class="fas fa-film"></i> Slideshow View');
        }
    }

    // ---------------------------------------------------------------------------
    // Scoring
    // ---------------------------------------------------------------------------

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function calculateScore(distance) {
        const maxScore = 5000;
        const decayDistance = 2000;
        if (distance >= 20000) return 0;
        return Math.round(maxScore * Math.exp(-distance / decayDistance));
    }

    // ---------------------------------------------------------------------------
    // Guess submission & results
    // ---------------------------------------------------------------------------

    function submitGuess() {
        if (!gameState.userGuess || !gameState.currentLocation) return;

        stopSlideshow();
        $("#imageContainer").empty();

        // The result draws markers and the distance line on the map, so make
        // sure that is the panel the player is looking at.
        switchTab('map');
        setPinPlaced(false); // no second submission for this round

        const userLatLng = gameState.userGuess.getLatLng();
        const distance = calculateDistance(
            gameState.currentLocation.lat,
            gameState.currentLocation.lon,
            userLatLng.lat,
            userLatLng.lng
        );

        const score = calculateScore(distance);
        gameState.score += score;

        const actualMarker = L.marker(
            [gameState.currentLocation.lat, gameState.currentLocation.lon],
            {
                icon: L.divIcon({
                    className: 'actual-marker',
                    html: '<i class="fas fa-map-marker-alt" style="color: green; font-size: 24px;"></i>',
                    iconSize: [24, 24],
                    iconAnchor: [12, 24]
                })
            }
        ).addTo(gameState.map);

        // Build popup with .text() to avoid XSS from Wikidata strings.
        const $popupContent = $('<div style="text-align:center;"></div>');
        $('<h3 style="margin:0 0 5px 0;color:#2c3e50;"></h3>')
            .text(gameState.currentLocation.name)
            .appendTo($popupContent);
        $('<p style="margin:0;color:#7f8c8d;"></p>')
            .text(gameState.currentLocation.description || 'No description')
            .appendTo($popupContent);
        actualMarker.bindPopup($popupContent[0]).openPopup();

        // Antimeridian fix: if the two points are on opposite sides of the ±180°
        // seam, shifting one longitude by 360° gives the short great-circle path
        // that matches the actual (Haversine) distance rather than the long way
        // around the flat projection.
        const actualLon = gameState.currentLocation.lon;
        let guessLon = userLatLng.lng;
        if (Math.abs(guessLon - actualLon) > 180) {
            guessLon += (actualLon > guessLon ? 360 : -360);
        }

        L.polyline([
            [gameState.currentLocation.lat, actualLon],
            [userLatLng.lat, guessLon]
        ], { color: '#e74c3c', weight: 3, dashArray: '6, 6' }).addTo(gameState.map);

        gameState.map.fitBounds(L.latLngBounds([
            [gameState.currentLocation.lat, actualLon],
            [userLatLng.lat, guessLon]
        ]), { padding: [40, 40], maxZoom: 8 });

        showResults(distance, score);

        // Pre-fill pool while the player reads the results screen.
        refillLocationPool();
    }

    function showResults(distance, score) {
        // Populate result modal with .text() to avoid XSS from Wikidata strings.
        $("#resultDistance").empty();
        $('<h2></h2>').text(gameState.currentLocation.name || "Unknown Location")
            .appendTo("#resultDistance");

        // Format distance: metres if < 1 km, otherwise km with 1 decimal.
        const distanceText = distance < 1
            ? `${Math.round(distance * 1000)} m`
            : `${distance.toFixed(1)} km`;
        $('<div class="result-distance"></div>')
            .html(`Your guess was <strong>${distanceText}</strong> away`)
            .appendTo("#resultDistance");
        $('<div class="result-score"></div>')
            .text(`+${score.toLocaleString()} points`)
            .appendTo("#resultDistance");

        let message;
        if (distance < 1)         message = "🎯 Incredible! Are you a wizard?";
        else if (distance < 10)   message = "🔥 Amazing guess! You must know this place well.";
        else if (distance < 100)  message = "👏 Great job! You were very close.";
        else if (distance < 500)  message = "👍 Good guess! You were in the right area.";
        else if (distance < 2000) message = "🙂 Not bad! You were in the right region.";
        else                      message = "🌍 Better luck next time!";

        $("#resultMessage").text(message);
        $("#resultModal").addClass('active');
        updateScoreDisplay();
    }

    function showError(message) {
        $(".error-message").remove();
        $("<div>")
            .addClass("error-message")
            .text(message)
            .insertAfter("#imageContainer")
            .delay(1500)
            .fadeOut(500, function() { $(this).remove(); });
    }

    // ---------------------------------------------------------------------------
    // Event listeners
    // ---------------------------------------------------------------------------

    // Use event delegation off document so handlers survive DOM rebuilds
    // (game-area is replaced wholesale on Play Again — direct .click() bindings
    // accumulate across restarts and fire multiple times per click).
    function setupEventListeners() {
        const $doc = $(document);

        // Remove any prior delegated handlers in this namespace, then rebind once.
        $doc.off('.wikiguessr');

        $doc.on('click.wikiguessr', '#viewModeToggle', function() {
            stopSlideshow();
            gameState.currentViewMode = gameState.currentViewMode === 'slideshow' ? 'gallery' : 'slideshow';
            displayImage(gameState.currentImageIndex);
        });

        $doc.on('click.wikiguessr', '#prevBtn', () => navigateImage(-1));
        $doc.on('click.wikiguessr', '#nextBtn', () => navigateImage(1));

        $doc.on('click.wikiguessr', '.slideshow-arrow-prev', () => slideshowStep(-1));
        $doc.on('click.wikiguessr', '.slideshow-arrow-next', () => slideshowStep(1));

        $doc.on('click.wikiguessr', '#tabImages', () => switchTab('images'));
        $doc.on('click.wikiguessr', '#tabMap', () => switchTab('map'));

        // One button, two directions: to the map, or back to the images.
        $doc.on('click.wikiguessr', '#switchBtn', function() {
            switchTab(gameState.activeTab === 'map' ? 'images' : 'map');
        });

        $doc.on('click.wikiguessr', '#guessBtn', submitGuess);

        $doc.on('click.wikiguessr', '#nextRoundBtn', function() {
            $("#resultModal").removeClass('active');
            if (gameState.round < gameState.maxRounds) {
                gameState.round++;
                startNewRound();
            } else {
                endGame();
            }
        });

        // Game-over screen buttons (created dynamically by endGame).
        $doc.on('click.wikiguessr', '#restartBtn', function() {
            stopSlideshow();
            $('.game-area').html(GAME_AREA_TEMPLATE);
            initGame();
        });
        $doc.on('click.wikiguessr', '#endScoresBtn', openScoresPanel);
    }

    // ---------------------------------------------------------------------------
    // End game / restart
    // ---------------------------------------------------------------------------

    // Restart and View Scores clicks are handled by the delegated listeners
    // registered in setupEventListeners().
    function endGame() {
        saveScore(gameState.score);
        renderRoundDots(true);
        $(".game-area").html(`
            <div class="game-over-screen">
                <h2>🎉 Game Complete! 🎊</h2>
                <p>Your final score: <strong>${gameState.score.toLocaleString()}</strong></p>
                <button id="restartBtn" class="next-round-btn">Play Again</button>
                <button id="endScoresBtn" class="scores-header-btn" style="margin-top:10px">
                  <i class="fas fa-trophy"></i> View Scores
                </button>
            </div>
        `);

        // Keep filling the pool so the next game starts instantly.
        refillLocationPool();
    }
});
