import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

const defaultArtifactUrl = new URL(
  '../data/bike-shops/overture-bicycle-shops.json.gz',
  import.meta.url,
);
const maximumCatalogRecords = 200_000;
const maximumUncompressedCatalogBytes = 128 * 1024 * 1024;
const maximumBrowseRecords = 500;
const maximumNearbyRecords = 100;
// The directory publishes at most 100 markers, but keeps a 500-candidate
// viewport cache ceiling. Return one extra sentinel record when a dense view
// exceeds that ceiling so the response can truthfully report `truncated` and
// prompt the visitor to zoom in.
const maximumViewportRecords = 501;
const catalogFormat = 'tracklab-overture-bike-shop-ndjson-v1';
const missingHierarchyRegion = '__region-not-listed__';
const missingHierarchyCity = '__city-not-listed__';

function text(value, maximumLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function number(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function googleLinks(name, latitude, longitude) {
  const coordinates = `${latitude},${longitude}`;
  return {
    maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${coordinates}`)}`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinates)}`,
    streetView: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(coordinates)}`,
  };
}

function sourceProvenance(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const entries = value
    .map((entry) => text(entry, 500))
    .filter(Boolean);
  if (entries.length !== value.length || entries.length > 32) return null;
  return [...new Set(entries)].sort((left, right) => left.localeCompare(right));
}

