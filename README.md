# europe-geodata

A collection of OSM extracted geographical data for Europe:


| File        | Description                                                               | Source             | License                                        |
| ----------- | ------------------------------------------------------------------------- | ------------------ | ---------------------------------------------- |
| `places.db` | All inhabited places in Europe of more than 500 persons in SQLite3 format | Extracted from OSM | Open Data Commons Open Database License (ODbL) |
| `places.min.geojson` | All inhabited places in Europe of morethan 500 persons in GeoJSON format | Extracted from OSM | Open Data Commons Open Database License (ODbL) |
| `admin.min.geojson` | All European national and regional borders with Norway, Sweden and Finland slightly simplified to reduce file size | Extracted from OSM |  Open Data Commons Open Database License (ODbL)
| `countries` | All European national and regional borders, Norway can be used as a GeoJSON test case | Extracted from OSM |  Open Data Commons Open Database License (ODbL)
| `airport_sites.min.geosjon` | All airports in Europe with their IATA codes, including the small 5-letter aerodromes in France and Belgium | Merged from multiple sources | Open Data Commons Open Database License (ODbL)

Additionally `src` contains:

| File | Description | License |
| --- | --- | --- |
`download_inhabited_places` | A script in Node.js JavaScript and Overpass Query Language used to generate `places.db` from OSM | ISC

*Data collected for velivole.fr / meteo.guru in 2018 - 2019*
