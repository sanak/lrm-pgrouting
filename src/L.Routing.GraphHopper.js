(function() {
	'use strict';

	var L = require('leaflet');
	var corslite = require('corslite');
	var polyline = require('polyline');

	L.Routing = L.Routing || {};

	L.Routing.GraphHopper = L.Class.extend({
		options: {
			serviceUrl: 'https://graphhopper.com/api/1/route',
			timeout: 30 * 1000,
			urlParameters: {}
		},

		initialize: function(apiKey, options) {
			this._apiKey = apiKey;
			L.Util.setOptions(this, options);
		},

		route: function(waypoints, callback, context, options) {
			var timedOut = false,
				wps = [],
				url,
				timer,
				wp,
				i;

			options = options || {};
			url = this.buildRouteUrl(waypoints, options);

			timer = setTimeout(function() {
								timedOut = true;
								callback.call(context || callback, {
									status: -1,
									message: 'GraphHopper request timed out.'
								});
							}, this.options.timeout);

			// Create a copy of the waypoints, since they
			// might otherwise be asynchronously modified while
			// the request is being processed.
			for (i = 0; i < waypoints.length; i++) {
				wp = waypoints[i];
				wps.push({
					latLng: wp.latLng,
					name: wp.name,
					options: wp.options
				});
			}

			corslite(url, L.bind(function(err, resp) {
				var data;

				clearTimeout(timer);
				if (!timedOut) {
					if (!err) {
						data = JSON.parse(resp.responseText);
						this._routeDone(data, wps, callback, context);
					} else {
						callback.call(context || callback, {
							status: -1,
							message: 'HTTP request failed: ' + err
						});
					}
				}
			}, this));

			return this;
		},

		_routeDone: function(response, inputWaypoints, callback, context) {
			var alts = [],
			    mappedWaypoints,
			    coordinates,
			    i,
			    path;

			context = context || callback;
			if (response.info.errors && response.info.errors.length) {
				callback.call(context, {
					// TODO: include all errors
					status: response.info.errors[0].details,
					message: response.info.errors[0].message
				});
				return;
			}

			for (i = 0; i < response.paths.length; i++) {
				path = response.paths[i];
				coordinates = this._decodePolyline(path.points);
				mappedWaypoints =
					this._mapWaypointIndices(inputWaypoints, path.instructions, coordinates);

				alts.push({
					name: '',
					coordinates: coordinates,
					instructions: this._convertInstructions(path.instructions),
					summary: {
						totalDistance: path.distance,
						totalTime: path.time / 1000,
					},
					inputWaypoints: inputWaypoints,
					actualWaypoints: mappedWaypoints.waypoints,
					waypointIndices: mappedWaypoints.waypointIndices
				});
			}

			callback.call(context, null, alts);
		},

		_decodePolyline: function(geometry) {
			var coords = polyline.decode(geometry, 5),
				latlngs = new Array(coords.length),
				i;
			for (i = 0; i < coords.length; i++) {
				latlngs[i] = new L.LatLng(coords[i][0], coords[i][1]);
			}

			return latlngs;
		},

		_toWaypoints: function(inputWaypoints, vias) {
			var wps = [],
			    i;
			for (i = 0; i < vias.length; i++) {
				wps.push({
					latLng: L.latLng(vias[i]),
					name: inputWaypoints[i].name,
					options: inputWaypoints[i].options
				});
			}

			return wps;
		},

		buildRouteUrl: function(waypoints, options) {
			var computeInstructions =
				/* Instructions are always needed, 
				   since we do not have waypoint indices otherwise */
				true,
				//!(options && options.geometryOnly),
				locs = [],
				i,
				baseUrl;
			
			for (i = 0; i < waypoints.length; i++) {
				locs.push('point=' + waypoints[i].latLng.lat + ',' + waypoints[i].latLng.lng);
			}

			baseUrl = this.options.serviceUrl + '?' +
				locs.join('&');

			return baseUrl + L.Util.getParamString(L.extend({
					instructions: computeInstructions,
					type: 'json',
					key: this._apiKey
				}, this.options.urlParameters), baseUrl);
		},

		_convertInstructions: function(instructions) {
			var signToType = {
					'-3': 'SharpLeft',
					'-2': 'Left',
					'-1': 'SlightLeft',
					0: 'Straight',
					1: 'SlightRight',
					2: 'Right',
					3: 'SharpRight',
					4: 'DestinationReached',
					5: 'WaypointReached',
					6: 'Roundabout'
				},
				result = [],
			    i,
			    instr;

			for (i = 0; instructions && i < instructions.length; i++) {
				instr = instructions[i];
				result.push({
					type: signToType[instr.sign],
					text: instr.text,
					distance: instr.distance,
					time: instr.time / 1000,
					index: instr.interval[0],
					exit: instr.exit_number
				});
			}

			return result;
		},

		_mapWaypointIndices: function(waypoints, instructions, coordinates) {
			var wps = [],
				wpIndices = [],
			    i,
			    idx;

			wpIndices.push(0);
			wps.push(new L.Routing.Waypoint(coordinates[0], waypoints[0].name));

			for (i = 0; instructions && i < instructions.length; i++) {
				if (instructions[i].sign === 5) { // VIA_REACHED
					idx = instructions[i].interval[0];
					wpIndices.push(idx);
					wps.push({
						latLng: coordinates[idx],
						name: waypoints[wps.length + 1].name
					});
				}
			}

			wpIndices.push(coordinates.length - 1);
			wps.push({
				latLng: coordinates[coordinates.length - 1],
				name: waypoints[waypoints.length - 1].name
			});

			return {
				waypointIndices: wpIndices,
				waypoints: wps
			};
		}
	});

	L.Routing.graphHopper = function(apiKey, options) {
		return new L.Routing.GraphHopper(apiKey, options);
	};

	module.exports = L.Routing.GraphHopper;
})();