function providerLabel(value) {
  const provider = text(value, 120).toLowerCase();
  if (!provider) return '';
  const known = new Map([
    ['alltheplaces', 'AllThePlaces'],
    ['brightquery', 'BrightQuery'],
    ['dac', 'DAC'],
    ['foursquare', 'Foursquare'],
    ['krick', 'Krick'],
    ['meta', 'Meta'],
    ['microsoft', 'Microsoft'],
    ['pinmeto', 'PinMeTo'],
    ['renderseo', 'RenderSEO'],
  ]);
  return known.get(provider)
    ?? provider.replace(/[_-]+/gu, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function provenanceProviders(entries) {
  return [...new Set(entries.map((entry) => {
    const [dataset = '', , provider = ''] = entry.split('|');
    return providerLabel(provider || dataset);
  }).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueFormattedAddress(parts) {
  const selected = [];
  for (const part of parts.filter(Boolean)) {
    const normalized = part.toLocaleLowerCase();
    if (selected.some((existing) => existing.toLocaleLowerCase().includes(normalized))) continue;
    selected.push(part);
  }
  return selected.join(', ');
}

function normalizeCatalogTuple(tuple, minimumConfidence = 0) {
  if (!Array.isArray(tuple) || tuple.length < 13) return null;
  const [
    rawId,
    rawName,
    rawLatitude,
    rawLongitude,
    rawLine1,
    rawLocality,
    rawRegion,
    rawPostalCode,
    rawCountryCode,
    rawWebsite,
    rawPhone,
    rawCategory,
    rawConfidence,
    rawSourceProvenance,
  ] = tuple;
  const id = text(rawId, 160);
  const name = text(rawName, 180);
  const latitude = number(rawLatitude);
  const longitude = number(rawLongitude);
  const category = text(rawCategory, 80);
  const confidence = number(rawConfidence);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)
    || !name
    || latitude === null || latitude < -90 || latitude > 90
    || longitude === null || longitude < -180 || longitude > 180
    || !['bike_store', 'bike_repair_maintenance', 'bike_store_and_repair'].includes(category)
    || confidence === null || confidence < minimumConfidence || confidence > 1
  ) return null;
  const catalogProvenance = sourceProvenance(rawSourceProvenance);
  if (catalogProvenance === null) return null;
  const line1 = text(rawLine1, 240);
  const locality = text(rawLocality, 160);
  const region = text(rawRegion, 160);
  const postalCode = text(rawPostalCode, 40);
  const countryCode = text(rawCountryCode, 8).toUpperCase();
  tuple[0] = id;
  tuple[1] = name;
  tuple[2] = latitude;
  tuple[3] = longitude;
  tuple[4] = line1;
  tuple[5] = locality;
  tuple[6] = region;
  tuple[7] = postalCode;
  tuple[8] = countryCode;
  tuple[9] = text(rawWebsite, 500);
  tuple[10] = text(rawPhone, 80);
  tuple[11] = category;
  tuple[12] = confidence;
  tuple[13] = catalogProvenance;
  tuple.length = 14;
  return tuple;
}

function materializeCatalogRecord(tuple) {
  const [
    id,
    name,
    latitude,
    longitude,
    line1,
    locality,
    region,
    postalCode,
    countryCode,
    website,
    phone,
    category,
    confidence,
    catalogProvenance,
  ] = tuple;
  const formatted = uniqueFormattedAddress([line1, locality, region, postalCode]);
  return {
    id: `overture:${id}`,
    name,
    claimed: false,
    latitude,
    longitude,
    distanceMiles: 0,
    address: { line1, locality, region, postalCode, countryCode, formatted },
    phone,
    website,
    openingHours: '',
    services: {
      sales: ['bike_store', 'bike_store_and_repair'].includes(category),
      repair: ['bike_repair_maintenance', 'bike_store_and_repair'].includes(category),
      rental: false,
      ebike: false,
    },
    source: {
      provider: 'Overture Maps',
      elementType: 'place',
      elementId: id,
      url: 'https://docs.overturemaps.org/guides/places/',
      provenance: ['Overture Maps', ...provenanceProviders(catalogProvenance)],
      catalogProvenance,
    },
    links: googleLinks(name, latitude, longitude),
    catalogConfidence: confidence,
  };
}

function longitudeInside(longitude, west, east) {
  return west <= east
    ? longitude >= west && longitude <= east
    : longitude >= west || longitude <= east;
}

function distanceMiles(from, to) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const startLatitude = radians(from.latitude);
  const endLatitude = radians(to.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function viewportCenter(viewport) {
  const longitudeSpan = viewport.west <= viewport.east
    ? viewport.east - viewport.west
    : (180 - viewport.west) + (viewport.east + 180);
  let longitude = viewport.west + longitudeSpan / 2;
  if (longitude > 180) longitude -= 360;
  return {
    latitude: (viewport.north + viewport.south) / 2,
    longitude,
  };
}

function longitudeBounds(longitude, delta) {
  const normalize = (value) => {
    let result = value;
    while (result < -180) result += 360;
    while (result > 180) result -= 360;
    return result;
  };
  if (delta >= 180) return { west: -180, east: 180 };
  return { west: normalize(longitude - delta), east: normalize(longitude + delta) };
}

function minimalLongitudeExtent(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  let largestGap = (sorted[0] + 360) - sorted[sorted.length - 1];
  let gapStartIndex = sorted.length - 1;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const gap = sorted[index + 1] - sorted[index];
    if (gap > largestGap) {
      largestGap = gap;
      gapStartIndex = index;
    }
  }
  return {
    west: sorted[(gapStartIndex + 1) % sorted.length],
    east: sorted[gapStartIndex],
  };
}

function latitudeBand(latitude) {
  return Math.max(-90, Math.min(89, Math.floor(latitude)));
}

function hierarchyText(value, maximumLength) {
  const candidate = text(value, maximumLength);
  if (!candidate || /[\u0000-\u001f\u007f]/u.test(candidate)) return '';
  return candidate;
}

function nameSearchText(value, maximumLength = 180) {
  return hierarchyText(value, maximumLength)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u0027\u2019]/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function hierarchyKey(countryCode, region, locality) {
  return `${countryCode}\u0000${region}\u0000${locality}`;
}

function sortedHierarchyItems(counts) {
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => (
      left.value.localeCompare(right.value, undefined, { sensitivity: 'base' })
      || left.value.localeCompare(right.value)
    ));
}

export function createOvertureBikeShopCatalog(options = {}) {
  const artifactUrl = options.artifactUrl ?? defaultArtifactUrl;
  let loadPromise = null;

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      // Keep validated rows in their compact artifact tuple form. Expanding all
      // 85k+ listings into nested public response objects more than tripled the
      // directory's steady-state heap. Public records are materialized only for
      // the small search/browse result being returned. The line-oriented gzip
      // artifact is also verified incrementally so startup never constructs a
      // second 30+ MB JSON copy merely to calculate its checksum.
      const shops = [];
      const byLatitudeBand = Array.from({ length: 180 }, () => []);
      const byId = new Map();
      const catalogHash = createHash('sha256');
      catalogHash.update('[');
      let decodedBytes = 0;
      let decodedMetadata = null;
      let minimumConfidence = null;
      let expectedCount = null;
      let catalogSha256 = '';
      const compressedStream = createReadStream(artifactUrl);
      const decodedStream = compressedStream.pipe(createGunzip());
      const lines = createInterface({ input: decodedStream, crlfDelay: Infinity });
      for await (const line of lines) {
        decodedBytes += Buffer.byteLength(line, 'utf8') + 1;
        if (decodedBytes > maximumUncompressedCatalogBytes) {
          throw new Error('The Overture bike shop catalog exceeds its byte safety limit.');
        }
        if (!decodedMetadata) {
          try {
            decodedMetadata = JSON.parse(line);
          } catch {
            throw new Error('The Overture bike shop catalog metadata is invalid.');
          }
          minimumConfidence = number(decodedMetadata?.minimumConfidence);
          expectedCount = number(decodedMetadata?.recordCount);
          catalogSha256 = text(decodedMetadata?.catalogSha256, 64).toLowerCase();
          if (
            decodedMetadata?.schemaVersion !== 2
            || decodedMetadata?.format !== catalogFormat
            || !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}\.[0-9]+$/u.test(
              text(decodedMetadata?.release, 40),
            )
            || minimumConfidence === null || minimumConfidence < 0 || minimumConfidence > 1
            || expectedCount === null || !Number.isInteger(expectedCount)
            || expectedCount < 1 || expectedCount > maximumCatalogRecords
            || !/^[0-9a-f]{64}$/u.test(catalogSha256)
          ) throw new Error('The Overture bike shop catalog metadata is invalid.');
          continue;
        }
        if (shops.length >= maximumCatalogRecords) {
          throw new Error('The Overture bike shop catalog exceeds its safety limit.');
        }
        let rawTuple;
        try {
          rawTuple = JSON.parse(line);
        } catch {
          throw new Error('The Overture bike shop catalog contains invalid records.');
        }
        const tuple = normalizeCatalogTuple(rawTuple, minimumConfidence);
        if (!tuple || byId.has(tuple[0])) {
          throw new Error('The Overture bike shop catalog contains invalid records.');
        }
        if (shops.length > 0) catalogHash.update(',');
        catalogHash.update(line);
        const index = shops.length;
        shops.push(tuple);
        byId.set(tuple[0], index);
        byLatitudeBand[latitudeBand(tuple[2]) + 90].push(index);
      }
      catalogHash.update(']');
      if (!decodedMetadata) throw new Error('The Overture bike shop catalog metadata is invalid.');
      if (shops.length === 0) throw new Error('The Overture bike shop catalog is empty.');
      if (
        shops.length !== expectedCount
        || catalogHash.digest('hex') !== catalogSha256
      ) throw new Error('The Overture bike shop catalog metadata is invalid.');
      let hierarchyIndex = null;
      return {
        shops,
        byId,
        byLatitudeBand,
        get hierarchyIndex() {
          if (hierarchyIndex) return hierarchyIndex;
          const countryCounts = new Map();
          const regionCounts = new Map();
          const byCountry = new Map();
          const byRegion = new Map();
          const byCity = new Map();
          const appendIndex = (indexMap, key, index) => {
            const entries = indexMap.get(key);
            if (entries) entries.push(index);
            else indexMap.set(key, [index]);
          };
          shops.forEach((tuple, index) => {
            const countryCode = hierarchyText(tuple[8], 8).toUpperCase();
            const region = hierarchyText(tuple[6], 160) || missingHierarchyRegion;
            const locality = hierarchyText(tuple[5], 160) || missingHierarchyCity;
            if (!/^[A-Z]{2}$/u.test(countryCode)) return;
            countryCounts.set(countryCode, (countryCounts.get(countryCode) ?? 0) + 1);
            const regionKey = hierarchyKey(countryCode, region, '');
            regionCounts.set(regionKey, (regionCounts.get(regionKey) ?? 0) + 1);
            appendIndex(byCountry, countryCode, index);
            appendIndex(byRegion, regionKey, index);
            const cityKey = hierarchyKey(countryCode, region, locality);
            appendIndex(byCity, cityKey, index);
          });
          hierarchyIndex = { countryCounts, regionCounts, byCountry, byRegion, byCity };
          return hierarchyIndex;
        },
        metadata: {
          schemaVersion: decodedMetadata.schemaVersion,
          format: text(decodedMetadata.format, 120),
          release: text(decodedMetadata?.release, 40),
          generatedAt: text(decodedMetadata?.generatedAt, 80),
          minimumConfidence: number(decodedMetadata?.minimumConfidence),
          license: text(decodedMetadata?.license, 160),
          inputRecords: number(decodedMetadata?.inputRecords),
          acceptedRecordsBeforeDedupe: number(decodedMetadata?.acceptedRecordsBeforeDedupe),
          recordCount: expectedCount,
          duplicatesMerged: number(decodedMetadata?.duplicatesMerged),
          inputSha256: text(decodedMetadata?.inputSha256, 64),
          catalogSha256,
          licenses: Array.isArray(decodedMetadata?.licenses)
            ? decodedMetadata.licenses.map((entry) => text(entry, 80)).filter(Boolean).slice(0, 16)
            : [],
          notices: Array.isArray(decodedMetadata?.notices)
            ? decodedMetadata.notices.map((entry) => text(entry, 240)).filter(Boolean).slice(0, 16)
            : [],
          sourceProvenanceEncoding: text(decodedMetadata?.sourceProvenanceEncoding, 120),
        },
      };
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
    return loadPromise;
  }

  async function candidateIndexes(south, north, west, east) {
    const catalog = await load();
    const results = [];
    for (let band = latitudeBand(south); band <= latitudeBand(north); band += 1) {
      for (const index of catalog.byLatitudeBand[band + 90] ?? []) {
        const tuple = catalog.shops[index];
        if (
          tuple[2] >= south && tuple[2] <= north
          && longitudeInside(tuple[3], west, east)
        ) results.push(index);
      }
    }
    return { catalog, indexes: results };
  }

  return {
    async search(search) {
      const origin = {
        latitude: Number(search.latitude),
        longitude: Number(search.longitude),
      };
      const radiusMiles = Number(search.radiusMiles);
      const latitudeDelta = radiusMiles / 69;
      const longitudeScale = Math.max(0.01, Math.cos(origin.latitude * Math.PI / 180));
      const longitudeDelta = Math.min(180, radiusMiles / (69 * longitudeScale));
      const bounds = longitudeBounds(origin.longitude, longitudeDelta);
      const { catalog, indexes } = await candidateIndexes(
        Math.max(-90, origin.latitude - latitudeDelta),
        Math.min(90, origin.latitude + latitudeDelta),
        bounds.west,
        bounds.east,
      );
      return indexes.map((index) => {
        const tuple = catalog.shops[index];
        return {
          index,
          distance: distanceMiles(origin, { latitude: tuple[2], longitude: tuple[3] }),
        };
      }).filter((candidate) => candidate.distance <= radiusMiles)
        .sort((left, right) => (
          left.distance - right.distance
          || catalog.shops[left.index][1].localeCompare(catalog.shops[right.index][1])
          || catalog.shops[left.index][0].localeCompare(catalog.shops[right.index][0])
        ))
        .slice(0, maximumNearbyRecords)
        .map(({ index }) => materializeCatalogRecord(catalog.shops[index]));
    },
    async searchViewport(viewport) {
      const { catalog, indexes } = await candidateIndexes(
        viewport.south,
        viewport.north,
        viewport.west,
        viewport.east,
      );
      const center = viewportCenter(viewport);
      return indexes.map((index) => {
        const tuple = catalog.shops[index];
        return {
          index,
          distance: distanceMiles(center, { latitude: tuple[2], longitude: tuple[3] }),
        };
      }).sort((left, right) => (
        left.distance - right.distance
        || catalog.shops[left.index][1].localeCompare(catalog.shops[right.index][1])
        || catalog.shops[left.index][0].localeCompare(catalog.shops[right.index][0])
      )).slice(0, maximumViewportRecords)
        .map(({ index }) => materializeCatalogRecord(catalog.shops[index]));
    },
    async resolve(elementId) {
      const catalog = await load();
      const index = catalog.byId.get(String(elementId || '').toLowerCase());
      return index === undefined ? null : materializeCatalogRecord(catalog.shops[index]);
    },
    async searchByName(input = {}) {
      const catalog = await load();
      const request = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
      const query = hierarchyText(request.query, 180);
      const normalizedQuery = nameSearchText(query);
      const terms = normalizedQuery.split(/\s+/u).filter(Boolean);
      if (normalizedQuery.length < 2 || terms.length === 0) {
        throw new RangeError('Enter at least 2 characters of a bike shop name.');
      }
      const rawOffset = request.offset === undefined || request.offset === null || request.offset === ''
        ? 0
        : Number(request.offset);
      if (!Number.isInteger(rawOffset) || rawOffset < 0 || rawOffset > maximumCatalogRecords) {
        throw new RangeError('The bike shop name search page is invalid.');
      }
      const matches = [];
      for (let index = 0; index < catalog.shops.length; index += 1) {
        const tuple = catalog.shops[index];
        const normalizedName = nameSearchText(tuple[1]);
        if (!normalizedName || !terms.every((term) => normalizedName.includes(term))) continue;
        const rank = normalizedName === normalizedQuery
          ? 0
          : normalizedName.startsWith(normalizedQuery)
            ? 1
            : normalizedName.includes(normalizedQuery)
              ? 2
              : 3;
        matches.push({ index, normalizedName, rank });
      }
      matches.sort((left, right) => (
        left.rank - right.rank
        || left.normalizedName.localeCompare(right.normalizedName)
        || catalog.shops[left.index][1].localeCompare(catalog.shops[right.index][1])
        || catalog.shops[left.index][0].localeCompare(catalog.shops[right.index][0])
      ));
      const selectedIndexes = matches.slice(rawOffset, rawOffset + maximumBrowseRecords).map(({ index }) => index);
      const selected = selectedIndexes.map((index) => materializeCatalogRecord(catalog.shops[index]));
      const longitudeExtent = minimalLongitudeExtent(selected.map((shop) => shop.longitude));
      const bounds = selected.length > 0 ? {
        north: Math.max(...selected.map((shop) => shop.latitude)),
        south: Math.min(...selected.map((shop) => shop.latitude)),
        east: longitudeExtent.east,
        west: longitudeExtent.west,
      } : null;
      return {
        query,
        shops: selected,
        offset: rawOffset,
        limit: selected.length,
        truncated: rawOffset + selected.length < matches.length,
        total: matches.length,
        bounds,
      };
    },
    async hierarchy(input = {}) {
      const catalog = await load();
      const hierarchyIndex = catalog.hierarchyIndex;
      const countryCode = hierarchyText(input.countryCode, 8).toUpperCase();
      const region = hierarchyText(input.region, 160);
      if (region && !countryCode) {
        throw new RangeError('Choose a country before choosing a state or province.');
      }
      if (!countryCode) {
        return {
          level: 'country',
          items: sortedHierarchyItems(hierarchyIndex.countryCounts),
        };
      }
      if (!/^[A-Z]{2}$/u.test(countryCode)) {
        throw new RangeError('countryCode must be a two-letter country code.');
      }
      if (!region) {
        const counts = new Map();
        for (const [key, count] of hierarchyIndex.regionCounts) {
          const [candidateCountry, candidateRegion] = key.split('\u0000');
          if (candidateCountry === countryCode) counts.set(candidateRegion, count);
        }
        return { level: 'region', items: sortedHierarchyItems(counts) };
      }
      const counts = new Map();
      for (const [key, indexes] of hierarchyIndex.byCity) {
        const [candidateCountry, candidateRegion, candidateCity] = key.split('\u0000');
        if (candidateCountry === countryCode && candidateRegion === region) {
          counts.set(candidateCity, indexes.length);
        }
      }
      return { level: 'city', items: sortedHierarchyItems(counts) };
    },
    async browse(input = {}) {
      const catalog = await load();
      const request = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
      const hierarchyIndex = catalog.hierarchyIndex;
      const countryCode = hierarchyText(request.countryCode, 8).toUpperCase();
      const region = hierarchyText(request.region, 160);
      const locality = hierarchyText(request.locality, 160);
      const rawOffset = request.offset === undefined || request.offset === null || request.offset === ''
        ? 0
        : Number(request.offset);
      if (!Number.isInteger(rawOffset) || rawOffset < 0 || rawOffset > maximumCatalogRecords) {
        throw new RangeError('The bike shop directory page is invalid.');
      }
      if (!/^[A-Z]{2}$/u.test(countryCode)) {
        throw new RangeError('Choose a country before browsing bike shops.');
      }
      if (locality && !region) {
        throw new RangeError('Choose a state or province before choosing a city.');
      }
      const matchKey = region
        ? locality
          ? hierarchyKey(countryCode, region, locality)
          : hierarchyKey(countryCode, region, '')
        : countryCode;
      const matchIndex = locality
        ? hierarchyIndex.byCity
        : region
          ? hierarchyIndex.byRegion
          : hierarchyIndex.byCountry;
      const matches = [...(matchIndex.get(matchKey) ?? [])].sort((left, right) => (
        catalog.shops[left][1].localeCompare(catalog.shops[right][1])
        || catalog.shops[left][0].localeCompare(catalog.shops[right][0])
      ));
      const selectedIndexes = matches.slice(rawOffset, rawOffset + maximumBrowseRecords);
      const selected = selectedIndexes.map((index) => materializeCatalogRecord(catalog.shops[index]));
      const longitudeExtent = minimalLongitudeExtent(selected.map((shop) => shop.longitude));
      const bounds = selected.length > 0 ? {
        north: Math.max(...selected.map((shop) => shop.latitude)),
        south: Math.min(...selected.map((shop) => shop.latitude)),
        east: longitudeExtent.east,
        west: longitudeExtent.west,
      } : null;
      return {
        location: { countryCode, region, locality },
        shops: selected,
        offset: rawOffset,
        limit: selected.length,
        truncated: rawOffset + selected.length < matches.length,
        total: matches.length,
        bounds,
      };
    },
    async stats() {
      const catalog = await load();
      return { count: catalog.shops.length, ...catalog.metadata };
    },
  };
}
