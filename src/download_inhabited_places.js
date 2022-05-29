const util = require('util');
const rp = require('request-promise-native');
const fs = require('fs');
const path = require('path');
const QuadTree = require('simple-quadtree');

// You need to select an Overpass server to use
// make sure you respect its usage policy
//const server = "https://overpass.kumi.systems/api/interpreter";
const server = "https://lz4.overpass-api.de/api/interpreter";

const cachedir = path.resolve(__dirname, 'output', 'cache');
const outdir = path.resolve(__dirname, 'output', 'data');

// You need to define the countries you will be processing
// You can ignore the color used for velivole.fr but you must define the administrative level used for the regional borders
// This is an EU standard: Local Administrative Units (https://ec.europa.eu/eurostat/web/nuts/local-administrative-units)
var countries = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'data', 'velivole-config-countries.json', 'utf8')));
var features = [];
var regions = {};
var running = 0;
var [nInput, nOutput, nValid, nGeom, nName, nOutside] = [0, 0, 0, 0, 0, 0];
const runningMax = 1;

// You need to define a map extent
const mapExtent = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'data', 'velivole-config-extent-map.json', 'utf8')));

const overpassQuery = `
[out:json][bbox];
(
  node[place="city"];
  node[place="town"];
  node[place="village"];
)->.p;
.p is_in;
area._[name][boundary="administrative"][admin_level~"^[2-6]$"];
out tags;
foreach.p {
  is_in->.a;
  area.a[name][boundary="administrative"][admin_level~"^[2-6]$"]->.a;
  convert node
	::=::,
	::id=id(),
	::geom=geom(),
	region="{"+a.set('"'+t["admin_level"]+'":'+id())+"}";
  out geom;
}
`;

var qt = [];
var step = [0.25, 0.05, 0.01];
for (var v in step) {
	qt[v] = QuadTree(mapExtent[0], mapExtent[1], mapExtent[2] - mapExtent[0], mapExtent[3] - mapExtent[1]);
}

function clusterFeature(feature) {
	var v0 = feature.properties.p;
	var placeholder = false;
	for (var v = v0; v <= 2; v++) {
		var existing = qt[v].get({ x: feature.geometry.coordinates[0] - step[v], y: feature.geometry.coordinates[1] - step[v], w: step[v] * 2, h: step[v] * 2 });
		if (existing.length == 0) {
			qt[v].put({ x: feature.geometry.coordinates[0], y: feature.geometry.coordinates[1], w: 0, h: 0, feature: feature, placeholder: placeholder });
			if (!placeholder)
				nOutput++;
			placeholder = true;
		}
	}
}

function processFeature(feature) {
	nValid++;
	features.push(feature);
}

function processError(error) {
	if (error !== undefined) {
		console.log('\tOverpass error %s for %s', error, this);
		console.trace();
		process.exit(1);
	}
}

function processNode(node) {
	nInput++;
	if (node.lon < mapExtent[0] || node.lon > mapExtent[2] || node.lat < mapExtent[1] || node.lat > mapExtent[3]) {
		console.log('Node %s is outside the map extent, skipping', node.tags.name);
		nOutside++;
		return;
	}
	if (node.geometry === undefined) {
		console.log('No geometry %j', node);
		nGeom++;
		throw 'no geometry';
	}
	if (node.tags.name === undefined) {
		nName++;
		return;
	}
	let is_in = JSON.parse(node.tags.region.replace(/;/g, ','));
	let country = regions[is_in[2]].tags["ISO3166-1"];
	let alvl;
	if (countries[country] !== undefined)
		alvl = countries[country].alvl;
	else
		alvl = 6;

	let region;
	for (let i = alvl; i >= 2; i--)
		if (is_in[i] !== undefined) {
			region = regions[is_in[i]];
			break;
		}

	let rname = '';
	if (region.tags['name:prefix'] !== undefined && region.tags['name:prefix'].length > 0)
		rname = region.tags['name:prefix'] + ' ';
	if (region.tags['ref:INSEE'] !== undefined && region.tags['ref:INSEE'].length > 0)
		rname = region.tags['ref:INSEE'] + ' ';
	rname += region.tags.name;
	if (region.tags['name:suffix'] !== undefined && region.tags['name:suffix'].length > 0)
		rname += ' ' + region.tags['name:suffix'];
	let place = undefined;
	switch (node.tags.place) {
		case 'city':
			place = 0;
			break;
		case 'town':
			place = 1;
			break;
		case 'village':
		case 'hamlet':
			place = 2;
			break;
		default:
			return;
	}
	let pop = parseInt(node.tags.population, 10);
	if (isNaN(pop))
		pop = undefined;
	processFeature({
		type: 'Feature',
		geometry: node.geometry,
		properties: {
			n: node.tags.name,
			c: country,
			r: rname,
			p: place,
			pop: pop
		}
	});
}

