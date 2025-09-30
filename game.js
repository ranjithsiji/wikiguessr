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
        locationPool: [], // Store multiple locations
        slideshowInterval: null,
        currentViewMode: 'gallery'
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
        
        // Show loading message
        showLoadingMessage("Preparing location...");
        
        // Update progress bar
        const progress = (gameState.round / gameState.maxRounds) * 100;
        updateProgressBar(progress);
        
        // Update round display
        $("#roundDisplay").text(`Round: ${gameState.round}/${gameState.maxRounds}`);
        
        // If first round, use quick location and fetch Wikidata locations in background
        if (gameState.round === 1) {
            // Use quick location for first round
            const quickLocation = getQuickRandomLocation();
            gameState.currentLocation = {
                lat: quickLocation.lat,
                lon: quickLocation.lon,
                name: quickLocation.name,
                country: quickLocation.country,
                item: "" // No Wikidata item for quick locations
            };
            // Start loading Wikidata locations in background
            getWikidataLocationsBatch(locations => {
                gameState.locationPool = locations;
            });
            
            // Load images for quick location
            loadLocationImages();
        } 
        // If we have locations in pool, use one
        else if (gameState.locationPool.length > 0) {
            const locationData = gameState.locationPool.pop();
            gameState.currentLocation = {
                lat: locationData.lat,
                lon: locationData.lon,
                name: locationData.itemLabel,
                country: locationData.countryLabel,
                item: locationData.item
            };
            loadLocationImages();
        }
        // Otherwise fall back to single query
        else {
            getRandomLocationWithImages(
                locationData => {
                    gameState.currentLocation = {
                        lat: locationData.lat,
                        lon: locationData.lon,
                        name: locationData.itemLabel,
                        country: locationData.countryLabel,
                        item: locationData.item
                    };
                    loadLocationImages();
                },
                error => {
                    showError("Failed to load location. Trying again...");
                    setTimeout(startNewRound, 1500);
                }
            );
        }
    }

    function loadLocationImages() {
        showLoadingMessage("Loading images...");
        
        if (gameState.currentLocation.item) {
            // Try to get images from Wikimedia Commons first
            getImagesFromCommons(
                gameState.currentLocation.lat,
                gameState.currentLocation.lon,
                function(images) {
                    if (images.length === 0) {
                        throw new Error('No Commons images found');
                    }
                    gameState.images = images;
                    displayImage(0);
                },
                function () {
                    // Fall back to Wikidata images if Commons fails
                    getImagesFromWikidata(
                        gameState.currentLocation.item,
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
                            setTimeout(startNewRound, 1500);
                        }
                    );
                },
                5, //Radius Kms
                20 //No of images
            );
        } else {
            // For quick locations, use a generic image search
            const qlat = gameState.currentLocation.lat;
            const qlon = gameState.currentLocation.lon;
            const query = gameState.currentLocation.name.replace(/\s+/g, '+');
           // const url = `https://en.wikipedia.org/w/api.php?action=query&generator=images&gimlimit=5&prop=imageinfo&iiprop=url&format=json&origin=*&titles=${query}`;
            const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=geosearch&ggsprimary=all&ggsnamespace=6&ggsradius=10&ggscoord=${qlat}|${qlon}&ggslimit=20&prop=imageinfo&iiprop=url|extmetadata|dimensions&iiurlwidth=500&origin=*`;

            $.ajax({
                url: url,
                dataType: 'json',
                success: function(data) {
                    const images = [];
                    if (data.query && data.query.pages) {
                        Object.values(data.query.pages).forEach(page => {
                            if (page.imageinfo && page.imageinfo[0]) {
                                const imageInfo = page.imageinfo[0];
                                const metadata = imageInfo.extmetadata || {};
                                images.push({
                                    url: imageInfo.url,
                                    thumbUrl: imageInfo.thumburl,
                                    smallUrl: imageInfo.responsiveUrls ? imageInfo.responsiveUrls['1.5'] : imageInfo.thumburl,
                                    title: page.title.replace('File:', ''),
                                    description: metadata.ImageDescription ? metadata.ImageDescription.value : '',
                                    license: metadata.LicenseShortName ? metadata.LicenseShortName.value : ''
                                });
                            }
                        });
                    }
                    
                    if (images.length > 0) {
                        gameState.images = images;
                        displayImage(0);
                    } else {
                        showError("No images found. Trying again...");
                        setTimeout(startNewRound, 1500);
                    }
                },
                error: function() {
                    showError("Failed to load images. Trying again...");
                    setTimeout(startNewRound, 1500);
                }
            });
        }
    }
    function getQuickRandomLocation() {
        // Simple list of well-known locations with coordinates
        const quickLocations = [
            {name: "Eiffel Tower", lat: 48.8584, lon: 2.2945, country: "France"},
            {name: "Statue of Liberty", lat: 40.6892, lon: -74.0445, country: "USA"},
            {name: "Colosseum", lat: 41.8902, lon: 12.4922, country: "Italy"},
            {name: "Great Wall of China", lat: 40.4319, lon: 116.5704, country: "China"},
            {name: "Taj Mahal", lat: 27.1751, lon: 78.0421, country: "India"},
            {name: "Machu Picchu", lat: -13.1631, lon: -72.5450, country: "Peru"},
            {name: "Pyramids of Giza", lat: 29.9792, lon: 31.1342, country: "Egypt"},
            {name: "Christ the Redeemer", lat: -22.9519, lon: -43.2105, country: "Brazil"},
            {name: "Sydney Opera House", lat: -33.8568, lon: 151.2153, country: "Australia"},
            {name: "Angkor Wat", lat: 13.4125, lon: 103.8670, country: "Cambodia"},
            {name: "The Acropolis", lat: 37.9715, lon: 23.7257, country: "Greece"},
            {name: "Golden Gate Bridge", lat: 37.8199, lon: -122.4783, country: "USA"},
            {name: "Stonehenge", lat: 51.1789, lon: -1.8262, country: "UK"},
            {name: "Mount Everest", lat: 27.9881, lon: 86.9250, country: "Nepal"},
            {name: "Niagara Falls", lat: 43.0896, lon: -79.0747, country: "Canada/USA"},
            {name: "Chichen Itza", lat: 20.6843, lon: -88.5678, country: "Mexico"},
            {name: "Leaning Tower of Pisa", lat: 43.7230, lon: 10.3966, country: "Italy"},
            {name: "Burj Khalifa", lat: 25.1972, lon: 55.2744, country: "UAE"},
            {name: "Great Barrier Reef", lat: -18.2871, lon: 147.6992, country: "Australia"},
            {name: "Petra", lat: 30.3285, lon: 35.4444, country: "Jordan"},
            {name: "Victoria Falls", lat: -17.9243, lon: 25.8567, country: "Zambia/Zimbabwe"},
            {name: "Mount Kilimanjaro", lat: -3.0674, lon: 37.3556, country: "Tanzania"},
            {name: "Table Mountain", lat: -33.9575, lon: 18.4042, country: "South Africa"},
            {name: "Forbidden City", lat: 39.9166, lon: 116.3972, country: "China"},
            {name: "The Louvre Museum", lat: 48.8606, lon: 2.3376, country: "France"},
            {name: "Grand Canyon", lat: 36.1015, lon: -112.1129, country: "USA"},
            {name: "Iguazu Falls", lat: -25.6953, lon: -54.4366, country: "Argentina/Brazil"},
            {name: "Hagia Sophia", lat: 41.0086, lon: 28.9801, country: "Turkey"},
            {name: "Neuschwanstein Castle", lat: 47.5576, lon: 10.7498, country: "Germany"},
            {name: "Sagrada Família", lat: 41.4036, lon: 2.1744, country: "Spain"},
            {name: "Eiffel Tower", lat: 48.8584, lon: 2.2945, country: "France"},
            {name: "St. Peter's Basilica", lat: 41.9022, lon: 12.4578, country: "Vatican City"},
            {name: "The Dead Sea", lat: 31.5340, lon: 35.4984, country: "Jordan/Israel"},
            {name: "Bora Bora", lat: -16.5004, lon: -151.7415, country: "French Polynesia"},
            {name: "Galapagos Islands", lat: -0.7063, lon: -90.9656, country: "Ecuador"},
            {name: "Yosemite National Park", lat: 37.8651, lon: -119.5383, country: "USA"},
            {name: "The Shard", lat: 51.5045, lon: -0.0865, country: "UK"},
            {name: "Sistine Chapel", lat: 41.9029, lon: 12.4545, country: "Vatican City"},
            {name: "Empire State Building", lat: 40.7484, lon: -73.9857, country: "USA"},
            {name: "Big Ben", lat: 51.5007, lon: -0.1246, country: "UK"},
            {name: "Uluru (Ayers Rock)", lat: -25.3444, lon: 131.0369, country: "Australia"},
            {name: "Chichen Itza", lat: 20.6843, lon: -88.5678, country: "Mexico"},
            {name: "Golden Temple", lat: 31.6200, lon: 74.8765, country: "India"},
            {name: "Sagano Bamboo Forest", lat: 35.0116, lon: 135.7681, country: "Japan"},
            {name: "Blue Mosque", lat: 41.0054, lon: 28.9768, country: "Turkey"},
            {name: "Rapa Nui (Easter Island)", lat: -27.1127, lon: -109.3496, country: "Chile"},
            {name: "Serengeti National Park", lat: -2.3333, lon: 34.8333, country: "Tanzania"},
            {name: "Himalayas", lat: 27.9881, lon: 86.9250, country: "Nepal/China"},
            {name: "Machu Picchu", lat: -13.1631, lon: -72.5450, country: "Peru"},
            {name: "The Amazon Rainforest", lat: -3.4653, lon: -62.2159, country: "Brazil"},
            {name: "Uyuni Salt Flats", lat: -20.2111, lon: -67.4566, country: "Bolivia"},
            {name: "Angel Falls", lat: 5.9714, lon: -62.5348, country: "Venezuela"},
            {name: "Mount Rushmore", lat: 43.8791, lon: -103.4591, country: "USA"},
            {name: "Golden Gate Bridge", lat: 37.8199, lon: -122.4783, country: "USA"},
            {name: "Central Park", lat: 40.7850, lon: -73.9683, country: "USA"},
            {name: "Hollywood Sign", lat: 34.1341, lon: -118.3215, country: "USA"},
            {name: "Red Square", lat: 55.7539, lon: 37.6208, country: "Russia"},
            {name: "Trevi Fountain", lat: 41.9009, lon: 12.4833, country: "Italy"},
            {name: "Himeji Castle", lat: 34.8395, lon: 134.6859, country: "Japan"},
            {name: "Mount Fuji", lat: 35.3606, lon: 138.7282, country: "Japan"},
            {name: "Wailing Wall", lat: 31.7767, lon: 35.2346, country: "Israel"},
            {name: "Dead Sea", lat: 31.5340, lon: 35.4984, country: "Jordan/Israel"},
            {name: "Grand Canyon National Park", lat: 36.1015, lon: -112.1129, country: "USA"},
            {name: "Loch Ness", lat: 57.3228, lon: -4.4849, country: "Scotland"},
            {name: "Mount Vesuvius", lat: 40.8224, lon: 14.4289, country: "Italy"},
            {name: "The Parthenon", lat: 37.9715, lon: 23.7257, country: "Greece"},
            {name: "The Gherkin", lat: 51.5144, lon: -0.0805, country: "UK"},
            {name: "Brandenburg Gate", lat: 52.5163, lon: 13.3777, country: "Germany"},
            {name: "The Sagrada Família", lat: 41.4036, lon: 2.1744, country: "Spain"},
            {name: "Alhambra", lat: 37.1773, lon: -3.5982, country: "Spain"},
            {name: "Hagia Sophia", lat: 41.0086, lon: 28.9801, country: "Turkey"},
            {name: "Blue Lagoon", lat: 63.8814, lon: -22.4497, country: "Iceland"},
            {name: "The Blue Grotto", lat: 40.5562, lon: 14.2155, country: "Italy"},
            {name: "Great Smoky Mountains", lat: 35.6315, lon: -83.5070, country: "USA"},
            {name: "The Palace of Versailles", lat: 48.8049, lon: 2.1204, country: "France"},
            {name: "Suez Canal", lat: 30.6406, lon: 32.5599, country: "Egypt"},
            {name: "Panama Canal", lat: 9.0766, lon: -79.6450, country: "Panama"},
            {name: "The Forbidden City", lat: 39.9166, lon: 116.3972, country: "China"},
            {name: "The Hermitage Museum", lat: 59.9401, lon: 30.3145, country: "Russia"},
            {name: "Rialto Bridge", lat: 45.4380, lon: 12.3359, country: "Italy"},
            {name: "Table Mountain National Park", lat: -33.9575, lon: 18.4042, country: "South Africa"},
            {name: "Mount Everest", lat: 27.9881, lon: 86.9250, country: "Nepal/China"},
            {name: "The Twelve Apostles", lat: -38.6654, lon: 143.0478, country: "Australia"},
            {name: "The London Eye", lat: 51.5033, lon: -0.1196, country: "UK"},
            {name: "Machu Picchu", lat: -13.1631, lon: -72.5450, country: "Peru"},
            {name: "Burj Al Arab", lat: 25.1417, lon: 55.1852, country: "UAE"},
            {name: "Christ the Redeemer", lat: -22.9519, lon: -43.2105, country: "Brazil"},
            {name: "The Colosseum", lat: 41.8902, lon: 12.4922, country: "Italy"},
            {name: "Times Square", lat: 40.7580, lon: -73.9855, country: "USA"},
            {name: "Disneyland Paris", lat: 48.8687, lon: 2.7828, country: "France"},
            {name: "Great Barrier Reef", lat: -18.2871, lon: 147.6992, country: "Australia"},
            {name: "Grand Canyon", lat: 36.1015, lon: -112.1129, country: "USA"},
            {name: "Chichen Itza", lat: 20.6843, lon: -88.5678, country: "Mexico"},
            {name: "Mount Fuji", lat: 35.3606, lon: 138.7282, country: "Japan"},
            {name: "Taj Mahal", lat: 27.1751, lon: 78.0421, country: "India"},
            {name: "The Eiffel Tower", lat: 48.8584, lon: 2.2945, country: "France"}
            ];
        
        return quickLocations[Math.floor(Math.random() * quickLocations.length)];
    }
    function getWikidataLocationsBatch(callback) {
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
                        FILTER(ABS(?lat) < 70)  # Avoid polar regions
                    } LIMIT 10 OFFSET ${randomOffset}
                } 
                SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } 
            }`;
        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
        console.log ("Get Batch location from Wikidata");
        $.ajax({
            url: url,
            method: 'GET',
            dataType: 'json',
            headers: {
                'Accept': 'application/json',
            },
            success: function(data) {
                if (data.results.bindings.length > 0) {
                    const locations = data.results.bindings.map(result => ({
                        item: result.item.value,
                        itemLabel: result.itemLabel.value,
                        image: result.photo.value,
                        lon: parseFloat(result.lon.value),
                        lat: parseFloat(result.lat.value),
                        countryLabel: result.countryLabel?.value || ''
                    }));
                    callback(locations);
                } else {
                    console.error("No results from SPARQL query");
                    callback([]);
                }
            },
            error: function(xhr, status, error) {
                console.error("SPARQL query failed:", status);
                callback([]);
            }
        });
    }
    
    function getImagesFromCommons(lat, lon, successCallback, errorCallback, radiusKm = 5, limit = 20) {
        console.log("getting images from commons");
        const radiusMeters = Math.round(radiusKm * 1000);
        const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=geosearch&ggsprimary=all&ggsnamespace=6&ggsradius=${radiusMeters}&ggscoord=${lat}|${lon}&ggslimit=${limit}&prop=imageinfo&iiprop=url|extmetadata|dimensions&iiurlwidth=500&origin=*`;
        
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
                                thumbUrl: imageInfo.thumburl,
                                smallUrl: imageInfo.responsiveUrls ? imageInfo.responsiveUrls['1.5'] : imageInfo.thumburl,
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
        console.log("Get single location from Wikidata::")
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
            .attr('src', currentImage.thumbUrl)
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
        img.src = currentImage.thumbUrl;
        
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
            'src': currentImage.thumbUrl,
            'alt': currentImage.license || 'Location image license'
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
        img.src = currentImage.thumbUrl;
        
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
                .attr('src', image.thumbUrl )
                .attr('alt', image.license || 'Location image license');
            
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
            
            // Reinitialize map and game
            initMap();
            setupEventListeners();
            startNewRound();
        });
    }
});