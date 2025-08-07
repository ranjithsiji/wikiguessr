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
        currentViewMode: 'gallery', // or 'slideshow'
        slideshowInterval: null
    };
    
    // Initialize the game
    initGame();
    
    function initGame() {
        // Initialize progress bar
        updateProgressBar(0);   // Red/orange (0-30%)
        
        // Initialize map
        initMap();
        
        // Start first round
        startNewRound();
        
        // Set up event listeners
        setupEventListeners();
    }
    
    function initMap() {
        gameState.map = L.map('map').setView([0, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(gameState.map);
        
        // Handle map clicks
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
    // Update progress bar with jQuery
    function updateProgressBar(percentage) {
        const $progressBar = $('#progressBar');
        
        
        // Ensure percentage is between 0 and 100
        percentage = Math.max(0, Math.min(100, percentage));
        
        // Update width and text
        $progressBar.css('width', `${percentage}%`);
        
        
        // Change color based on percentage
        if (percentage < 30) {
            $progressBar.css('background', 'linear-gradient(to right, #ed2213ff, #ff9800)');
        } else if (percentage < 70) {
            $progressBar.css('background', 'linear-gradient(to right, #ffb300ff, #baff3bff)');
        } else {
            $progressBar.css('background', 'linear-gradient(to right, #97d04cff, #5ea310ff)');
        }
    }

    function startNewRound() {
        // Reset round state
        gameState.userGuess = null;
        gameState.images = [];
        gameState.currentImageIndex = 0;
        
        // Clear previous markers and lines
        gameState.map.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                gameState.map.removeLayer(layer);
            }
        });
        
        // Disable guess button
        $("#guessBtn").prop("disabled", true);
        
        // Show initial loading state
        showLoadingMessage("Finding an interesting location...");        

        // Update progress bar
        const progress = (gameState.round / gameState.maxRounds) * 100;
        updateProgressBar(progress);
        
        // Update round display
        $("#roundDisplay").text(`Round: ${gameState.round}/${gameState.maxRounds}`);
        
        // Get a random location with images
        getRandomLocationWithImages(
            function(locationData) {
                // Success callback
                gameState.currentLocation = {
                    lat: parseFloat(locationData.lat),
                    lon: parseFloat(locationData.lon),
                    name: locationData.itemLabel,  // This comes from itemLabel
                    description: locationData.itemDescription,
                    item: locationData.item
                };
                
                // Show loading message for images
                showLoadingMessage("Loading images from Wikimedia Commons...");

                // First try to get images from Wikimedia Commons
                getImagesFromCommons(
                    gameState.currentLocation.lat,
                    gameState.currentLocation.lon,
                    function(images) {
                        if (images.length === 0) {
                            showLoadingMessage("No Commons images found. Trying Wikidata...");
                            throw new Error('No Commons images found');
                        }
                        gameState.images = images;
                        displayImage(0);
                        //gameState.map.setView([gameState.currentLocation.lat, gameState.currentLocation.lon], 10);
                    },
                    function () {
                        // Fall back to Wikidata images if Commons fails
                        showLoadingMessage("Loading images from Wikidata...");
                        // Fall back to Wikidata images if Commons fails
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
                                gameState.map.setView([gameState.currentLocation.lat, gameState.currentLocation.lon], 10);
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
                // Error callback
                showError("Failed to load location. Trying again...");
                console.error("Location loading error:", error);
                setTimeout(startNewRound, 1500);
            }
        );
    }
    
    function getRandomLocationWithImages(successCallback, errorCallback) {
        const randomOffset = Math.floor(Math.random() * 1000000);
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
        //Update message that we are running the SPARQL Querry on Wikidata.
        showLoadingMessage("Loading an Interesting location from Wikidata...");
        $.ajax({
            url: url,
            method: 'GET',
            dataType: 'json',
            headers: {
                'Accept': 'application/json',
            },
            success: function(data) {
                if (data.results.bindings.length > 0) {
                    const result = data.results.bindings[0];
                    const lat = parseFloat(result.lat.value);
                    const lon = parseFloat(result.lon.value);
                    const label = result.itemLabel.value;
                    console.log(result);
                    successCallback({
                        item: result.item.value,
                        itemLabel: label,
                        itemDescription: result.itemDescription.value,
                        image: result.photo.value,
                        lon: lon,
                        lat: lat,
                        countryLabel: result.countryLabel?.value || ''  // Include country if available
                    });
                } else {
                    errorCallback(new Error('No results from SPARQL query'));
                    return;
                }
            },
            error: function(xhr, status, error) {
                errorCallback(new Error(`SPARQL query failed: ${status}`));
            }
        });
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
                    const pages = data.query.pages;
                    
                    for (const pageId in pages) {
                        const page = pages[pageId];
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
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'WikidataGuessr/1.0'
            },
            success: function(data) {
                if (!data.results || !data.results.bindings || data.results.bindings.length === 0) {
                    successCallback([]);
                    return;
                }
                
                const images = data.results.bindings.map(item => {
                    return {
                        url: item.image.value.replace(/^http:/, 'https:'),
                        title: item.image.value.split('/').pop(),
                        source: 'wikidata'
                    };
                });
                
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
        if (gameState.images.length === 0) return;

        // Clear any existing slideshow interval
        if (gameState.slideshowInterval) {
            clearInterval(gameState.slideshowInterval);
            gameState.slideshowInterval = null;
        }

        // Remove loading state
        const $imageContainer = $("#imageContainer")
            .removeClass("loading")
            .empty();

        // Create view mode toggle button
       // const $toggleBtn = $('<button class="view-mode-toggle" id="viewModeToggle"></button>');
        //$imageContainer.append($toggleBtn);
        updateViewModeToggle();

        if (gameState.currentViewMode === 'slideshow') {
            setupSlideshow($imageContainer);
        } else {
            setupGallery($imageContainer);
        }

        // Update image counter
        $("#imageCounter").text(`${gameState.currentImageIndex + 1} / ${gameState.images.length}`);
    }
    
    function setupSlideshow($container) {
        // Create slideshow container
        const $slideshow = $('<div class="slideshow-container"></div>');
        
        // Create single slide
        const $slide = $('<div class="slideshow-slide"></div>');
        const currentImage = gameState.images[gameState.currentImageIndex];
        
        // Create image element
        const $img = $('<img>')
            .attr('src', currentImage.thumbUrl || currentImage.url)
            .attr('alt', currentImage.title || 'Location image');
        
        // Add class based on image orientation
        const img = new Image();
        img.onload = function() {
            if (this.width > this.height) {
                $img.addClass('landscape');
            } else {
                $img.addClass('portrait');
            }
        };
        img.src = currentImage.thumbUrl || currentImage.url;
        
        // Add attribution if available
        if (currentImage.license) {
            const $attribution = $('<div class="image-attribution"></div>')
                .text(`License: ${currentImage.license}`);
            $slide.append($attribution);
        }
        
        $slide.append($img);
        $slideshow.append($slide);
        $container.append($slideshow);
        
        // Start slideshow autoplay
        gameState.slideshowInterval = setInterval(() => {
            gameState.currentImageIndex = (gameState.currentImageIndex + 1) % gameState.images.length;
            updateSlideshowImage();
        }, 3000);
    }

    function updateSlideshowImage() {
        const currentImage = gameState.images[gameState.currentImageIndex];
        const $slideshow = $("#imageContainer .slideshow-container");
        const $img = $slideshow.find('img');
        
        // Update image source
        $img.attr({
            'src': currentImage.thumbUrl || currentImage.url,
            'alt': currentImage.title || 'Location image'
        });
        
        // Update image class based on orientation
        const img = new Image();
        img.onload = function() {
            $img.removeClass('landscape portrait');
            if (this.width > this.height) {
                $img.addClass('landscape');
            } else {
                $img.addClass('portrait');
            }
        };
        img.src = currentImage.thumbUrl || currentImage.url;
        
        // Update attribution
        const $attribution = $slideshow.find('.image-attribution');
        if (currentImage.license) {
            $attribution.text(`License: ${currentImage.license}`).show();
        } else {
            $attribution.hide();
        }
        
        // Update counter
        $("#imageCounter").text(`${gameState.currentImageIndex + 1} / ${gameState.images.length}`);
    }

    function setupGallery($container) {
        // Create gallery container
        const $gallery = $('<div class="gallery-container"></div>');
        
        // Create all thumbnails
        gameState.images.forEach((image, index) => {
            const $thumbnail = $('<div class="gallery-thumbnail"></div>')
                .toggleClass('active', index === gameState.currentImageIndex);
            
            const $img = $('<img>')
                .attr('src', image.thumbUrl || image.url)
                .attr('alt', image.title || 'Location image');
            
            $thumbnail.append($img);
            $thumbnail.click(() => {
                gameState.currentImageIndex = index;
                $gallery.find('.gallery-thumbnail').removeClass('active');
                $thumbnail.addClass('active');
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
    
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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
        
        // Clear the image container
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
        
        // Show the actual location on the map
        const actualMarker = L.marker([gameState.currentLocation.lat, gameState.currentLocation.lon], {
            icon: L.divIcon({
                className: 'actual-marker',
                html: '<i class="fas fa-map-marker-alt" style="color: green; font-size: 24px;"></i>',
                iconSize: [24, 24],
                iconAnchor: [12, 24]
            })
        }).addTo(gameState.map);
        
        // Create a more detailed popup with location name and country
        const popupContent = `
            <div style="text-align: center;">
                <h3 style="margin: 0 0 5px 0; color: #2c3e50;">${gameState.currentLocation.name}</h3>
                <p style="margin: 0; color: #7f8c8d;">${gameState.currentLocation.description || 'No description'}</p>
            </div>
        `;
        
        actualMarker.bindPopup(popupContent).openPopup();
        
        // Draw a line between the guess and actual location
        L.polyline([
            [gameState.currentLocation.lat, gameState.currentLocation.lon],
            [userLatLng.lat, userLatLng.lng]
        ], { color: 'red' }).addTo(gameState.map);
        
        // Zoom to show both points
        const bounds = L.latLngBounds([
            [gameState.currentLocation.lat, gameState.currentLocation.lon],
            [userLatLng.lat, userLatLng.lng]
        ]);
        gameState.map.fitBounds(bounds, { padding: [50, 50] });
        
        // Show results with location name
        showResults(distance, score);
    }
    
    function showResults(distance, score) {
        // Get the location name from gameState.currentLocation.name (which comes from itemLabel)
        const locationName = gameState.currentLocation.name || "Unknown Location";
        
        // Create the result HTML with the location name
        const resultHTML = `
            <h2>${locationName}</h2>
            <div class="result-distance">
                Your guess was <strong>${distance.toFixed(1)} km</strong> away
            </div>
            <div class="result-score">
                +${score} points
            </div>
        `;
        
        // Update the modal content
        $("#resultDistance").html(resultHTML);
        
        // Add a fun message based on distance
        let message = "";
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
            .fadeOut(500, function() {
                $(this).remove();
            });
    }
    
    function setupEventListeners() {
        $("#viewModeToggle").click(function() {
            if (gameState.slideshowInterval) {
                clearInterval(gameState.slideshowInterval);
                gameState.slideshowInterval = null;
            }
            
            gameState.currentViewMode = gameState.currentViewMode === 'slideshow' ? 'gallery' : 'slideshow';
            displayImage(gameState.currentImageIndex);
        });
        // Image navigation - loop continuously
        $("#prevBtn").click(function() {
            if (gameState.images.length === 0) return;
            
            gameState.currentImageIndex = (gameState.currentImageIndex - 1 + gameState.images.length) % gameState.images.length;
            
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
            
            gameState.currentImageIndex = (gameState.currentImageIndex + 1) % gameState.images.length;
            
            if (gameState.currentViewMode === 'slideshow') {
                updateSlideshowImage();
            } else {
                $("#imageContainer .gallery-thumbnail").removeClass('active')
                    .eq(gameState.currentImageIndex).addClass('active');
            }
            
            $("#imageCounter").text(`${gameState.currentImageIndex + 1} / ${gameState.images.length}`);
        });


        // Guess button
        $("#guessBtn").click(submitGuess);
        
        // Next round button
        $("#nextRoundBtn").click(function() {
            $("#resultModal").hide();
            
            if (gameState.round < gameState.maxRounds) {
                gameState.round++;
                startNewRound();
            } else {
                // Game over
                endGame();
            }
        });
    }
    
    function endGame() {
        $(".game-area").html(`
            <div style="text-align: center; padding: 40px; border:4px solid #ccc; border-radious:20px;margin:10px;color:green; font-size:2.5em; box-shadow: 0 0 20px rgba(255, 255, 255, 0.5);">
                <h2>🎉 Game Complete! 🎊</h2>
                <p style="font-size: 1.5em;">🥳 Your final score: <strong>${gameState.score}</strong></p>
                <button id="restartBtn" class="next-round-btn" style="margin-top: 20px;">Play Again</button>
            </div>
        `);
        
        $("#restartBtn").click(function() {
            // Reset game
            gameState.score = 0;
            gameState.round = 1;
            $(".game-area").html(`
                <div class="image-container" id="imageContainer">
                    <div class="loading">
                        <i class="fas fa-spinner loading-spinner"></i> Loading game...
                    </div>
                </div>
                
                <div class="image-nav">
                    <button class="nav-btn" id="prevBtn"><i class="fas fa-arrow-left"></i> Previous</button>
                    <span id="imageCounter">1 / 1</span>
                    <button class="nav-btn" id="nextBtn">Next <i class="fas fa-arrow-right"></i></button>
                </div>
                
                <div class="map-container" id="map"></div>
                
                <div class="guess-controls">
                    <button class="guess-btn" id="guessBtn" disabled>Make Guess</button>
                </div>
            `);
            
            // Reinitialize map and game
            initMap();
            setupEventListeners();
            startNewRound();
        });
    }
});