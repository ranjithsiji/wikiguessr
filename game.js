$(document).ready(function() {
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
        slideshowInterval: null
    };

    initGame();

    function initGame() {
        gameState.score = 0;
        gameState.round = 1;
        gameState.currentLocation = null;
        gameState.userGuess = null;
        gameState.images = [];
        gameState.currentImageIndex = 0;
        gameState.currentViewMode = 'gallery';

        updateProgressBar(0);
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
    }

    function startNewRound() {
        stopSlideshow();

        // Preserve the user's chosen view mode across rounds — do NOT reset to gallery here.
        // Images are always (re)loaded via displayImage() which calls setup for the active mode.

        gameState.userGuess = null;
        gameState.images = [];
        gameState.currentImageIndex = 0;

        gameState.map.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                gameState.map.removeLayer(layer);
            }
        });

        $("#guessBtn").prop("disabled", true);
        showLoadingMessage("Finding an interesting location...");

        const progress = ((gameState.round - 1) / gameState.maxRounds) * 100;
        updateProgressBar(progress);
        $("#roundDisplay").text(`Round: ${gameState.round}/${gameState.maxRounds}`);
        $("#imageCounter").text("Loading...");

        getRandomLocationWithImages(
            function(locationData) {
                gameState.currentLocation = {
                    lat: parseFloat(locationData.lat),
                    lon: parseFloat(locationData.lon),
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
            },
            function(error) {
                showError("Failed to load location. Trying again...");
                console.error("Location loading error:", error);
                setTimeout(startNewRound, 1500);
            }
        );
    }

    function getRandomLocationWithImages(successCallback, errorCallback, attempt) {
        attempt = attempt || 1;
        const maxAttempts = 5;

        // Keep the offset well within the range where Wikidata reliably returns results.
        const randomOffset = Math.floor(Math.random() * 500000);
        const query = `
            SELECT ?item ?itemLabel ?itemDescription ?lat ?lon ?photo WHERE {
                {
                    SELECT ?item ?photo ?lat ?lon
                    WHERE {
                        ?item wdt:P18 ?photo .
                        ?item p:P625 ?statement .
                        ?statement psv:P625 ?coords .
                        ?coords wikibase:geoLatitude ?lat .
                        ?coords wikibase:geoLongitude ?lon .
                    } LIMIT 1 OFFSET ${randomOffset}
                }
                SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
            }`;

        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
        showLoadingMessage("Loading an interesting location from Wikidata...");

        $.ajax({
            url: url,
            method: 'GET',
            dataType: 'json',
            headers: { 'Accept': 'application/json' },
            success: function(data) {
                if (data.results && data.results.bindings.length > 0) {
                    const result = data.results.bindings[0];
                    const lat = parseFloat(result.lat.value);
                    const lon = parseFloat(result.lon.value);

                    // Validate coordinates are real numbers before proceeding.
                    if (isNaN(lat) || isNaN(lon)) {
                        retryOrFail();
                        return;
                    }

                    successCallback({
                        item: result.item.value,
                        itemLabel: result.itemLabel ? result.itemLabel.value : 'Unknown Location',
                        itemDescription: result.itemDescription ? result.itemDescription.value : '',
                        image: result.photo.value,
                        lon: lon,
                        lat: lat
                    });
                } else {
                    retryOrFail();
                }
            },
            error: function(xhr, status, error) {
                retryOrFail(new Error(`SPARQL query failed: ${status}`));
            }
        });

        function retryOrFail(err) {
            if (attempt < maxAttempts) {
                console.warn(`SPARQL returned no results at offset ${randomOffset}, retrying (${attempt}/${maxAttempts})...`);
                getRandomLocationWithImages(successCallback, errorCallback, attempt + 1);
            } else {
                errorCallback(err || new Error('No results after maximum retries'));
            }
        }
    }

    function getImagesFromCommons(lat, lon, successCallback, errorCallback, radiusKm = 5, limit = 20) {
        const radiusMeters = Math.round(radiusKm * 1000);
        const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=geosearch&ggsprimary=all&ggsnamespace=6&ggsradius=${radiusMeters}&ggscoord=${lat}|${lon}&ggslimit=${limit}&prop=imageinfo&iiprop=url|extmetadata|coordinates&iiurlwidth=500&origin=*`;

        $.ajax({
            url: url,
            dataType: 'json',
            success: function(data) {
                if (data.query && data.query.pages) {
                    const images = [];
                    for (const pageId in data.query.pages) {
                        const page = data.query.pages[pageId];
                        if (page.imageinfo && page.imageinfo[0]) {
                            const imageInfo = page.imageinfo[0];
                            const metadata = imageInfo.extmetadata || {};
                            images.push({
                                url: imageInfo.url,
                                thumbUrl: imageInfo.thumburl || imageInfo.url,
                                title: page.title.replace('File:', ''),
                                description: metadata.ImageDescription ? metadata.ImageDescription.value : '',
                                license: metadata.LicenseShortName ? metadata.LicenseShortName.value : ''
                            });
                        }
                    }

                    if (images.length > 0) {
                        successCallback(images);
                    } else {
                        errorCallback();
                    }
                } else {
                    errorCallback();
                }
            },
            error: function() {
                errorCallback();
            }
        });
    }

    function getImagesFromWikidata(itemId, successCallback, errorCallback) {
        const query = `SELECT ?image WHERE { <${itemId}> wdt:P18 ?image. } LIMIT 10`;
        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;

        $.ajax({
            url: url,
            dataType: 'json',
            headers: { 'Accept': 'application/json' },
            success: function(data) {
                if (!data.results || !data.results.bindings || data.results.bindings.length === 0) {
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

        $slide.append($img);
        $slideshow.append($slide);
        $container.append($slideshow);

        if (gameState.images.length > 1) {
            gameState.slideshowInterval = setInterval(() => {
                gameState.currentImageIndex = (gameState.currentImageIndex + 1) % gameState.images.length;
                updateSlideshowImage();
            }, 3000);
        }
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

    // Haversine formula — correctly uses both dLat and dLon.
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

        // Build popup safely to avoid XSS from Wikidata content.
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

        const bounds = L.latLngBounds([
            [gameState.currentLocation.lat, gameState.currentLocation.lon],
            [userLatLng.lat, userLatLng.lng]
        ]);
        gameState.map.fitBounds(bounds, { padding: [50, 50] });

        showResults(distance, score);
    }

    function showResults(distance, score) {
        const locationName = gameState.currentLocation.name || "Unknown Location";

        // Populate result modal safely — use .text() for user-visible Wikidata strings.
        $("#resultDistance").empty();
        $('<h2></h2>').text(locationName).appendTo("#resultDistance");
        $('<div class="result-distance"></div>')
            .html(`Your guess was <strong>${distance.toFixed(1)} km</strong> away`)
            .appendTo("#resultDistance");
        $('<div class="result-score"></div>')
            .text(`+${score} points`)
            .appendTo("#resultDistance");

        let message;
        if (distance < 1) {
            message = "Incredible! Are you a wizard?";
        } else if (distance < 10) {
            message = "Amazing guess! You must know this place well.";
        } else if (distance < 100) {
            message = "Great job! You were very close.";
        } else if (distance < 500) {
            message = "Good guess! You were in the right area.";
        } else if (distance < 2000) {
            message = "Not bad! You were in the right region.";
        } else {
            message = "Better luck next time!";
        }

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

    function endGame() {
        $(".game-area").html(`
            <div class="game-over-screen">
                <h2>🎉 Game Complete! 🎊</h2>
                <p>Your final score: <strong id="finalScore">${gameState.score}</strong></p>
                <button id="restartBtn" class="next-round-btn">Play Again</button>
            </div>
        `);

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