function processArea(region) {
	if (regions[region.id] !== undefined)
		return;

	regions[region.id] = region;
	console.log('New region %s, level %d', region.tags.name, region.tags.admin_level);
}

function processTile(rawjson) {
	if (this.filename !== undefined) {
		running--;
	}
	console.log('%d:%d: Processing', this.x, this.y);
	data = JSON.parse(rawjson);
	for (let element of data.elements) {
		if (element.type == 'area')
			processArea(element);
		else
			processNode(element);
	}
	if (this.filename !== undefined) {
		console.log('Saving %s', this.filename);
		fs.writeFileSync(this.filename, rawjson, { encoding: 'utf8' })
	}
}

async function processAll() {
	let promise = undefined;
	for (let x = mapExtent[0]; x < mapExtent[2]; x++)
		for (let y = mapExtent[1]; y < mapExtent[3]; y++) {
			let filename = path.resolve(cachedir, x + "_" + y + '.geojson');
			if (fs.existsSync(filename)) {
				console.log('%d:%d: From cache %s', x, y, filename);
				try {
					processTile.call({ x: x, y: y }, fs.readFileSync(filename, 'utf8'));
				} catch (e) {
					console.error(e);
					console.error('Deleting ' + filename);
					fs.unlinkSync(filename);
				}
			} else {
				let query = util.format("%s?bbox=%d,%d,%d,%d&data=%s",
					server, x, y, x + 1, y + 1, encodeURIComponent(overpassQuery));
				if (promise !== undefined && running >= runningMax)
					await promise;
				console.log('%d:%d: Downloading', x, y);
				promise = rp(query).then(processTile.bind({ filename: filename, x: x, y: y })).catch(function (e) {
					console.error(e);
				});
				running++;
			}
		}
}

fs.mkdirSync(cachedir, { recursive: true });
fs.mkdirSync(outdir, { recursive: true });
processAll();
process.on('beforeExit', function () {
	var result = {
		type: 'FeatureCollection',
		features: []
	};
	features.sort(function (a, b) {
		if (a.properties.pop === undefined && b.properties.pop === undefined)
			return 0;
		if (a.properties.pop === undefined && b.properties.pop !== undefined)
			return 1;
		if (a.properties.pop !== undefined && b.properties.pop === undefined)
			return -1;
		if (a.properties.pop < b.properties.pop)
			return 1;
		if (a.properties.pop > b.properties.pop)
			return -1;
		return 0;
	});
	for (var f of features) {
		clusterFeature(f);
	}
	console.log('Map extent is %d:%d (%d:%d)', mapExtent[0], mapExtent[1], mapExtent[2] - mapExtent[0], mapExtent[3] - mapExtent[1])
	for (var v = 0; v <= 2; v++) {
		qt[v].get({ x: mapExtent[0], y: mapExtent[1], w: mapExtent[2] - mapExtent[0], h: mapExtent[3] - mapExtent[1] }, function (obj) {
			if (!obj.placeholder) {
				delete obj.feature.properties.pop;
				obj.feature.properties.p = v;
				result.features.push(obj.feature);
			}
			return true;
		});
	}
	fs.writeFileSync(path.resolve(outdir, 'places.geojson'), JSON.stringify(result, null, 2), { encoding: 'utf8' });
	console.log("Input places: %d, Valid places: %d, Output places: %d", nInput, nValid, nOutput);
	console.log("Outside extent: %d, Invalid geometry: %d, Invalid name: %d", nOutside, nGeom, nName);
	fs.writeFileSync(path.resolve(outdir, 'places.min.geojson'), JSON.stringify(result), { encoding: 'utf8' });
	let outCountries = {};
	for (let id in regions) {
		let r = regions[id];
		if (r.tags.admin_level == 2)
			outCountries[r.tags["ISO3166-1"]] = {
				alvl: 6,
				color: "#000000"
			}
	}
	fs.writeFileSync(path.resolve(outdir, 'countries.geojson'), JSON.stringify(outCountries, null, 2), { encoding: 'utf8' });
});