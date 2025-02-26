
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
console.log("Mapbox GL JS Loaded:", mapboxgl);
mapboxgl.accessToken = 'pk.eyJ1IjoiYW5nMDI1IiwiYSI6ImNtN2w4cGFzODA5OHEycm9veDMyanc3YzEifQ.f3a-lq-cHrp7AJ97YhzrPw';


let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
let filteredStations = [];
const tooltip = d3.select('#tooltip');

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // ID of the div where the map will render
    style: 'mapbox://styles/mapbox/streets-v12', // Map style
    center: [-71.09415, 42.36027], // [longitude, latitude]
    zoom: 12, // Initial Zoom
    minZoom: 5, // Min Zoom
    maxZoom: 18 // Max Zoom
});

const BikeLanesColors = {
    'line-color': '#32D400',
    'line-width': 5,
    'line-opacity': 0.6
};

function computeStationTraffic(stations, timeFilter = -1) {
    const departures = d3.rollup(
        filterByMinute(departuresByMinute, timeFilter), 
        (v) => v.length,
        (d) => d.start_station_id
    );
    const arrivals = d3.rollup(
        filterByMinute(arrivalsByMinute, timeFilter),
        (v) => v.length,
        (d) => d.end_station_id
    );  
    
    return stations.map(station => ({
        arrivals: arrivals.get(station.short_name) ?? 0,
        departures: departures.get(station.short_name) ?? 0,
        totalTraffic: (arrivals.get(station.short_name) ?? 0) + (departures.get(station.short_name) ?? 0),
    }));
}
function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
        return tripsByMinute.flat(); 
    }
    
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;
    
    if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
    } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat); 
    const { x, y } = map.project(point);  
    return { cx: x, cy: y }; 
}

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);  
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}


map.on('load', async () => {
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
    });

    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: BikeLanesColors
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });
    map.addLayer({
        id: 'bike-lanes-c',
        type: 'line',
        source: 'cambridge_route',
        paint:BikeLanesColors
    });

    try {
        const jsonData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
        console.log('Loaded JSON Data:', jsonData);  // Log to verify structure
        
        console.log('Stations Data Loaded:', jsonData.data.stations);
        let trips = await d3.csv(
            'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
            (trip) => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            let startedMinutes = minutesSinceMidnight(trip.started_at); 
            departuresByMinute[startedMinutes].push(trip); 
            let endedMinutes = minutesSinceMidnight(trip.ended_at); 
            arrivalsByMinute[endedMinutes].push(trip);
                
            return trip;
            },
        );
        const stations = computeStationTraffic(jsonData.data.stations);   
        const svg = d3.select('#map').select('svg');
        filteredStations = stations; 

         const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, d => d.totalTraffic)])
            .range([0, 25]);

        const circles = svg.selectAll('circle')
            .data(stations, (d) => d.short_name)
            .enter()
            .append('circle')
            .attr('r', d => radiusScale(d.totalTraffic)) // Use scale to size markers
            .attr('fill', 'steelblue')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .append('title')
            .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);

        
        svg.selectAll('circle')
            .on("mouseover", function(event, d) {  
                tooltip.style("visibility", "visible")
                    .html(`${d.totalTraffic} trips <br> (${d.departures} departures, ${d.arrivals} arrivals)`);
            })            
            .on("mousemove", function(event) {
                tooltip.style("top", (event.pageY + 10) + "px")
                    .style("left", (event.pageX + 10) + "px");
            })
            .on("mouseout", function() {
                tooltip.style("visibility", "hidden");
            });

        function updatePositions() {
            svg.selectAll('circle')
                .data(filteredStations, d => d.short_name)
                .attr('cx', d => getCoords(d).cx)
                .attr('cy', d => getCoords(d).cy);
        }
                
        updatePositions();
        
        // Update positions when map moves and/or zooms
        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);


        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');

        function updateTimeDisplay() {
            let timeFilter = Number(timeSlider.value);
        
            if (timeFilter === -1) {
              selectedTime.textContent = ''; 
              anyTimeLabel.style.display = 'block'; 
            } else {
              selectedTime.textContent = formatTime(timeFilter); 
              anyTimeLabel.style.display = 'none'; 
            }
            
            updateScatterPlot(timeFilter);
        }
        
        function updateScatterPlot(timeFilter) {
            const filteredStations = computeStationTraffic(stations, timeFilter);

            timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

            // Update the scatterplot by adjusting the radius of circles
            circles
                .data(filteredStations, (d) => d.short_name)  // Ensure D3 tracks elements correctly
                .join('circle')
                .attr('r', (d) => radiusScale(d.totalTraffic))
                .attr('cx', d => getCoords(d).cx)
                .attr('cy', d => getCoords(d).cy)
                .style('--departure-ratio', (d) =>
                    stationFlow(d.departures / d.totalTraffic),
                )
                .select("title")
                .text((d) => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`); // Update text
        }
        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();
         
         } catch (error) {
        console.error('Error loading JSON:', error); 
    }
});



