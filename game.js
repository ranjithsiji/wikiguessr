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
        slideshowPaused: false
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

    initGame();

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

        updateProgressBar(0);
        $("#progressContainer").show();
        $("#scoreDisplay").text(`Score: ${gameState.score}`);
        $("#roundDisplay").text(`Round: ${gameState.round}/${gameState.maxRounds}`);

        initMap();
        startNewRound();
        setupEventListeners();
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
            $("#guessBtn").prop("disabled", false);
        });
    }

    function updateProgressBar(percentage) {
        const $progressBar = $('#progressBar');
        percentage = Math.max(0, Math.min(100, percentage));
        $progressBar.css('width', `${percentage}%`);
        if (percentage < 30) {
            $progressBar.css('background', 'linear-gradient(to right, #ed2213ff, #ff9800)');
        } else if (percentage < 70) {
            $progressBar.css('background', 'linear-gradient(to right, #ffb300ff, #baff3bff)');
        } else {
            $progressBar.css('background', 'linear-gradient(to right, #97d04cff, #5ea310ff)');
        }
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

        // Wikidata pool empty — try an unseen fallback location immediately.
        const fallback = FALLBACK_LOCATIONS.find(loc => !seenItems.has(loc.item));
        if (fallback) {
            seenItems.add(fallback.item);
            refillLocationPool();
            onReady(fallback);
            return;
        }

        // All fallbacks exhausted too — poll for the Wikidata pool to fill.
        refillLocationPool();
        const poll = setInterval(function() {
            if (locationPool.items.length > 0) {
                clearInterval(poll);
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

    function startNewRound() {
        stopSlideshow();

        gameState.userGuess = null;
        gameState.images = [];
        gameState.currentImageIndex = 0;

        gameState.map.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                gameState.map.removeLayer(layer);
            }
        });

        $("#guessBtn").prop("disabled", true);

        const progress = (gameState.round / gameState.maxRounds) * 100;
        updateProgressBar(progress);
        $("#roundDisplay").text(`Round: ${gameState.round}/${gameState.maxRounds}`);
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
                                setTimeout(startNewRound, 1500);
                                return;
                            }
                            gameState.images = images;
                            displayImage(0);
                        },
                        function(error) {
                            showError("Failed to load images. Trying again...");
                            console.error("Image loading error:", error);
                            setTimeout(startNewRound, 1500);
                        }
                    );
                }
            );
        });
    }

    // ---------------------------------------------------------------------------
    // Image fetching
    // ---------------------------------------------------------------------------

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
                    const lowerCats = categories.toLowerCase();

                    // Skip portraits, logos, flags — not useful for guessing geography.
                    if (lowerCats.includes('portrait') || lowerCats.includes('logo') ||
                        lowerCats.includes('coat of arms') || lowerCats.includes('flag of')) {
                        continue;
                    }

                    candidates.push({
                        url: info.url,
                        thumbUrl: info.thumburl || info.url,
                        title: page.title.replace('File:', ''),
                        description: metadata.ImageDescription ? metadata.ImageDescription.value : '',
                        license: metadata.LicenseShortName ? metadata.LicenseShortName.value : '',
                        categories: categories
                    });
                }

                if (candidates.length === 0) {
                    errorCallback();
                    return;
                }

                // Sort by geographic relevance, take top 20.
                candidates.sort((a, b) => geoRelevanceScore(b) - geoRelevanceScore(a));
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
        $("#imageCounter").text(`${gameState.currentImageIndex + 1} / ${gameState.images.length}`);
    }

    const SLIDESHOW_INTERVAL_MS = 4000;

    function setupSlideshow($container) {
        if (gameState.images.length === 0) {
            $container.html('<div class="no-images">No images available</div>');
            return;
        }

        const $slideshow = $('<div class="slideshow-container"></div>');
        const $slide = $('<div class="slideshow-slide"></div>');
        const currentImage = gameState.images[gameState.currentImageIndex];

        const $img = $('<img>')
            .attr('src', currentImage.thumbUrl || currentImage.url)
            .attr('alt', currentImage.title || 'Location image');

        const img = new Image();
        img.onload = function() {
            $img.addClass(this.width > this.height ? 'landscape' : 'portrait');
        };
        img.src = currentImage.thumbUrl || currentImage.url;

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
        $container.append($slideshow);

        $pauseBtn.on('click', function() {
            if (gameState.slideshowPaused) {
                resumeSlideshow();
            } else {
                pauseSlideshow();
            }
        });

        if (gameState.images.length > 1) {
            startSlideshowTimer();
        }
    }

    function startSlideshowTimer() {
        if (gameState.slideshowInterval) clearInterval(gameState.slideshowInterval);

        // Restart the CSS progress animation
        const $bar = $('.slideshow-progress-bar');
        $bar.css('animation', 'none');
        // Force reflow so removing animation takes effect before re-adding
        $bar[0] && $bar[0].offsetWidth;
        $bar.css('animation', `slideshow-tick ${SLIDESHOW_INTERVAL_MS}ms linear forwards`);

        gameState.slideshowInterval = setInterval(() => {
            gameState.currentImageIndex = (gameState.currentImageIndex + 1) % gameState.images.length;
            updateSlideshowImage();
            // Restart bar for the new image
            $bar.css('animation', 'none');
            $bar[0] && $bar[0].offsetWidth;
            $bar.css('animation', `slideshow-tick ${SLIDESHOW_INTERVAL_MS}ms linear forwards`);
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
        const $img = $("#imageContainer .slideshow-container img");

        $img.attr({
            src: currentImage.thumbUrl || currentImage.url,
            alt: currentImage.title || 'Location image'
        });

        const img = new Image();
        img.onload = function() {
            $img.removeClass('landscape portrait')
                .addClass(this.width > this.height ? 'landscape' : 'portrait');
        };
        img.src = currentImage.thumbUrl || currentImage.url;

        const $attribution = $("#imageContainer .slideshow-container .image-attribution");
        if (currentImage.license) {
            $attribution.text(`License: ${currentImage.license}`).show();
        } else {
            $attribution.hide();
        }
        $("#imageCounter").text(`${gameState.currentImageIndex + 1} / ${gameState.images.length}`);
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
                .attr('alt', image.title || 'Location image')
                .on('error', function() {
                    $(this).attr('src', image.url);
                });

            $thumbnail.append($img);
            $thumbnail.click(() => {
                gameState.currentImageIndex = index;
                $gallery.find('.gallery-thumbnail').removeClass('active');
                $thumbnail.addClass('active');
                $("#imageCounter").text(`${gameState.currentImageIndex + 1} / ${gameState.images.length}`);
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

        L.polyline([
            [gameState.currentLocation.lat, gameState.currentLocation.lon],
            [userLatLng.lat, userLatLng.lng]
        ], { color: 'red' }).addTo(gameState.map);

        gameState.map.fitBounds(L.latLngBounds([
            [gameState.currentLocation.lat, gameState.currentLocation.lon],
            [userLatLng.lat, userLatLng.lng]
        ]), { padding: [50, 50] });

        showResults(distance, score);

        // Pre-fill pool while the player reads the results screen.
        refillLocationPool();
    }

    function showResults(distance, score) {
        // Populate result modal with .text() to avoid XSS from Wikidata strings.
        $("#resultDistance").empty();
        $('<h2></h2>').text(gameState.currentLocation.name || "Unknown Location")
            .appendTo("#resultDistance");
        $('<div class="result-distance"></div>')
            .html(`Your guess was <strong>${distance.toFixed(1)} km</strong> away`)
            .appendTo("#resultDistance");
        $('<div class="result-score"></div>')
            .text(`+${score} points`)
            .appendTo("#resultDistance");

        let message;
        if (distance < 1)         message = "Incredible! Are you a wizard?";
        else if (distance < 10)   message = "Amazing guess! You must know this place well.";
        else if (distance < 100)  message = "Great job! You were very close.";
        else if (distance < 500)  message = "Good guess! You were in the right area.";
        else if (distance < 2000) message = "Not bad! You were in the right region.";
        else                      message = "Better luck next time!";

        $("#resultMessage").text(message);
        $("#resultModal").show();
        $("#scoreDisplay").text(`Score: ${gameState.score}`);
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

    function setupEventListeners() {
        $("#viewModeToggle").click(function() {
            stopSlideshow();
            gameState.currentViewMode = gameState.currentViewMode === 'slideshow' ? 'gallery' : 'slideshow';
            displayImage(gameState.currentImageIndex);
        });

        $("#prevBtn").click(function() {
            if (gameState.images.length === 0) return;
            gameState.currentImageIndex =
                (gameState.currentImageIndex - 1 + gameState.images.length) % gameState.images.length;
            if (gameState.currentViewMode === 'slideshow') {
                updateSlideshowImage();
            } else {
                $("#imageContainer .gallery-thumbnail").removeClass('active')
                    .eq(gameState.currentImageIndex).addClass('active');
            }
            $("#imageCounter").text(`${gameState.currentImageIndex + 1} / ${gameState.images.length}`);
        });

        $("#nextBtn").click(function() {
            if (gameState.images.length === 0) return;
            gameState.currentImageIndex =
                (gameState.currentImageIndex + 1) % gameState.images.length;
            if (gameState.currentViewMode === 'slideshow') {
                updateSlideshowImage();
            } else {
                $("#imageContainer .gallery-thumbnail").removeClass('active')
                    .eq(gameState.currentImageIndex).addClass('active');
            }
            $("#imageCounter").text(`${gameState.currentImageIndex + 1} / ${gameState.images.length}`);
        });

        $("#guessBtn").click(submitGuess);

        $("#nextRoundBtn").click(function() {
            $("#resultModal").hide();
            if (gameState.round < gameState.maxRounds) {
                gameState.round++;
                startNewRound();
            } else {
                endGame();
            }
        });
    }

    // ---------------------------------------------------------------------------
    // End game / restart
    // ---------------------------------------------------------------------------

    function endGame() {
        updateProgressBar(100);
        $("#progressContainer").hide();
        $(".game-area").html(`
            <div class="game-over-screen">
                <h2>🎉 Game Complete! 🎊</h2>
                <p>Your final score: <strong>${gameState.score}</strong></p>
                <button id="restartBtn" class="next-round-btn">Play Again</button>
            </div>
        `);

        // Keep filling the pool so the next game starts instantly.
        refillLocationPool();

        $("#restartBtn").click(function() {
            stopSlideshow();
            $(".game-area").html(`
                <div class="image-container" id="imageContainer">
                    <div class="loading">
                        <i class="fas fa-spinner loading-spinner"></i> Loading game...
                    </div>
                </div>

                <div class="image-nav">
                    <button class="nav-btn" id="prevBtn">
                        <i class="fas fa-arrow-left"></i> Previous
                    </button>
                    <span id="imageCounter">1 / 1</span>
                    <button class="nav-btn" id="nextBtn">
                        Next <i class="fas fa-arrow-right"></i>
                    </button>
                    <button class="view-mode-toggle" id="viewModeToggle"></button>
                </div>

                <div class="guess-controls">
                    <p>Click on the map below to mark your guess.</p>
                    <button class="guess-btn" id="guessBtn" disabled>Make Guess</button>
                </div>
                <div class="map-container" id="map"></div>
            `);
            initGame();
        });
    }
});
