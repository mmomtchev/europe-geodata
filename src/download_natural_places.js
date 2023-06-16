const util = require('util');
const fs = require('fs');
const path = require('path');
const cyrillic2latin = require('cyrillic-to-latin');
const QuadTree = require('simple-quadtree');
const query_overpass = require('query-overpass');
const { Queue } = require('async-await-queue');
const { geojsonType } = require('@turf/turf');

const output = '../cache/generated/natural_places.geojson';
const mapExtent = JSON.parse(fs.readFileSync('../data/velivole-config-extent-map.json', 'utf8'));

const qt = QuadTree(mapExtent[0], mapExtent[1], mapExtent[2] - mapExtent[0], mapExtent[3] - mapExtent[1]);
const q = new Queue(1, 50);
const step = 1;

const geojson = {
	type: 'FeatureCollection',
	features: []
};

for (let x = mapExtent[0]; x < mapExtent[2]; x += step)
	for (let y = mapExtent[1]; y < mapExtent[3]; y += step) {
		q.run(() => new Promise((res, rej) =>
			query_overpass(`node(${y},${x},${y + step},${x + step})[natural][name];out;`, (err, data) => {
				if (data.features) {
					for (const f of data.features) {
						qt.put({ x: f.geometry.coordinates[0], y: f.geometry.coordinates[1], w: 0, h: 0, feature: f });
					}
					console.log(`added ${data.features.length} features for ${y}:${x}`);
				} else {
					console.log(`no features added for ${y}:${x}`);
				}
				res();
			})
		));
	}



q.flush().then(() => {
	const all = qt.get({ x: mapExtent[0], y: mapExtent[1], w: mapExtent[2] - mapExtent[0], h: mapExtent[3] - mapExtent[1] });
	for (const f of all) {
		const feature = f.feature;
		if (typeof feature.properties.tags === 'object') {
			Object.assign(feature.properties, feature.properties.tags);
			delete feature.properties.tags;
		}
		geojson.features.push(feature);
	}
	fs.writeFileSync(output, JSON.stringify(geojson), 'utf-8');
});

